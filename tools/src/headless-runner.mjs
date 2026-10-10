/**
 * The headless half of `mnx check`, run as its own process.
 *
 * Plain JavaScript, so it runs under Node. Playwright's launch hangs under Bun
 * on Windows, so `mnx check` (which runs under Bun) starts the mock host
 * itself and runs this file with Node to drive it.
 *
 * Input: one JSON job on stdin:
 *   { url, scenarios: [{ name, surface, kind, drive? }], screenshots?: dir }
 * Output: one JSON object per line on stdout:
 *   { type: 'unavailable', reason }      the browser could not start
 *   { type: 'outcome', ...ScenarioOutcome }
 *   { type: 'done' }
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { auditScript } from './contrast.mjs';

const READY_TIMEOUT = 10_000;
// A preparation job may take up to 30 s before the host gives up on it.
const SCENARIO_START_TIMEOUT = 40_000;

/** Every theme choice the mock host has, at its default: each look below changes only a few. */
const BASE_THEME = {
  mode: 'match', scheme: 'light', accent: null, corners: 8, edges: 'lines', reducedMotion: false, moreColours: true,
  solidBackdrop: false, lineWidth: 1, lineStrength: 100, shadowStrength: 100,
};
/** --screenshots: light and dark, square and round, lines and shadows (theme v1). */
const THEME_MATRIX = ['light', 'dark'].flatMap(scheme => [0, 16].flatMap(corners => ['lines', 'shadows'].map(edges => ({ ...BASE_THEME, scheme, corners, edges }))));
/**
 * --screenshots also checks that text is readable in every look a user can
 * pick: the matrix above, plus both edges and none, a custom look with a solid
 * backdrop, fewer colours and reduced motion, in light and dark.
 */
const AUDIT_MATRIX = [
  ...THEME_MATRIX,
  ...['light', 'dark'].flatMap(scheme => [
    { edges: 'both' }, { edges: 'none' }, { mode: 'custom', solidBackdrop: true }, { moreColours: false }, { reducedMotion: true },
  ].map(patch => ({ ...BASE_THEME, scheme, ...patch }))),
];
const themeLabel = theme => [
  theme.scheme, theme.corners === 0 ? 'square' : theme.corners === 16 ? 'round' : 'soft', theme.edges,
  ...(theme.mode === 'custom' ? ['custom'] : []), ...(theme.solidBackdrop && theme.mode === 'custom' ? ['solid backdrop'] : []),
  ...(theme.moreColours ? [] : ['fewer colours']), ...(theme.reducedMotion ? ['reduced motion'] : []),
].join(' ');
const STEP_TIMEOUT = 5_000;
const LAUNCH_TIMEOUT = 60_000;

const emit = message => process.stdout.write(JSON.stringify(message) + '\n');
const firstLine = error => String(error?.message ?? error).split('\n').find(line => line.trim())?.trim() ?? '';

async function readJob() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

/** Launch Chromium, or explain why we cannot. */
async function openBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { reason: 'Playwright is not installed. Run "bun install" (or "npm install") at the repository root.' };
  }
  const executablePath = process.env.MNX_CHROMIUM || undefined;
  try {
    return { browser: await chromium.launch({ executablePath, timeout: LAUNCH_TIMEOUT }) };
  } catch (error) {
    // Playwright's default headless mode uses a separate "headless shell"
    // build. When only full Chromium is installed, use that instead.
    if (!executablePath && /executable doesn't exist/i.test(String(error?.message))) {
      try {
        return { browser: await chromium.launch({ channel: 'chromium', timeout: LAUNCH_TIMEOUT }) };
      } catch { /* report the first error */ }
    }
    return { reason: `Chromium could not start. Run "bunx playwright install chromium", or set MNX_CHROMIUM to a Chromium binary. (${firstLine(error)})` };
  }
}

const snapshot = page => page.evaluate(() => window.__mnxMock.snapshot());

async function waitUntil(page, test, timeout) {
  const end = Date.now() + timeout;
  for (;;) {
    const current = await snapshot(page);
    if (test(current) || Date.now() > end) return current;
    await page.waitForTimeout(50);
  }
}

/** Results of the scenario's own kind: a preparation's result doesn't complete an activity. */
const resultsOf = (state, kind) => state.results.filter(row => (row.surface === 'addon-job') === (kind === 'addon-job')).length;

async function playStep(page, step, problems, baseline, kind) {
  const frame = page.frameLocator('#addon-frame');
  if ('click' in step) await frame.locator(step.click).first().click({ timeout: STEP_TIMEOUT });
  else if ('fill' in step) await frame.locator(step.fill).first().fill(String(step.text ?? ''), { timeout: STEP_TIMEOUT });
  else if ('press' in step) {
    if (step.on) await frame.locator(step.on).first().press(step.press, { timeout: STEP_TIMEOUT });
    else {
      const focused = frame.locator(':focus');
      if (await focused.count()) await focused.first().press(step.press, { timeout: STEP_TIMEOUT });
      else await frame.locator('body').press(step.press, { timeout: STEP_TIMEOUT });
    }
  } else if ('waitFor' in step) await frame.locator(step.waitFor).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  else if ('waitForText' in step) {
    await frame.locator(step.waitForText).filter({ hasText: String(step.text) }).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  } else if ('waitForGone' in step) await frame.locator(step.waitForGone).first().waitFor({ state: 'hidden', timeout: STEP_TIMEOUT });
  else if ('setting' in step) {
    // The user changes settings while the add-on is open: the host sends update.
    for (const [id, value] of Object.entries(step.setting)) await page.evaluate(([key, next]) => window.__mnxMock.setSetting(key, next), [id, value]);
  } else if ('wait' in step) await page.waitForTimeout(Number(step.wait));
  else if ('relaunch' in step) {
    await page.evaluate(() => window.__mnxMock.relaunch());
    const after = await waitUntil(page, current => current.currentReady || current.errors.length > 0, READY_TIMEOUT);
    if (!after.currentReady) problems.push('After relaunch the add-on did not post "ready" within 10 s.');
  } else if ('expect' in step) {
    if (step.expect === 'complete') {
      const after = await waitUntil(page, current => resultsOf(current, kind) > baseline.results || current.errors.length > 0, READY_TIMEOUT);
      if (resultsOf(after, kind) <= baseline.results) problems.push('The drive script expected the add-on to call mnx.complete(), but it did not within 10 s.');
    } else {
      const after = await waitUntil(page, current => current.exitCount > baseline.exits || current.errors.length > 0, READY_TIMEOUT);
      if (after.exitCount <= baseline.exits) problems.push('The drive script expected the add-on to call mnx.exit(), but it did not within 10 s.');
    }
  }
}

/**
 * Measure the text in every look of AUDIT_MATRIX (see contrast.mjs). Text that
 * is too faint in any of them is a problem; the add-on's first screen is what
 * gets measured.
 */
async function auditReadability(page, problems) {
  const frame = await (await page.$('#addon-frame'))?.contentFrame();
  if (!frame) return '';
  // Colours ease between themes; measure the end state, not the middle.
  await frame.evaluate(`(() => { const style = document.createElement('style'); style.id = 'mnx-check-still';
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(style); })()`);
  const found = new Map();
  let texts = 0;
  for (const theme of AUDIT_MATRIX) {
    await page.evaluate(patch => window.__mnxMock.setTheme(patch), theme);
    await page.waitForTimeout(120);
    const result = await frame.evaluate(auditScript());
    texts = Math.max(texts, result.texts);
    for (const failure of result.failures) {
      const key = `${failure.element}|${failure.text}`;
      const row = found.get(key) ?? { ...failure, themes: [] };
      row.ratio = Math.min(row.ratio, failure.ratio);
      row.themes.push(themeLabel(theme));
      found.set(key, row);
    }
  }
  await frame.evaluate(`document.getElementById('mnx-check-still')?.remove()`);
  const rows = [...found.values()];
  for (const row of rows.slice(0, 8)) {
    const where = row.themes.length === AUDIT_MATRIX.length ? 'every theme' : row.themes.length > 3 ? `${row.themes.length} themes, such as ${row.themes.slice(0, 2).join('; ')}` : row.themes.join('; ');
    problems.push(`Text is hard to read: "${row.text}" (${row.element}) has contrast ${row.ratio}:1 and needs ${row.required}:1, in ${where}.`);
  }
  if (rows.length > 8) problems.push(`…and ${rows.length - 8} more piece(s) of text that are hard to read.`);
  return rows.length ? '' : `text readable in ${AUDIT_MATRIX.length} themes`;
}

async function runOne(browser, url, scenario, screenshotDir) {
  const problems = [];
  const screenshots = [];
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  // pageerror also fires for the add-on's own frame; those are reported through
  // the protocol's error message, so only the rest are the mock host's.
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let summary = '';
  let readable = '';
  try {
    await page.goto(`${url}?scenario=${encodeURIComponent(scenario.name)}&theme=light`);
    await page.evaluate(() => window.__mnxMock.ready());

    // Count from before the launch: a preparation job completes on its own.
    const before = await snapshot(page);
    await page.evaluate(() => window.__mnxMock.launch());
    let state = await waitUntil(page, current => current.currentReady || current.errors.length > 0, SCENARIO_START_TIMEOUT);
    if (!state.currentReady && !state.errors.length) {
      problems.push('The add-on never posted "ready" (10 s). Its code did not finish loading: look for a syntax error or a throw at the top level.');
    }

    if (screenshotDir && scenario.kind !== 'addon-job' && !state.errors.length && !problems.length) {
      // The theme changes live, as in the app: this also checks the add-on follows it.
      mkdirSync(screenshotDir, { recursive: true });
      // Tall enough to show the whole add-on, not just its first screen.
      const frame = await (await page.$('#addon-frame'))?.contentFrame();
      const contentHeight = frame ? await frame.evaluate('document.documentElement.scrollHeight') : 0;
      const viewport = page.viewportSize();
      const height = Math.min(4000, Math.max(viewport.height, contentHeight + 180));
      if (height !== viewport.height) await page.setViewportSize({ width: viewport.width, height });
      for (const theme of THEME_MATRIX) {
        await page.evaluate(patch => window.__mnxMock.setTheme(patch), theme);
        await page.waitForTimeout(250);
        const file = join(screenshotDir, `${scenario.name}-${theme.scheme}-${theme.corners ? 'round' : 'square'}-${theme.edges}.png`);
        await page.screenshot({ path: file });
        screenshots.push(file);
      }
      if (height !== viewport.height) await page.setViewportSize(viewport);
      readable = await auditReadability(page, problems);
      await page.evaluate(patch => window.__mnxMock.setTheme(patch), BASE_THEME);
      state = await snapshot(page);
    }

    if (!problems.length && !state.errors.length && scenario.drive) {
      const baseline = { results: resultsOf(before, scenario.kind), exits: before.exitCount };
      for (const [i, step] of scenario.drive.entries()) {
        try {
          await playStep(page, step, problems, baseline, scenario.kind);
        } catch (error) {
          problems.push(`Drive step ${i + 1} ${JSON.stringify(step)} failed: ${firstLine(error)}`);
        }
        if (problems.length || (await snapshot(page)).errors.length) break;
      }
    }
    if (!scenario.drive) await page.waitForTimeout(300); // let late errors arrive

    const final = await snapshot(page);
    for (const message of pageErrors) {
      if (!final.errors.some(error => error.includes(message) || message.includes(error))) problems.push(`The mock host page itself failed: ${message}`);
    }
    for (const error of final.errors) problems.push(`The add-on posted an error, so the app would fail the run: ${error}`);
    for (const result of final.results) {
      if (!result.ok) {
        const failed = result.checks.filter(check => !check.pass)
          .map(check => `${check.rule}${check.by === 'kit' ? ' [kit]' : ''}${check.detail ? ` (${check.detail})` : ''}`);
        const host = result.checks.some(check => !check.pass && check.by === 'host');
        problems.push(`${host ? 'The host would refuse the result' : 'The result fails the kit\'s checks'}: ${failed.join('; ')}`);
      }
    }
    const last = final.results.at(-1);
    const preparation = final.results.filter(row => row.surface === 'addon-job').at(-1);
    summary = problems.length ? 'failed'
      : scenario.kind === 'addon-job' ? `preparation passes the host's checks (${preparation?.offers ?? 0} offer(s))`
      : scenario.drive ? (last ? 'ready, drive → complete, result passes' : final.exitCount ? 'ready, drive → exit' : 'ready, drive finished')
      : 'ready, no errors (no drive script)';
    if (readable && !problems.length) summary += `; ${readable}`;
  } catch (error) {
    problems.push(`Could not run the scenario: ${firstLine(error)}`);
    summary = 'failed';
  } finally {
    await context.close();
  }
  return { name: scenario.name, surface: scenario.surface, ok: problems.length === 0, summary, problems, screenshots };
}

const job = await readJob();
const { browser, reason } = await openBrowser();
if (!browser) {
  emit({ type: 'unavailable', reason });
} else {
  try {
    for (const scenario of job.scenarios) emit({ type: 'outcome', ...(await runOne(browser, job.url, scenario, job.screenshots)) });
  } finally {
    await browser.close();
  }
}
emit({ type: 'done' });

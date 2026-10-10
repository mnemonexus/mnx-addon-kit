/** Check a manifest, build its bundle, scan it and run browser scenarios. */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { validateManifest } from '@mnemonexus/addon-sdk/validate';
import { PACK_LIMITS } from '@mnemonexus/addon-sdk/pack';
import { buildAddon, loadAddon, missingDependencies, tailwindConfig, usesTailwind } from '@mnemonexus/mock-host/addon';
import { runHeadless } from './headless';
import { scanCode, scanCss, scanTailwindColours, type Finding } from './scan';
import { dependencyOf, sourceLocator } from './sourcemap';
import { REPO_ROOT, show } from './paths';

/** The add-on's own source files under src/, as text. */
function sourceFiles(dir: string): { file: string; text: string }[] {
  const files: { file: string; text: string }[] = [];
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs|html|css|scss|sass)$/.test(name)) files.push({ file: relative(dir, path).split('\\').join('/'), text: readFileSync(path, 'utf8') });
    }
  };
  if (existsSync(join(dir, 'src'))) walk(join(dir, 'src'));
  return files;
}

type Status = 'pass' | 'warn' | 'fail' | 'skip';
interface Step { name: string; status: Status; detail: string; lines: string[] }
/**
 * `ok`: no step failed (a headless run that could not happen is not counted
 * here). `notRun`: the headless run did not happen, so the add-on was only
 * built and scanned. That is never a pass on its own.
 */
export interface AddonReport { dir: string; id: string; ok: boolean; notRun: boolean; steps: Step[] }

const MARK: Record<Status, string> = { pass: '✓', warn: '!', fail: '✗', skip: '-' };
const color = (status: Status, text: string) => {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  const code = status === 'pass' ? 32 : status === 'fail' ? 31 : status === 'warn' ? 33 : 90;
  return `\x1b[${code}m${text}\x1b[0m`;
};
/** The command that installs an add-on's own dependencies (a ported project has a package.json). */
export const installCommand = (dir: string) => `npm install --prefix ${show(dir)}`;

const RULE_WORDS: Record<string, string> = {
  'no-eval': 'eval or new Function', 'no-wasm': 'WebAssembly', 'no-browser-storage': 'browser storage', 'no-parent-access': 'the parent page',
  'no-network': 'the network', 'no-remote-css': 'remote CSS', 'html-from-strings': 'HTML from strings',
};

/**
 * Group dependency findings as warnings; browser scenarios determine whether
 * the affected code paths work in the sandbox.
 */
function dependencyLines(findings: Finding[]): string[] {
  const packages = new Map<string, Map<string, number>>();
  for (const finding of findings) {
    const counts = packages.get(finding.dependency!) ?? new Map<string, number>();
    counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
    packages.set(finding.dependency!, counts);
  }
  const blocked = findings.filter(finding => finding.level === 'error').length;
  return [
    `warning: ${findings.length} finding(s) in ${packages.size} dependenc${packages.size === 1 ? 'y' : 'ies'}, not your code${blocked ? `, ${blocked} of them things the sandbox blocks` : ''}. That is often harmless: code you never reach, or that catches the error. The headless run decides, so make sure your scenarios use the features that need them (GUIDE.md, "Porting a project").`,
    ...[...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, counts]) =>
      `   ${name}: ${[...counts].map(([rule, count]) => `${RULE_WORDS[rule] ?? rule}${count > 1 ? ` ×${count}` : ''}`).join(', ')}`),
  ];
}

const kib = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/** Type errors, when the add-on has a tsconfig.json. Bundling alone ignores types. */
function typecheck(dir: string): string[] {
  if (!existsSync(join(dir, 'tsconfig.json'))) return [];
  let tsc: string;
  try { tsc = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc'); }
  catch { return ['warning: TypeScript is not installed, so types were not checked. Run "bun install".']; }
  const run = spawnSync(process.execPath, [tsc, '-p', dir, '--pretty', 'false'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (run.status === 0) return [];
  const errors = `${run.stdout}${run.stderr}`.split('\n').filter(line => line.includes('error TS'));
  return errors.length ? errors.map(line => `error: ${line.replace(REPO_ROOT + '/', '')}`) : [`error: the type check failed:\n${run.stdout}${run.stderr}`];
}

export interface CheckOptions {
  /** Skip the headless run on purpose (--no-browser). */
  noBrowser?: boolean;
  /** Set after the first add-on finds the browser cannot start, so the rest don't wait again. */
  unavailable?: string;
  screenshots?: boolean;
  print?: (line: string) => void;
}

export async function checkAddon(dir: string, options: CheckOptions = {}): Promise<AddonReport> {
  const print = options.print ?? console.log;
  const steps: Step[] = [];
  const addon = loadAddon(dir);
  const id = addon.manifest?.id ?? relative(REPO_ROOT, dir);
  print(`\nChecking ${show(dir)}`);
  const report = (step: Step) => {
    steps.push(step);
    print(`  ${color(step.status, MARK[step.status])} ${step.name.padEnd(16)} ${step.detail}`);
    for (const line of step.lines) print(`      ${line}`);
  };

  // 1. Manifest.
  if (addon.manifestError) {
    report({ name: '1. Manifest', status: 'fail', detail: addon.manifestError, lines: [] });
  } else {
    const result = validateManifest(addon.manifest);
    const lines = [
      ...result.errors.map(e => `error: ${e.path ? `${e.path}: ` : ''}${e.message}`),
      ...result.warnings.map(w => `warning: ${w.path ? `${w.path}: ` : ''}${w.message}`),
    ];
    if (addon.manifest?.id && basename(dir) !== addon.manifest.id && !['templates', 'ui'].some(root => dir.startsWith(join(REPO_ROOT, root)))) {
      lines.push(`warning: the folder is called "${basename(dir)}" but the manifest id is "${addon.manifest.id}". Rename one so they match.`);
    }
    if (addon.manifest?.kind && addon.manifest.kind !== 'experience') {
      lines.push(`warning: this kit's mock host runs experiences. A ${addon.manifest.kind} pack is only validated.`);
    }
    report({
      name: '1. Manifest',
      status: result.errors.length ? 'fail' : lines.length ? 'warn' : 'pass',
      detail: result.errors.length ? `${result.errors.length} problem(s) the app would refuse` : 'matches the app\'s schema and rules',
      lines,
    });
  }
  const manifestOk = !steps.some(step => step.status === 'fail');

  // 2. Build: one IIFE script, within the size limits.
  const missing = missingDependencies(dir);
  const build = missing.length ? { ok: false, errors: [] } : await buildAddon(dir, { sourcemap: true });
  let code = '';
  if (missing.length) {
    report({ name: '2. Build', status: 'fail', detail: 'its own dependencies are not installed', lines: [
      `error: ${show(dir)}/package.json lists ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}, which are not in its node_modules. Run: ${installCommand(dir)}`,
    ] });
  } else if (!build.ok) {
    report({ name: '2. Build', status: 'fail', detail: 'the code does not bundle', lines: build.errors });
  } else {
    code = build.code!;
    const lines: string[] = [];
    if (build.bytes! < 1) lines.push('error: the bundled code is empty. The code file must be 1 byte to 8 MiB.');
    if (build.bytes! > PACK_LIMITS.maxCodeBytes) lines.push(`error: the bundled code is ${kib(build.bytes!)}. The limit is 8 MiB.`);
    let total = build.bytes!;
    for (const row of Array.isArray(addon.manifest?.assets) ? addon.manifest.assets : []) {
      const file = join(dir, String(row?.logicalPath ?? ''));
      if (!existsSync(file)) lines.push(`error: the manifest declares "${row?.logicalPath}" but there is no such file in ${show(dir)}.`);
      else total += statSync(file).size;
    }
    if (total > PACK_LIMITS.maxUncompressedBytes) lines.push(`error: code and assets come to ${kib(total)}. The limit is 512 MiB uncompressed.`);
    const manifestBytes = existsSync(join(dir, 'manifest.json')) ? statSync(join(dir, 'manifest.json')).size : 0;
    if (manifestBytes > PACK_LIMITS.maxManifestBytes) lines.push('error: manifest.json is over 512 KiB.');
    lines.push(...typecheck(dir));
    report({
      name: '2. Build',
      status: lines.some(line => line.startsWith('error')) ? 'fail' : 'pass',
      detail: `${kib(build.bytes!)} of code (limit 8 MiB), ${kib(total)} with assets`,
      lines,
    });
  }

  // 3. Static scan of the bundle and any CSS assets.
  if (code) {
    const network = Array.isArray(addon.manifest?.permissions) && addon.manifest.permissions.includes('network');
    const findings: Finding[] = scanCode(code, { network });
    for (const row of Array.isArray(addon.manifest?.assets) ? addon.manifest.assets : []) {
      const path = String(row?.logicalPath ?? '');
      if (path.endsWith('.css') && existsSync(join(dir, path))) findings.push(...scanCss(readFileSync(join(dir, path), 'utf8'), path));
    }
    // Tailwind with the MnemoNexus preset: its own colours don't exist.
    const sources = sourceFiles(dir);
    const isStyle = (file: string) => /\.(css|scss|sass)$/.test(file);
    if (sources.some(source => isStyle(source.file) && usesTailwind(source.text))) {
      findings.push(...scanTailwindColours(sources.filter(source => !isStyle(source.file)), { keepsPalette: Boolean(tailwindConfig(dir)) }));
    }
    // Exclude kit internals and group dependency findings by package.
    const where = build.map ? sourceLocator(code, build.map) : () => undefined;
    const kit = [join(REPO_ROOT, 'sdk', 'src') + sep, join(REPO_ROOT, 'ui', 'src') + sep];
    const scanned = findings.filter(finding => {
      const source = finding.index === undefined ? undefined : where(finding.index);
      if (source && kit.some(folder => resolve(source).startsWith(folder))) return false;
      finding.dependency = dependencyOf(source);
      return true;
    });
    findings.splice(0, findings.length, ...scanned);
    // With the shims imported, localStorage and sessionStorage work, in memory.
    const shimmed = build.map ? (JSON.parse(build.map).sources as string[]).some(source => resolve(source) === join(REPO_ROOT, 'sdk', 'src', 'shims.mjs')) : false;
    for (const finding of findings) {
      if (shimmed && finding.rule === 'no-browser-storage' && /^(local|session)Storage$/.test(finding.match ?? '')) {
        finding.level = 'warning';
        finding.message = `${finding.match} works here only through @mnemonexus/addon-sdk/shims, in memory: it forgets everything when the add-on closes. To keep anything, use mnx.storage (needs "storage:local").`;
      }
    }
    const own = findings.filter(f => !f.dependency);
    const inDependencies = findings.filter(f => f.dependency);
    const errors = own.filter(f => f.level === 'error');
    const warnings = own.length - errors.length + (inDependencies.length ? 1 : 0);
    report({
      name: '3. Static scan',
      status: errors.length ? 'fail' : findings.length ? 'warn' : 'pass',
      detail: findings.length ? `${errors.length} error(s), ${warnings} warning(s)` : 'nothing the sandbox would block',
      lines: [
        ...own.flatMap(f => [`${f.level}: ${f.message}`, `   near: ${f.snippet}`]),
        ...(inDependencies.length ? dependencyLines(inDependencies) : []),
      ],
    });
  } else {
    report({ name: '3. Static scan', status: 'skip', detail: 'skipped: nothing was built', lines: [] });
  }

  // 4. Headless run of every scenario.
  let notRun = false;
  let notRunStep: Step | undefined;
  const scenarioErrors = addon.scenarios.filter(row => row.errors.length);
  const scenarios = addon.scenarios.flatMap(row => row.scenario ? [row.scenario] : []);
  const scenarioLines = [
    ...scenarioErrors.flatMap(row => row.errors.map(error => `error: scenarios/${row.name}.json: ${error}`)),
    ...addon.scenarios.flatMap(row => row.warnings.map(warning => `warning: scenarios/${row.name}.json: ${warning}`)),
  ];
  const didNotRun = (why: string) => {
    notRun = true;
    notRunStep = {
      name: '4. Headless run',
      status: options.noBrowser ? 'skip' : 'fail',
      detail: `NOT RUN: ${why}`,
      lines: [...scenarioLines, options.noBrowser
        ? 'This add-on was built and scanned only. It has not been run, so this is not a full check.'
        : 'Fix the browser (see above), or pass --no-browser to accept a build-and-scan-only check.'],
    };
    report(notRunStep);
  };
  if (addon.manifest?.kind && addon.manifest.kind !== 'experience') {
    report({ name: '4. Headless run', status: 'skip', detail: `skipped: the mock host runs experiences, not ${addon.manifest.kind}`, lines: [] });
  } else if (!code || !manifestOk) {
    report({ name: '4. Headless run', status: 'skip', detail: 'skipped: fix the steps above first', lines: scenarioLines });
  } else if (!scenarios.length) {
    report({ name: '4. Headless run', status: 'fail', detail: `no scenarios. Add at least one JSON file to ${show(join(dir, 'scenarios'))}/.`, lines: scenarioLines });
  } else if (options.noBrowser) {
    didNotRun('you passed --no-browser');
  } else if (options.unavailable) {
    didNotRun(options.unavailable);
  } else {
    const result = await runHeadless(dir, scenarios, { screenshots: options.screenshots ? join(dir, 'screenshots') : undefined });
    if (!result.ran) {
      options.unavailable = result.reason;
      didNotRun(result.reason);
    } else {
      const outcomes = result.outcomes;
      const lines = [...scenarioLines];
      for (const outcome of outcomes) {
        lines.push(`${outcome.ok ? '✓' : '✗'} ${outcome.name} (${outcome.surface}): ${outcome.summary}`);
        for (const problem of outcome.problems) lines.push(`    ${problem}`);
        for (const shot of outcome.screenshots) lines.push(`    screenshot: ${show(shot)}`);
      }
      const failed = outcomes.filter(o => !o.ok).length + scenarioErrors.length;
      const surfaces = [...new Set(outcomes.map(o => o.surface))];
      const learningSurfaces = (addon.manifest?.learning?.activities ?? []).flatMap((row: any) => row?.surfaces ?? []);
      const declared = [...new Set(['standalone', ...Object.keys(addon.manifest?.surfaces ?? {}), ...learningSurfaces])];
      const reachesComplete = (s: typeof scenarios[number]) => s.kind === 'experience' && !!s.drive?.some(step => (step as any).expect === 'complete');
      const missingDrive = declared.filter(surface => !scenarios.some(s => s.surface === surface && reachesComplete(s)));
      if (addon.manifest?.learning && !scenarios.some(s => s.kind === 'addon-job')) {
        lines.push('warning: no scenario runs the preparation job. Add one with "prepare": true and "expectOffers".');
      }
      if (missingDrive.length) lines.push(`warning: no drive script ends with {"expect": "complete"} on: ${missingDrive.join(', ')}. Add one per surface.`);
      report({
        name: '4. Headless run',
        status: failed ? 'fail' : missingDrive.length || scenarioLines.length ? 'warn' : 'pass',
        detail: `${outcomes.length - outcomes.filter(o => !o.ok).length} of ${outcomes.length} scenario(s) passed (${surfaces.join(', ')})`,
        lines,
      });
    }
  }

  return { dir, id, ok: !steps.some(step => step.status === 'fail' && step !== notRunStep), notRun, steps };
}

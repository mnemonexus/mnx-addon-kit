/**
 * Mock-host page for launches, bridge calls, themes, settings and learning jobs.
 * window.__mnxMock exposes the controls used by browser scenarios.
 */
import { resolveSettings, validateResult } from '@mnemonexus/addon-sdk/validate';
import {
  CONTRACT_MESSAGES, DEFAULT_CHOICE, HostRun, MOCK_WORDING, Refusal, activityStudyContext, applyPick, buildSource, buildStudyContext,
  buildTheme, cannedReply, chooseOffer, handleBridgeRequest, isMockWording, isSuggested, matchesPartially, memoryStore, primitiveTokens, studyStorageScope,
  type AddonTheme, type BridgeOutcome, type Ceilings, type HostEvent, type Scenario, type SourceContext, type StorageStore, type ThemeChoice,
} from '../core/index';

interface AddonData {
  dir: string;
  buildId: number;
  manifest: any;
  manifestError: string | null;
  build: { ok: boolean; errors: string[]; bytes: number };
  code: string;
  scenarios: { name: string; scenario?: Scenario; errors: string[]; warnings: string[] }[];
  reference: { frame: string; frameNetwork: string; primitives: string; fonts: string };
  aiLive: { model: string; baseUrl: string } | null;
}

interface ResultRecord {
  scenario: string;
  surface: string;
  ok: boolean;
  checks: { rule: string; pass: boolean; by?: string; detail?: string }[];
  result: unknown;
  /** Preparation jobs: how many offers came back. */
  offers?: number;
}

/** What is mounted now: an Experience launch or a preparation job. */
interface Mount {
  kind: 'experience' | 'addon-job';
  scenario: Scenario;
  surface: string;
  study?: any;
  items: unknown[];
  source?: SourceContext;
  /** Resolves when a preparation job ends: its result, or why it failed. */
  job?: { resolve(value: { result?: any; error?: string }): void };
}

type Store = StorageStore & { snapshot(): Record<string, string>; clear(): Promise<void> };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function h(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined)[]) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  for (const child of children) if (child != null) element.append(child);
  return element;
}

let addon: AddonData | undefined;
let choice: ThemeChoice = { ...DEFAULT_CHOICE };
let run: HostRun | undefined;
let frame: HTMLIFrameElement | undefined;
let mounted: Mount | undefined;
let currentScenario: Scenario | undefined;
let currentStore: Store | undefined;
let storageLabel = '';
let currentProps: any;
const results: ResultRecord[] = [];
const errors: string[] = [];
const readyRuns = new Set<string>();
let readyCount = 0;
let exitCount = 0;
let launchCount = 0;
let busy = false;

// Keep storage and call ceilings per add-on across remounts, until page reload.
const memoryStores = new Map<string, ReturnType<typeof memoryStore>>();
const ceilings = new Map<string, Ceilings>();
// Settings v1: the user's stored values, per add-on, and the Model calls switch.
const settingValues = new Map<string, Record<string, unknown>>();
let modelCallsOn = true;
// Learning: the host caches preparations by source fingerprint (section 9).
const preparations = new Map<string, { source: SourceContext; preparation: any; readable: { id: string; path: string }[] }>();

// ── Theme v1 ─────────────────────────────────────────────────────────────────
function currentTheme(): AddonTheme {
  return buildTheme(choice);
}

/** The page follows the same look, so the mock reads like the app around it. */
function applyPageTheme(theme: AddonTheme) {
  const root = document.documentElement;
  for (const [token, value] of Object.entries({ ...primitiveTokens(theme), ...theme.tokens })) root.style.setProperty(token, value);
  root.dataset.theme = theme.scheme;
  root.style.colorScheme = theme.scheme;
}

function syncThemeControls() {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name=theme-mode]')) input.checked = input.value === choice.mode;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name=theme]')) input.checked = input.value === choice.scheme;
  $<HTMLInputElement>('accent').value = currentTheme().tokens['--mnx-accent'];
  $<HTMLInputElement>('accent').disabled = choice.accent === null;
  $<HTMLInputElement>('app-accent').checked = choice.accent === null;
  $<HTMLSelectElement>('line-width').value = String(choice.lineWidth);
  $<HTMLInputElement>('line-strength').value = String(choice.lineStrength);
  $<HTMLInputElement>('shadow-strength').value = String(choice.shadowStrength);
  $<HTMLSelectElement>('corners').value = String(choice.corners);
  $<HTMLSelectElement>('edges').value = choice.edges;
  $<HTMLInputElement>('reduced-motion').checked = choice.reducedMotion;
  $<HTMLInputElement>('more-colours').checked = choice.moreColours;
  $<HTMLInputElement>('solid-backdrop').checked = choice.solidBackdrop;
  $<HTMLInputElement>('solid-backdrop').disabled = choice.mode !== 'custom';
  $<HTMLOptionElement>('edges-none').disabled = choice.mode === 'custom';
}

/** Change the look. With a run open, the host sends `theme` and nothing remounts. */
function setTheme(patch: Partial<ThemeChoice>, quiet = false) {
  choice = { ...choice, ...patch };
  if (choice.mode === 'custom' && choice.edges === 'none') choice.edges = 'lines';
  syncThemeControls();
  const theme = currentTheme();
  applyPageTheme(theme);
  if (run && run.state !== 'disposed') {
    run.theme(theme, primitiveTokens(theme));
    if (!quiet) log('note', `Theme changed: ${describeChoice()}. Sent live, without a remount.`);
  }
}

function describeChoice() {
  return `${choice.mode === 'match' ? 'Match' : 'Custom'}, ${choice.scheme}, ${choice.corners}px corners, ${choice.edges}${choice.reducedMotion ? ', reduced motion' : ''}`;
}

// ── Log ──────────────────────────────────────────────────────────────────────
/** Summarise now: a transferred ArrayBuffer is detached a moment later. */
function describe(value: unknown, depth = 0): unknown {
  if (value instanceof ArrayBuffer) return `<ArrayBuffer ${value.byteLength} bytes>`;
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 400)}… <${value.length} characters>` : value;
  if (Array.isArray(value)) return depth > 6 ? '[…]' : value.map(item => describe(item, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 6) return '{…}';
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = (key === 'code' || key === 'styles') && typeof item === 'string' ? `<${item.length} characters>`
        : key === 'tokens' && item && typeof item === 'object' ? `<${Object.keys(item).length} tokens>`
        : describe(item, depth + 1);
    }
    return out;
  }
  return value;
}

function log(kind: 'in' | 'out' | 'dropped' | 'note' | 'bad', title: string, detail?: unknown) {
  const list = $('log');
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const dir = kind === 'in' ? '←' : kind === 'out' ? '→' : kind === 'dropped' ? '⊘' : kind === 'bad' ? '!' : '·';
  const item = h('li', { class: kind }, h('span', { class: 'dir' }, dir), h('span', { class: 'muted mono' }, time + ' '), title);
  if (detail !== undefined) {
    item.append(h('details', {}, h('summary', { class: 'small muted' }, 'details'), h('pre', {}, JSON.stringify(describe(detail), null, 2))));
  }
  list.append(item);
  list.scrollTop = list.scrollHeight;
}

function onHostEvent(event: HostEvent) {
  switch (event.type) {
    case 'in': {
      const message = event.message;
      if (message.kind !== 'bridge-request') log('in', String(message.kind), message);
      return;
    }
    case 'out': {
      const message = event.message;
      if (message.kind === 'bridge-response') return; // shown with its request below
      log('out', String(message.kind), message);
      return;
    }
    case 'dropped':
      log('dropped', `dropped: ${event.reason}`, event.message);
      return;
    case 'state':
      setRunState(event.state);
      return;
    case 'ready':
      readyCount++;
      if (run) readyRuns.add(run.runId);
      return;
    case 'error':
      errors.push(event.message);
      showBanner(`The add-on posted an error, so the app would show a failure screen: ${event.message}`);
      mounted?.job?.resolve({ error: event.message });
      return;
    case 'complete':
      if (mounted?.kind === 'addon-job') mounted.job?.resolve({ result: event.result });
      else recordResult(event.result);
      closeAfterRun('complete');
      return;
    case 'exit':
      exitCount++;
      showBanner('The add-on called mnx.exit(): the user leaves without a result.', true);
      mounted?.job?.resolve({ error: 'The preparation job called exit() instead of complete().' });
      closeAfterRun('exit');
      return;
    case 'bridge': {
      const payload = event.payload as any;
      const what = payload?.channel === 'storage' ? `storage.${payload.op}${payload.key ? ` "${payload.key}"` : ''}`
        : payload?.channel === 'asset' ? `asset "${payload.path}"`
        : payload?.channel === 'source-asset' ? `sourceAsset "${payload.id}"`
        : payload?.channel === 'external-api' ? `externalApi ${payload.apiId}/${payload.opId}`
        : payload?.channel === 'ai' ? 'generate' : `unknown request`;
      const outcome = event.outcome;
      if (outcome.ok) log('in', `${what} → ok (${event.ms} ms)`, { request: payload, value: outcome.value });
      else {
        const mock = isMockWording(outcome.error) ? ' [the mock\'s own wording: see docs/HOST_GAPS.md, or the scenario is missing something]' : '';
        log('bad', `${what} → refused: ${outcome.error}${mock}`, { request: payload, ...(outcome.note ? { why: outcome.note } : {}) });
      }
      if (payload?.channel === 'storage') renderStorage();
      return;
    }
  }
}

// ── Results ──────────────────────────────────────────────────────────────────
function resultCard(title: string, report: ResultRecord, verdict: string, notes: string[], result: unknown, extra: Node[] = []) {
  const rules = h('ul', { class: 'rules' });
  for (const check of report.checks) {
    rules.append(h('li', { class: check.pass ? 'pass' : 'fail' }, check.rule, check.by === 'kit' ? h('span', { class: 'muted small' }, ' (kit)') : null,
      check.pass || !check.detail ? null : h('span', { class: 'detail' }, check.detail)));
  }
  const card = h('div', { class: 'result' },
    h('div', {}, h('span', { class: `pill ${report.ok ? 'pill--ok' : 'pill--bad'}` }, report.ok ? 'PASS' : 'FAIL'), ' ',
      h('strong', {}, title), h('div', { class: 'small muted' }, verdict)),
    rules,
    ...notes.map(note => h('p', { class: 'small muted' }, note)),
    ...extra,
    h('details', {}, h('summary', { class: 'small muted' }, 'result JSON'), h('pre', {}, JSON.stringify(describe(result), null, 2))));
  const box = $('results');
  if (results.length === 1) box.textContent = '';
  box.prepend(card);
}

function recordResult(result: unknown) {
  if (!mounted) return;
  const { scenario, study, items } = mounted;
  const report = validateResult(result, { surface: mounted.surface, study, items: items as any });
  if (scenario.expectResult !== undefined) {
    const pass = matchesPartially(result, scenario.expectResult);
    report.checks.push({ rule: 'the result contains the scenario\'s expectResult', pass, by: 'kit', detail: `expected ${JSON.stringify(scenario.expectResult)}` } as any);
    report.ok = report.ok && pass;
  }
  const record: ResultRecord = { scenario: scenario.name, surface: mounted.surface, ok: report.ok, checks: report.checks, result: describe(result) };
  results.push(record);
  const hostFailed = report.checks.some(check => check.by === 'host' && !check.pass);
  const verdict = hostFailed ? 'The host would refuse this result.'
    : report.ok ? 'The host would accept this result, and it passes the kit\'s checks.'
    : 'The host would accept this result, but it fails the kit\'s checks (marked "kit").';
  const notes: string[] = [];
  if (report.kept) notes.push(`The host keeps only ${report.kept.join(', ')}. It records practice only: no mastery, unlocks or proposals.`);
  else notes.push('On this surface the host does not check the result. It hands it to the surface: only completed: true counts as a use. Checks marked "kit" are good practice.');
  const offer = currentProps?.learningActivity?.offer;
  const limit = offer ? addon?.manifest?.learning?.activities?.find((row: any) => row.id === offer.activityId)?.maxSeconds
    : mounted.surface === 'study' ? addon?.manifest?.surfaces?.study?.tasks?.find((task: any) => task.id === scenario.study?.taskId)?.maxSeconds
    : mounted.surface === 'recall' ? addon?.manifest?.surfaces?.recall?.maxSeconds : undefined;
  const elapsed = (result as any)?.elapsedSeconds;
  if (limit && typeof elapsed === 'number' && elapsed > limit) notes.push(`Note: elapsedSeconds (${elapsed}) is over the declared maxSeconds (${limit}).`);
  resultCard(offer ? `${scenario.title}: ${offer.label}` : scenario.title, record, verdict, notes, result);
  log(report.ok ? 'in' : 'bad', `result ${report.ok ? 'passes' : 'fails'} the checks`);
}

/** A preparation job's result: the host validates it against the declaration and the source. */
function recordPreparation(scenario: Scenario, source: SourceContext, outcome: { result?: any; error?: string }) {
  const manifest = addon!.manifest;
  let report: { ok: boolean; checks: ResultRecord['checks'] };
  if (outcome.error) {
    report = { ok: false, checks: [{ rule: 'the preparation job completes', pass: false, by: 'host', detail: outcome.error }] };
  } else {
    report = validateResult(outcome.result, { surface: 'addon-job', learning: manifest.learning, source });
  }
  const offers: any[] = outcome.result?.learningPreparation?.offers ?? [];
  if (scenario.expectOffers !== undefined) {
    const pass = report.ok && offers.length === scenario.expectOffers;
    report.checks.push({ rule: `the preparation offers ${scenario.expectOffers} task(s)`, pass, by: 'kit', detail: `it offered ${offers.length}` });
    report.ok = report.ok && pass;
  }
  const record: ResultRecord = { scenario: scenario.name, surface: 'addon-job', ok: report.ok, checks: report.checks, result: describe(outcome.result), offers: offers.length };
  results.push(record);
  const verdict = report.ok ? (offers.length ? `Prepared ${offers.length} offer(s). The host would accept them.` : 'Prepared no offers: this source gets normal study.')
    : 'The host would refuse this preparation, and normal study would carry on.';
  const list = report.ok && offers.length ? h('ul', { class: 'offers' }, ...offers.map((offer, index) => {
    const open = h('button', { class: 'btn btn--sm', 'data-offer': String(index) }, 'Open');
    open.addEventListener('click', () => void openActivity(scenario, index));
    return h('li', {}, h('span', {}, `${offer.label} `, h('span', { class: 'muted small' }, `(${offer.activityId}, ${offer.contentKind}, ~${offer.estimatedSeconds}s)`)), ' ', open);
  })) : null;
  resultCard(`${scenario.title}: preparation`, record, verdict, ['Source tasks rank before related examples; unmet prerequisites withhold an offer.'], outcome.result, list ? [list] : []);
  log(report.ok ? 'in' : 'bad', `preparation ${report.ok ? 'passes' : 'fails'} the host's checks (${offers.length} offer(s))`);
}

// ── Storage ──────────────────────────────────────────────────────────────────
function durableStore(scope: string) {
  let cache: Record<string, string> | undefined;
  const load = async () => {
    if (!cache) cache = await (await fetch(`/api/storage?scope=${encodeURIComponent(scope)}`)).json();
    return cache!;
  };
  const save = async () => {
    await fetch(`/api/storage?scope=${encodeURIComponent(scope)}`, { method: 'PUT', body: JSON.stringify(cache ?? {}) });
  };
  return {
    async get(key: string) { const data = await load(); return key in data ? data[key] : null; },
    async set(key: string, value: string) { (await load())[key] = value; await save(); },
    async delete(key: string) { delete (await load())[key]; await save(); },
    async keys() { return Object.keys(await load()); },
    snapshot: () => ({ ...(cache ?? {}) }),
    async clear() { cache = {}; await save(); },
    load,
  };
}

function storeFor(extensionId: string): Store {
  let store = memoryStores.get(extensionId);
  if (!store) memoryStores.set(extensionId, store = memoryStore());
  const map = store.map;
  return { ...store, snapshot: () => Object.fromEntries(map), async clear() { map.clear(); } };
}

function renderStorage() {
  const box = $('storage');
  box.textContent = '';
  $('storage-scope').textContent = storageLabel;
  if (!currentStore) return;
  const data = currentStore.snapshot();
  const keys = Object.keys(data);
  if (!keys.length) { box.append(h('p', { class: 'small muted' }, 'Empty.')); return; }
  const table = h('table', { class: 'storage-table' });
  for (const key of keys) {
    const value = data[key];
    table.append(h('tr', {}, h('td', { class: 'mono' }, key), h('td', { class: 'mono' }, value.length > 300 ? `${value.slice(0, 300)}… (${value.length} characters)` : value)));
  }
  box.append(table);
}

// ── Settings v1 ──────────────────────────────────────────────────────────────
function declaredSettings(): any[] {
  return Array.isArray(addon?.manifest?.settings) ? addon!.manifest.settings : [];
}

function settingsForProps() {
  return resolveSettings(declaredSettings(), settingValues.get(addon?.manifest?.id) ?? {});
}

/** The user changed a setting while the add-on is open: fresh props arrive through `update`. */
function settingsChanged() {
  renderSettings();
  if (!run || run.state === 'disposed' || !currentProps || currentProps.kind !== 'experience') return;
  currentProps = { ...currentProps, settings: settingsForProps() };
  run.update(currentProps);
}

function renderSettings() {
  const box = $('settings');
  box.textContent = '';
  const manifest = addon?.manifest;
  if (!manifest) return;
  const values = settingValues.get(manifest.id) ?? {};
  const resolved = settingsForProps();
  const set = (id: string, value: unknown) => {
    settingValues.set(manifest.id, { ...(settingValues.get(manifest.id) ?? {}), [id]: value });
    settingsChanged();
  };
  if (!declaredSettings().length) box.append(h('p', { class: 'small muted' }, 'This add-on declares no settings, so props.settings is {}.'));
  for (const field of declaredSettings()) {
    const id = `setting-${field.id}`;
    const value = resolved[field.id];
    let control: HTMLElement;
    if (field.type === 'toggle') {
      const input = h('input', { type: 'checkbox', id, 'data-setting': field.id }) as HTMLInputElement;
      input.checked = value === true;
      input.addEventListener('change', () => set(field.id, input.checked));
      control = h('label', { class: 'inline', for: id }, input, ` ${field.label}`);
    } else if (field.type === 'choice') {
      const select = h('select', { id, 'data-setting': field.id }, ...field.options.map((option: any) => h('option', { value: option.value }, option.label))) as HTMLSelectElement;
      select.value = String(value);
      select.addEventListener('change', () => set(field.id, select.value));
      control = h('label', { for: id }, field.label, select);
    } else if (field.type === 'number') {
      const input = h('input', { type: 'number', id, 'data-setting': field.id, min: String(field.min), max: String(field.max), step: String(field.step ?? 'any') }) as HTMLInputElement;
      input.value = String(value);
      input.addEventListener('change', () => set(field.id, Number(input.value)));
      control = h('label', { for: id }, `${field.label}${field.unit ? ` (${field.unit})` : ''}`, input);
    } else {
      const input = h('input', { type: 'text', id, 'data-setting': field.id, maxlength: String(field.maxLength ?? 500), placeholder: field.placeholder ?? '' }) as HTMLInputElement;
      input.value = String(value ?? '');
      input.addEventListener('change', () => set(field.id, input.value));
      control = h('label', { for: id }, field.label, input);
    }
    box.append(control);
    if (field.description) box.append(h('p', { class: 'small muted setting-help' }, field.description));
    if (field.id in values && values[field.id] !== value) box.append(h('p', { class: 'small warn' }, `The stored value ${JSON.stringify(values[field.id])} is not valid any more, so the default is sent.`));
  }
  // The app adds these to every add-on's Settings tab.
  const modelRow = $('model-calls-row');
  modelRow.hidden = !(manifest.permissions ?? []).includes('ai:generate');
  $<HTMLSelectElement>('model-calls').value = modelCallsOn ? 'on' : 'off';
  $('settings-props').textContent = JSON.stringify(resolved);
}

// ── Launch ───────────────────────────────────────────────────────────────────
function showBanner(text: string, ok = false) {
  const banner = $('stage-banner');
  banner.hidden = false;
  banner.className = ok ? 'banner banner--ok' : 'banner';
  banner.textContent = text;
}
function hideBanner() { $('stage-banner').hidden = true; }

function setRunState(state: string) {
  const pill = $('run-state');
  pill.textContent = state;
  pill.className = `pill ${state === 'failed' ? 'pill--bad' : state === 'ready' || state.startsWith('completed') ? 'pill--ok' : ''}`;
}

/** Scenarios are grouped by surface; preparation jobs get a group of their own. */
const groupOf = (scenario: Scenario) => scenario.kind === 'addon-job' ? 'preparation' : scenario.surface;

function selectedScenario(): Scenario | undefined {
  const name = $<HTMLSelectElement>('scenario').value;
  return addon?.scenarios.find(row => row.name === name)?.scenario;
}

/** Mount the frame, built exactly like the app's, and run the host side of one launch. */
async function mount(next: Mount, props: any, storageScope?: string, sourceMedia?: { id: string; path: string }[]) {
  const manifest = addon!.manifest;
  const permissions: string[] = manifest.permissions ?? [];
  dispose();
  hideBanner();
  launchCount++;
  currentProps = props;
  mounted = { ...next };

  if (storageScope) {
    const store = durableStore(storageScope);
    await store.load();
    currentStore = store;
    storageLabel = 'Durable study storage, scoped to the add-on and (workspaceId, study.runId, contextFingerprint). Survives a page reload.';
  } else {
    currentStore = storeFor(manifest.id);
    storageLabel = 'In-memory storage for this add-on. Survives Relaunch, not a page reload.';
  }
  renderStorage();

  const counters = ceilings.get(manifest.id) ?? { ai: 0, externalApi: 0 };
  ceilings.set(manifest.id, counters);
  const aiMode = $<HTMLSelectElement>('ai-mode').value;
  const declaredAssets: string[] = (manifest.assets ?? []).map((row: any) => row.logicalPath);
  const store = currentStore;
  const scenario = next.scenario;

  const element = document.createElement('iframe');
  element.id = 'addon-frame';
  element.title = manifest.label ?? 'Add-on';
  element.setAttribute('sandbox', 'allow-scripts');
  element.setAttribute('referrerpolicy', 'no-referrer');
  element.srcdoc = permissions.includes('network') ? addon!.reference.frameNetwork : addon!.reference.frame;
  const slot = $('frame-slot');
  slot.textContent = '';
  slot.append(element);
  frame = element;

  const theme = currentTheme();
  const runId = crypto.randomUUID();
  run = new HostRun({
    frame: element.contentWindow!,
    runId,
    // The fonts go at the top of styles (theme v1), then primitives.css.
    init: { code: addon!.code, props, styles: `${addon!.reference.fonts}\n${addon!.reference.primitives}`, tokens: primitiveTokens(theme), theme },
    onEvent: onHostEvent,
    bridge: (payload): Promise<BridgeOutcome> => handleBridgeRequest(payload, {
      extensionId: manifest.id, permissions, declaredAssets, missingAssets: scenario.missingAssets, storage: store, ceilings: counters,
      dataSourceIds: (Array.isArray(manifest.dataSources) ? manifest.dataSources : []).map((source: any) => source?.id),
      modelCallsOn: () => modelCallsOn,
      sourceMedia: (sourceMedia ?? []).map(row => ({
        id: row.id,
        async read() {
          const response = await fetch(`/api/source-media?path=${encodeURIComponent(row.path)}`);
          if (!response.ok) throw new Refusal(CONTRACT_MESSAGES.notThisActivity, `The scenario's file ${row.path} is missing.`);
          return response.arrayBuffer();
        },
      })),
      async readAsset(path) {
        const response = await fetch(`/api/asset?path=${encodeURIComponent(path)}`);
        if (!response.ok) throw new Error(`"${path}" is declared but the file is missing from the add-on folder.`);
        return response.arrayBuffer();
      },
      async generateText(prompt) {
        if (aiMode === 'refuse') throw new Refusal(CONTRACT_MESSAGES.modelFailed, 'The AI mode is set to refuse.');
        if (aiMode === 'live') {
          const response = await fetch('/api/ai', { method: 'POST', body: JSON.stringify({ prompt }) });
          const data = await response.json();
          // The app passes on the model service's own message.
          if (!response.ok) throw new Refusal(data.error ?? CONTRACT_MESSAGES.modelFailed, 'The live model call failed.');
          return data.text;
        }
        const reply = cannedReply(scenario.ai.answers, prompt);
        if (reply === undefined) throw new Refusal(CONTRACT_MESSAGES.modelFailed, 'No canned answer in this scenario matches the prompt.');
        return reply;
      },
      async callExternalApi(apiId, opId) {
        const data = scenario.externalApi[apiId]?.[opId];
        if (data === undefined) throw new Refusal(MOCK_WORDING.noCannedData(apiId, opId));
        // A canned {"$error": "…"} stands for the data layer's own refusal.
        const error = (data as any)?.$error;
        if (typeof error === 'string') throw new Refusal(error, 'The scenario gives this data call an error.');
        // The canned data is the parsed response; the op's pick selects from it, as in the app.
        const source = (manifest.dataSources ?? []).find((row: any) => row?.id === apiId);
        const pick = source?.ops?.find((op: any) => op?.id === opId)?.pick;
        return applyPick(data, typeof pick === 'string' ? pick : undefined);
      },
    }),
  });
  $('run-id').textContent = runId.slice(0, 8);
  return run;
}

/** Fetch each source image's size, so oversized or missing ones are omitted like the app does. */
async function mediaSizes(scenario: Scenario) {
  const sizes: Record<string, number | undefined> = {};
  for (const row of scenario.source?.media ?? []) {
    if (!('path' in row)) continue; // a remote figure: never read
    const response = await fetch(`/api/source-media?path=${encodeURIComponent(row.path)}`, { method: 'HEAD' });
    sizes[row.path] = response.ok ? Number(response.headers.get('content-length')) : undefined;
  }
  return sizes;
}

/** Learning: run the preparation job for the scenario's source, or reuse the cached one. */
async function prepare(scenario: Scenario, { fresh = false } = {}) {
  const manifest = addon!.manifest;
  const input = { ...scenario.source!, text: sourceTextOverride(scenario) ?? scenario.source!.text };
  const { source, readable } = await buildSource(input, await mediaSizes(scenario));
  const key = `${manifest.id}:${manifest.version}:${addon!.buildId}:${source.fingerprint}`;
  const cached = preparations.get(key);
  if (cached && !fresh) {
    log('note', 'Using the cached preparation for this source, as the host does.');
    return cached;
  }
  // The host builds every frame the same way: a job gets the user's settings,
  // the theme in init, and the Model calls switch, like any launch.
  const props = { kind: 'addon-job', extensionId: manifest.id, permissions: manifest.permissions ?? [], settings: settingsForProps(), source, attachments: [] };
  log('note', `Preparation job for "${scenario.title}"`, { props });
  const outcome = await new Promise<{ result?: any; error?: string }>(resolve => {
    let settled = false;
    const settle = (value: { result?: any; error?: string }) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    // Jobs time out after 30 seconds; a failed job can't block text study.
    const timer = setTimeout(() => settle({ error: 'The preparation job did not complete within 30 seconds.' }), 30_000);
    void mount({ kind: 'addon-job', scenario, surface: 'addon-job', items: [], source, job: { resolve: settle } }, props, undefined, readable);
  });
  if (outcome.error && !errors.includes(outcome.error)) errors.push(outcome.error);
  recordPreparation(scenario, source, outcome);
  const ok = results.at(-1)?.ok ?? false;
  const entry = { source, readable, preparation: ok ? outcome.result.learningPreparation : { attachments: [], offers: [] } };
  if (ok) preparations.set(key, entry);
  return entry;
}

/** Learning: launch a prepared offer, with `learningActivity` alongside the study context. */
async function openActivity(scenario: Scenario, which: string | number) {
  const manifest = addon!.manifest;
  const prepared = await prepare(scenario);
  const offer = chooseOffer(prepared.preparation.offers as any[], which);
  if (!offer) {
    showBanner(`No offer ${JSON.stringify(which)} in this preparation, so the session carries on with normal study.`, true);
    log('bad', `No offer ${JSON.stringify(which)} to launch.`);
    return;
  }
  const activity = manifest.learning.activities.find((row: any) => row.id === offer.activityId);
  const surface = scenario.kind === 'addon-job' ? (activity.surfaces.includes('study') ? 'study' : activity.surfaces[0]) : scenario.surface;
  const studyInput = scenario.study ?? {
    workspaceId: prepared.source.workspaceId, lectureId: prepared.source.lectureId, lectureTitle: 'Mock lecture',
    subsectionId: prepared.source.subsectionId, subsectionTitle: 'Mock subsection', depth: 'standard' as const,
    section: { objective: prepared.source.objective, text: prepared.source.text },
  };
  const study = surface === 'study' ? await activityStudyContext({
    extensionId: manifest.id, addonVersion: manifest.version, offerId: offer.id, payloadSchema: activity.payloadSchema, study: studyInput,
  }) : undefined;
  const items = scenario.kind === 'addon-job' ? [] : scenario.items;
  const props = {
    kind: 'experience', extensionId: manifest.id, surface, items, permissions: manifest.permissions ?? [],
    settings: settingsForProps(), ...(study ? { study } : {}), learningActivity: { offer, source: prepared.source },
  };
  currentScenario = scenario;
  await mount({ kind: 'experience', scenario, surface, study, items, source: prepared.source }, props,
    study ? studyStorageScope(manifest.id, study) : undefined, prepared.readable);
  log('note', `Launch activity "${offer.label}" on ${surface} (${describeChoice()})`, { props });
}

async function launch(name?: string) {
  if (!addon) return;
  if (name) selectScenario(name);
  const scenario = selectedScenario();
  if (!scenario) { log('bad', 'No scenario selected.'); return; }
  if (!addon.build.ok) { showBanner(`The add-on does not build: ${addon.build.errors.join(' ')}`); return; }
  busy = true;
  try {
    currentScenario = scenario;
    const manifest = addon.manifest;
    // The scenario's stored setting values and Model calls switch.
    if (Object.keys(scenario.settings).length) settingValues.set(manifest.id, { ...scenario.settings });
    modelCallsOn = scenario.modelCalls !== 'off';
    renderSettings();

    if (scenario.kind === 'addon-job') {
      await prepare(scenario, { fresh: true });
      return;
    }
    if (scenario.activity) {
      await openActivity(scenario, scenario.activity.offer);
      return;
    }
    let study: any;
    if (scenario.surface === 'study' && scenario.study) {
      const task = manifest.surfaces.study.tasks.find((row: any) => row.id === scenario.study!.taskId);
      study = await buildStudyContext({ ...scenario.study, extensionId: manifest.id, addonVersion: manifest.version, taskSchema: task.schema });
    }
    const props = {
      kind: 'experience', extensionId: manifest.id, surface: scenario.surface, items: scenario.items,
      permissions: manifest.permissions ?? [], settings: settingsForProps(), ...(study ? { study } : {}),
    };
    await mount({ kind: 'experience', scenario, surface: scenario.surface, study, items: scenario.items }, props,
      study ? studyStorageScope(manifest.id, study) : undefined);
    log('note', `Launch "${scenario.title}" on ${scenario.surface} (${describeChoice()}, AI ${$<HTMLSelectElement>('ai-mode').value})`, { props });
  } finally {
    busy = false;
  }
}

/**
 * Surfaces close the frame after complete or exit (the study surface straight
 * after complete). Tick "Keep the frame open" to look at the last screen.
 */
function closeAfterRun(how: 'complete' | 'exit') {
  const job = mounted?.kind === 'addon-job';
  if (!job && $<HTMLInputElement>('keep-open').checked) return;
  const ended = run;
  // After the current message is handled, so the run's own state settles first.
  setTimeout(() => {
    if (run !== ended) return;
    dispose();
    setRunState(how === 'complete' ? 'completed, closed' : 'exited, closed');
    $('frame-slot').append(h('p', { class: 'placeholder' }, job
      ? 'The preparation job finished. Its offers are under Result.'
      : `The run ended with ${how}, so the app closes the frame. Tick "Keep the frame open" to see the add-on's last screen.`));
  }, 0);
}

function dispose() {
  if (run) { run.dispose(); run = undefined; }
  if (frame) { frame.remove(); frame = undefined; }
  setRunState('none');
  $('run-id').textContent = '';
}

window.addEventListener('message', event => {
  run?.handle({ source: event.source, data: event.data });
});

// ── Controls ─────────────────────────────────────────────────────────────────
function sourceTextOverride(scenario: Scenario): string | undefined {
  const box = $<HTMLTextAreaElement>('source-text');
  return !box.closest('[hidden]') && box.dataset.scenario === scenario.name && box.value !== scenario.source?.text ? box.value : undefined;
}

function selectScenario(name: string) {
  const row = addon?.scenarios.find(item => item.name === name);
  if (!row?.scenario) return;
  $<HTMLSelectElement>('surface').value = groupOf(row.scenario);
  fillScenarios();
  $<HTMLSelectElement>('scenario').value = name;
  scenarioChanged();
}

function fillSurfaces() {
  const select = $<HTMLSelectElement>('surface');
  const previous = select.value;
  const groups: string[] = [...new Set(addon!.scenarios.filter(row => row.scenario).map(row => groupOf(row.scenario!)))];
  select.textContent = '';
  for (const group of groups) select.append(h('option', { value: group }, group));
  if (groups.includes(previous)) select.value = previous;
}

function fillScenarios() {
  const select = $<HTMLSelectElement>('scenario');
  const previous = select.value;
  const group = $<HTMLSelectElement>('surface').value;
  select.textContent = '';
  for (const row of addon!.scenarios) {
    if (row.scenario && groupOf(row.scenario) === group) select.append(h('option', { value: row.name }, row.scenario.title));
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function scenarioChanged() {
  const scenario = selectedScenario();
  const info = $('scenario-info');
  info.textContent = '';
  const sourceRow = $('source-row');
  sourceRow.hidden = true;
  if (!scenario) return;
  $<HTMLSelectElement>('ai-mode').value = scenario.ai.mode === 'live' && !addon?.aiLive ? 'canned' : scenario.ai.mode;
  const lines: (string | Node)[] = [];
  if (scenario.kind === 'addon-job') lines.push('A learning preparation job: the host runs extract, then offerActivities, and validates the result.');
  else lines.push(`${scenario.items.length} item(s).`);
  if (scenario.activity) lines.push(`Prepares, then launches offer ${JSON.stringify(scenario.activity.offer)} with learningActivity.`);
  if (scenario.study && !scenario.activity) {
    const task = addon!.manifest.surfaces?.study?.tasks?.find((row: any) => row.id === scenario.study!.taskId);
    const suggested = isSuggested(task?.matchAny ?? [], scenario.study.subsectionTitle, scenario.study.section.objective, scenario.study.section.text);
    lines.push(`Task "${scenario.study.taskId}".`, `Would be Suggested: ${suggested ? 'yes' : 'no'}.`);
  }
  if (Object.keys(scenario.settings).length) lines.push(`Settings: ${JSON.stringify(scenario.settings)}.`);
  if (scenario.modelCalls === 'off') lines.push('Model calls: Off.');
  if (scenario.drive) lines.push(`Has a drive script (${scenario.drive.length} steps).`);
  info.append(h('ul', {}, ...lines.map(line => h('li', {}, line))));
  const warnings = addon!.scenarios.find(row => row.name === scenario.name)?.warnings ?? [];
  for (const warning of warnings) info.append(h('p', { class: 'warn' }, warning));
  if (scenario.source) {
    sourceRow.hidden = false;
    const box = $<HTMLTextAreaElement>('source-text');
    box.value = scenario.source.text;
    box.dataset.scenario = scenario.name;
  }
}

/** /gallery shows the UI library's gallery instead of the add-on under development. */
const GALLERY = location.pathname === '/gallery';

async function loadAddon() {
  addon = await (await fetch(GALLERY ? '/api/addon?addon=gallery' : '/api/addon')).json() as AddonData;
  const manifest = addon.manifest;
  $('addon-name').textContent = manifest ? `${manifest.label} (${manifest.id} ${manifest.version})` : addon.dir;
  const status = $('build-status');
  status.textContent = addon.manifestError ? 'manifest error' : addon.build.ok ? `built · ${(addon.build.bytes / 1024).toFixed(1)} KiB` : 'build failed';
  status.className = `pill ${addon.build.ok && !addon.manifestError ? 'pill--ok' : 'pill--bad'}`;
  if (addon.manifestError) showBanner(addon.manifestError);
  else if (!addon.build.ok) showBanner(`Build failed: ${addon.build.errors.join(' ')}`);
  for (const row of addon.scenarios) {
    if (row.errors.length) log('bad', `scenarios/${row.name}.json: ${row.errors.join(' ')}`);
  }
  const liveOption = $<HTMLSelectElement>('ai-mode').querySelector<HTMLOptionElement>('option[value=live]')!;
  liveOption.disabled = !addon.aiLive;
  liveOption.textContent = addon.aiLive ? `Live model (${addon.aiLive.model})` : 'Live model (set MNX_AI_BASE_URL to enable)';
  if (manifest) { fillSurfaces(); fillScenarios(); scenarioChanged(); renderSettings(); }
}

$('surface').addEventListener('change', () => { fillScenarios(); scenarioChanged(); });
$('scenario').addEventListener('change', scenarioChanged);
$('launch').addEventListener('click', () => void launch());
$('relaunch').addEventListener('click', () => void launch(currentScenario?.name));
$('dispose').addEventListener('click', () => { dispose(); log('note', 'Disposed.'); });
$('send-update').addEventListener('click', () => {
  // The host sends update whenever the props object changes mid-run. This
  // sends the same props again: an add-on should handle it or ignore it safely.
  if (run && currentProps) run.update(currentProps);
});
$('clear-log').addEventListener('click', () => { $('log').textContent = ''; });
$('clear-storage').addEventListener('click', async () => { await currentStore?.clear(); renderStorage(); log('note', 'Storage cleared.'); });
for (const input of document.querySelectorAll<HTMLInputElement>('input[name=theme-mode]')) {
  input.addEventListener('change', () => setTheme({ mode: input.value as ThemeChoice['mode'] }));
}
for (const input of document.querySelectorAll<HTMLInputElement>('input[name=theme]')) {
  input.addEventListener('change', () => setTheme({ scheme: input.value as ThemeChoice['scheme'] }));
}
$('accent').addEventListener('change', () => setTheme({ accent: $<HTMLInputElement>('accent').value }));
$('app-accent').addEventListener('change', () => setTheme({ accent: $<HTMLInputElement>('app-accent').checked ? null : $<HTMLInputElement>('accent').value }));
$('line-width').addEventListener('change', () => setTheme({ lineWidth: Number($<HTMLSelectElement>('line-width').value) }));
$('line-strength').addEventListener('change', () => setTheme({ lineStrength: Number($<HTMLInputElement>('line-strength').value) || 100 }));
$('shadow-strength').addEventListener('change', () => setTheme({ shadowStrength: Number($<HTMLInputElement>('shadow-strength').value) || 100 }));
$('corners').addEventListener('change', () => setTheme({ corners: Number($<HTMLSelectElement>('corners').value) as ThemeChoice['corners'] }));
$('edges').addEventListener('change', () => setTheme({ edges: $<HTMLSelectElement>('edges').value as ThemeChoice['edges'] }));
$('reduced-motion').addEventListener('change', () => setTheme({ reducedMotion: $<HTMLInputElement>('reduced-motion').checked }));
$('more-colours').addEventListener('change', () => setTheme({ moreColours: $<HTMLInputElement>('more-colours').checked }));
$('solid-backdrop').addEventListener('change', () => setTheme({ solidBackdrop: $<HTMLInputElement>('solid-backdrop').checked }));
$('model-calls').addEventListener('change', () => {
  modelCallsOn = $<HTMLSelectElement>('model-calls').value === 'on';
  log('note', `Model calls: ${modelCallsOn ? 'MnemoNexus AI' : 'Off'}.`);
});
$('reset-settings').addEventListener('click', () => {
  if (addon?.manifest) settingValues.delete(addon.manifest.id);
  modelCallsOn = true;
  settingsChanged();
  log('note', 'Settings reset to defaults.');
});

// Rebuild on save: the server pushes "reload", the page fetches the new code
// and relaunches whatever was running.
function listen() {
  const events = new EventSource('/api/events');
  events.onmessage = async message => {
    const data = JSON.parse(message.data);
    if (data.type !== 'reload') return;
    const wasRunning = currentScenario?.name;
    await loadAddon();
    log('note', data.ok ? 'Rebuilt after a change.' : 'Rebuild failed.');
    if (wasRunning && data.ok) await launch(wasRunning);
  };
}

const ready = (async () => {
  const params = new URLSearchParams(location.search);
  setTheme({ scheme: params.get('theme') === 'dark' ? 'dark' : 'light' }, true);
  await loadAddon();
  if (!GALLERY) listen();
  const link = $<HTMLAnchorElement>('gallery-link');
  link.href = GALLERY ? '/' : '/gallery';
  link.textContent = GALLERY ? 'Back to the add-on' : 'UI gallery';
  const scenario = params.get('scenario');
  if (scenario) selectScenario(scenario);
  if (params.get('ai')) $<HTMLSelectElement>('ai-mode').value = params.get('ai')!;
  if (params.has('launch')) await launch();
})();

(window as any).__mnxMock = {
  ready: () => ready,
  launch: (name?: string) => launch(name),
  relaunch: () => launch(currentScenario?.name),
  dispose,
  /** Accepts 'light' | 'dark' or a partial theme choice; sent live when a run is open. */
  setTheme: (patch: Partial<ThemeChoice> | 'light' | 'dark') => setTheme(typeof patch === 'string' ? { scheme: patch } : patch, true),
  setSetting: (id: string, value: unknown) => {
    if (!addon?.manifest) return;
    settingValues.set(addon.manifest.id, { ...(settingValues.get(addon.manifest.id) ?? {}), [id]: value });
    settingsChanged();
  },
  snapshot: () => ({
    state: run?.state ?? 'none', runId: run?.runId ?? null, busy,
    // The current run has posted ready, or there is nothing open to wait for.
    currentReady: !busy && (!run || readyRuns.has(run.runId) || ['failed', 'completed', 'exited', 'disposed'].includes(run.state)),
    readyCount, exitCount, launchCount, errors: [...errors], results: [...results],
    scenarioErrors: addon?.scenarios.filter(row => row.errors.length).map(row => ({ name: row.name, errors: row.errors })) ?? [],
  }),
};

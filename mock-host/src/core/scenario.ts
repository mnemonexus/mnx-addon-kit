/**
 * Scenarios: one launch of an add-on, as a JSON file in `<addon>/scenarios/`.
 *
 * A scenario gives the props for one launch (surface, items, study context)
 * plus canned answers for `mnx.generate` and `mnx.externalApi`, and optionally
 * a `drive` script that `mnx check` plays to reach `complete`.
 *
 *   {
 *     "title": "Study, with section content",
 *     "surface": "study",
 *     "study": { "taskId": "...", "lectureTitle": "...", "subsectionTitle": "...",
 *                "section": { "objective": "...", "text": "..." } },
 *     "items": [ { "itemId": "...", "conceptTitle": "...", "text": "..." } ],
 *     "settings": { "showHints": false },        (the user's values; see settings-v1)
 *     "modelCalls": "off",                       (the app's Model calls switch)
 *     "ai": { "mode": "canned", "answers": [ { "match": "hint", "reply": "..." } ] },
 *     "externalApi": { "<apiId>": { "<opId>": { ...response... }, "<opId2>": { "$error": "Parameter \"q\" is required." } } },
 *     "missingAssets": ["assets/big.png"],      (or "all": a pack with no resident files)
 *     "drive": [ { "click": "button.primary" }, { "expect": "complete" } ]
 *   }
 *
 * Learning add-ons (addon-learning-v1) also have:
 *
 *   "prepare": true                   run the preparation job only, and check its result
 *   "activity": { "offer": 0 }       prepare, then launch the chosen offer (index or id)
 *   "source": { "objective": "...", "text": "...", "knowledge": [ ... ],
 *               "media": [ { "id": "fig-1", "mimeType": "image/png", "path": "scenarios/fig-1.png" },
 *                          { "id": "fig-2", "mimeType": "image/png", "url": "https://…" } ] }
 *                                     ("url": a remote figure, which the host leaves out)
 *   "expectOffers": 1                 how many offers the preparation must return
 *
 * Any scenario may also give "expectResult": a partial result the launch must
 * return, such as {"studyEvidence": {"attempts": 2}}.
 */
import type { KnowledgeItem } from '@mnemonexus/addon-sdk';
import { selectItems } from '@mnemonexus/addon-sdk/validate';

export const SURFACES = ['standalone', 'recall', 'transferal', 'calendar', 'study'] as const;
export type Surface = typeof SURFACES[number];

/** In study launches, and in a learning source, at most 64 items. */
export const MAX_SOURCE_ITEMS = 64;
/** The host takes the subsection's first eight figures, then keeps the readable ones of at most 8 MiB. */
export const MAX_SOURCE_MEDIA = 8;
export const MAX_SOURCE_MEDIA_BYTES = 8 * 1024 * 1024;

export type DriveStep =
  | { click: string }
  | { press: string; on?: string }
  | { fill: string; text: string }
  | { waitFor: string }
  | { waitForText: string; text: string }
  | { wait: number }
  | { waitForGone: string }
  | { setting: Record<string, unknown> }
  | { relaunch: true }
  | { expect: 'complete' | 'exit' };

/** A learning source, before the mock adds the fingerprint and reads media. */
export interface SourceInput {
  workspaceId: string;
  lectureId: string;
  subsectionId: string;
  objective: string;
  text: string;
  knowledge: KnowledgeItem[];
  sourceRefs: string[];
  /** The reading depth, which the fingerprint covers. */
  depth: 'core' | 'standard' | 'deep';
  /**
   * The subsection's figures. `path` is the mock's stand-in for a local
   * (data: or blob:) image: a file inside the add-on folder. `url` is a remote
   * figure, which the host never reads.
   */
  media: ({ id: string; mimeType: string; path: string } | { id: string; mimeType: string; url: string })[];
}

/**
 * Source references in the app's shape (section 9): the subsection's id, the
 * ids of its text blocks and each knowledge item's lineageId, without repeats.
 * The block ids are the mock's own stand-ins; add-ons must treat every
 * reference as opaque.
 */
export function defaultSourceRefs(subsectionId: string, text: string, knowledge: readonly KnowledgeItem[]): string[] {
  const blocks = text.split(/\n\s*\n/).filter(block => block.trim()).map((_, i) => `${subsectionId}:block-${i + 1}`);
  return [...new Set([subsectionId, ...blocks, ...knowledge.map(item => item.lineageId)])];
}

export interface AiAnswer { match?: string; reply: unknown }

export interface Scenario {
  name: string;
  title: string;
  /** 'addon-job' runs a learning preparation job; 'experience' launches the add-on. */
  kind: 'experience' | 'addon-job';
  surface: Surface;
  study?: {
    /** For a learning activity, filled in from the chosen offer at launch. */
    taskId: string;
    workspaceId: string;
    lectureId: string;
    lectureTitle: string;
    subsectionId: string;
    subsectionTitle: string;
    depth: 'core' | 'standard' | 'deep';
    section: { objective: string; text: string };
  };
  items: KnowledgeItem[];
  ai: { mode: 'canned' | 'refuse' | 'live'; answers: AiAnswer[] };
  externalApi: Record<string, Record<string, unknown>>;
  missingAssets: string[] | 'all';
  drive?: DriveStep[];
  /** The user's stored setting values (settings-v1). */
  settings: Record<string, unknown>;
  modelCalls: 'on' | 'off';
  /** Learning: the source for the preparation job and the activity launch. */
  source?: SourceInput;
  /** Learning: launch this offer (index or id) after preparing. */
  activity?: { offer: string | number };
  expectOffers?: number;
  /** A partial result the launch must return (objects match by key, arrays exactly). */
  expectResult?: unknown;
}

/** True when `actual` contains everything in `expected`. */
export function matchesPartially(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((value, i) => matchesPartially(actual[i], value));
  }
  if (expected && typeof expected === 'object') {
    return !!actual && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => matchesPartially((actual as any)[key], value));
  }
  return Object.is(actual, expected);
}

const isObject = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const DRIVE_KEYS = ['click', 'press', 'fill', 'waitFor', 'waitForText', 'waitForGone', 'wait', 'setting', 'relaunch', 'expect'];

/** Fill a partial item with type-correct defaults so scenarios stay short. */
export function normaliseItem(raw: Record<string, any>, index: number): KnowledgeItem {
  const itemId = String(raw.itemId ?? `item-${index + 1}`);
  return {
    lineageId: String(raw.lineageId ?? itemId),
    itemId,
    conceptId: String(raw.conceptId ?? `concept-${itemId}`),
    conceptTitle: String(raw.conceptTitle ?? ''),
    conceptKind: String(raw.conceptKind ?? 'other'),
    descriptorType: String(raw.descriptorType ?? 'definition'),
    descriptorStructure: String(raw.descriptorStructure ?? (Array.isArray(raw.structuredItems) && raw.structuredItems.length ? 'list' : 'single')),
    text: String(raw.text ?? ''),
    structuredItems: Array.isArray(raw.structuredItems) ? raw.structuredItems.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    discipline: String(raw.discipline ?? ''),
    practiceModes: Array.isArray(raw.practiceModes) ? raw.practiceModes.map(String) : [],
    hasMedia: raw.hasMedia === true,
  };
}

export interface ScenarioManifestView {
  id: string;
  version: string;
  surfaces: Record<string, any>;
  permissions: string[];
  knowledgeBinding?: { mode?: string; compatRule?: unknown };
  learning?: { activities?: { id: string; surfaces?: string[] }[] };
}

/**
 * Turn a scenario file into a launchable Scenario, or explain what is wrong
 * with it in plain words.
 */
export function parseScenario(name: string, raw: unknown, manifest: ScenarioManifestView):
  { scenario?: Scenario; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(raw)) return { errors: ['The scenario file must hold a JSON object.'], warnings };

  const learningSurfaces = new Set((manifest.learning?.activities ?? []).flatMap(activity => activity.surfaces ?? []));
  const isJob = raw.prepare !== undefined && raw.prepare !== false;
  const isActivity = raw.activity !== undefined;
  if ((isJob || isActivity) && !manifest.learning) {
    errors.push('"prepare" and "activity" are for learning add-ons, but manifest.json has no "learning" contribution.');
    return { errors, warnings };
  }
  if (isJob && isActivity) errors.push('Use "prepare" (check the preparation) or "activity" (prepare, then launch an offer), not both.');

  const surface = isJob ? 'study' : raw.surface ?? (isActivity ? 'study' : undefined);
  if (!SURFACES.includes(surface)) {
    errors.push(`"surface" must be one of: ${SURFACES.join(', ')}.`);
    return { errors, warnings };
  }
  if (isActivity) {
    if (!learningSurfaces.has(surface)) errors.push(`No learning activity in manifest.json supports the ${surface} surface.`);
  } else if (!isJob && surface !== 'standalone' && !(surface in (manifest.surfaces ?? {}))) {
    errors.push(`The scenario uses the ${surface} surface, but manifest.json does not declare surfaces.${surface}.`);
  }
  if (raw.capabilities !== undefined) {
    warnings.push('"capabilities" is no longer needed: the frame advertises every capability, including study-section-v1. It is ignored.');
  }

  const s = isObject(raw.study) ? raw.study : {};
  if (raw.study !== undefined && surface !== 'study') warnings.push('"study" is only used on the study surface. It is ignored here.');
  if (s.depth !== undefined && !['core', 'standard', 'deep'].includes(s.depth)) errors.push('study.depth must be "core", "standard" or "deep".');
  const ids = {
    workspaceId: String(s.workspaceId ?? 'mock-workspace'),
    lectureId: String(s.lectureId ?? 'mock-lecture'),
    subsectionId: String(s.subsectionId ?? 'mock-subsection'),
  };

  // The items the add-on is given, as the app chooses them: [] for a
  // none/produces binding; otherwise those that pass the compatRule, capped at
  // transferal.maxItems, and at 64 on study.
  let candidates: KnowledgeItem[] = [];
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items) || !raw.items.every(isObject)) errors.push('"items" must be a list of objects.');
    else candidates = raw.items.map(normaliseItem);
  }

  // Learning source.
  let source: SourceInput | undefined;
  if (isJob || isActivity) {
    const src = isObject(raw.source) ? raw.source : {};
    let knowledge = candidates;
    if (src.knowledge !== undefined) {
      if (!Array.isArray(src.knowledge) || !src.knowledge.every(isObject)) errors.push('"source.knowledge" must be a list of objects.');
      else knowledge = src.knowledge.map(normaliseItem);
    }
    if (knowledge.length > MAX_SOURCE_ITEMS) {
      warnings.push(`A source carries at most ${MAX_SOURCE_ITEMS} knowledge items, so only the first ${MAX_SOURCE_ITEMS} are given.`);
      knowledge = knowledge.slice(0, MAX_SOURCE_ITEMS);
    }
    const section = isObject(s.section) ? s.section : {};
    const text = String(src.text ?? section.text ?? '');
    if (text.length > 20000) errors.push('source.text can be at most 20,000 characters.');
    const media: SourceInput['media'] = [];
    if (src.media !== undefined) {
      if (!Array.isArray(src.media)) errors.push('"source.media" must be a list of {"id", "mimeType", "path" or "url"}.');
      else src.media.forEach((row: any, i: number) => {
        const shape = isObject(row) && typeof row.id === 'string' && row.id.length >= 1 && row.id.length <= 128 && typeof row.mimeType === 'string';
        const local = shape && typeof row.path === 'string' && row.path.split('/').every((part: string) => part && part !== '.' && part !== '..');
        const remote = shape && typeof row.url === 'string' && row.path === undefined;
        if (local) media.push({ id: row.id, mimeType: row.mimeType, path: row.path });
        else if (remote) media.push({ id: row.id, mimeType: row.mimeType, url: row.url });
        else errors.push(`source.media[${i}] must be {"id": 1-128 characters, "mimeType": "image/png", and "path": "a file inside the add-on folder" or "url": "a remote figure"}.`);
      });
    }
    const objective = String(src.objective ?? section.objective ?? '');
    source = {
      ...ids,
      objective,
      text,
      knowledge,
      sourceRefs: Array.isArray(src.sourceRefs) ? src.sourceRefs.map(String) : defaultSourceRefs(ids.subsectionId, text, knowledge),
      depth: s.depth ?? 'standard',
      media,
    };
  }

  let study: Scenario['study'];
  if (surface === 'study' && !isJob) {
    const tasks: any[] = manifest.surfaces?.study?.tasks ?? [];
    const taskId = isActivity ? '' : s.taskId ?? tasks[0]?.id;
    if (!isActivity && !tasks.some(task => task.id === taskId)) {
      errors.push(`study.taskId "${taskId}" is not one of the tasks in manifest.json (surfaces.study.tasks).`);
    }
    // Every study launch carries the current subsection (study-section-v1).
    let section = { objective: source?.objective ?? '', text: source?.text ?? '' };
    if (s.section !== undefined) {
      if (!isObject(s.section) || typeof s.section.objective !== 'string' || typeof s.section.text !== 'string') {
        errors.push('study.section must be {"objective": "...", "text": "..."}.');
      } else if (s.section.text.length > 20000) {
        errors.push('study.section.text can be at most 20,000 characters.');
      } else section = { objective: s.section.objective, text: s.section.text };
    }
    study = {
      taskId, ...ids,
      lectureTitle: String(s.lectureTitle ?? 'Mock lecture'),
      subsectionTitle: String(s.subsectionTitle ?? 'Mock subsection'),
      depth: s.depth ?? 'standard',
      section,
    };
  }

  let items = isJob ? [] : (isActivity && raw.items === undefined ? source?.knowledge ?? [] : candidates);
  if (items.length) {
    const mode = manifest.knowledgeBinding?.mode;
    const selected = selectItems(manifest, items);
    if (mode !== 'consumes' && mode !== 'transforms') {
      warnings.push(`The "${mode ?? 'none'}" binding always gets no items, so the scenario's ${items.length} item(s) are not given to the launch.`);
    } else {
      for (const { item, reason } of selected.rejected) warnings.push(`Item "${item.itemId}" does not pass the compatRule, so it is not given: ${reason}`);
      if (selected.capped !== undefined) warnings.push(`Items are capped at surfaces.transferal.maxItems (${selected.capped}).`);
    }
    items = selected.items;
  }
  if (surface === 'study' && items.length > MAX_SOURCE_ITEMS) {
    warnings.push(`A study launch gets at most ${MAX_SOURCE_ITEMS} items, so only the first ${MAX_SOURCE_ITEMS} are given.`);
    items = items.slice(0, MAX_SOURCE_ITEMS);
  }
  const transferal = manifest.surfaces?.transferal;
  if (surface === 'transferal' && transferal && items.length < transferal.minItems) {
    warnings.push(`The transferal surface needs at least ${transferal.minItems} items, but this scenario gives ${items.length}.`);
  }

  const aiRaw = isObject(raw.ai) ? raw.ai : {};
  const mode = aiRaw.mode ?? 'canned';
  if (!['canned', 'refuse', 'live'].includes(mode)) errors.push('ai.mode must be "canned", "refuse" or "live".');
  const answers: AiAnswer[] = Array.isArray(aiRaw.answers) ? aiRaw.answers : [];
  if (answers.some(answer => !isObject(answer) || !('reply' in answer))) errors.push('Each ai.answers entry needs a "reply".');

  const externalApi = isObject(raw.externalApi) ? raw.externalApi : {};
  const missingAssets: string[] | 'all' = raw.missingAssets === 'all' ? 'all' : Array.isArray(raw.missingAssets) ? raw.missingAssets.map(String) : [];

  if (raw.settings !== undefined && !isObject(raw.settings)) errors.push('"settings" must be an object of setting ids and values.');
  const settings = isObject(raw.settings) ? raw.settings : {};
  if (raw.modelCalls !== undefined && raw.modelCalls !== 'on' && raw.modelCalls !== 'off') errors.push('"modelCalls" must be "on" or "off".');

  let activity: Scenario['activity'];
  if (isActivity) {
    const offer = isObject(raw.activity) ? raw.activity.offer ?? 0 : undefined;
    if (!(typeof offer === 'string' || (Number.isInteger(offer) && offer >= 0))) errors.push('"activity" must be {"offer": index or offer id}.');
    else activity = { offer };
  }
  if (raw.expectOffers !== undefined && !(Number.isInteger(raw.expectOffers) && raw.expectOffers >= 0)) errors.push('"expectOffers" must be a whole number.');

  let drive: DriveStep[] | undefined;
  if (raw.drive !== undefined) {
    if (!Array.isArray(raw.drive)) errors.push('"drive" must be a list of steps.');
    else {
      drive = raw.drive;
      raw.drive.forEach((step: unknown, i: number) => {
        const keys = isObject(step) ? Object.keys(step).filter(key => DRIVE_KEYS.includes(key)) : [];
        if (keys.length === 0) errors.push(`drive step ${i + 1} must be one of: ${DRIVE_KEYS.map(key => `{"${key}": ...}`).join(', ')}.`);
      });
    }
  }

  const title = typeof raw.title === 'string' && raw.title ? raw.title : name;
  if (errors.length) return { errors, warnings };
  return {
    scenario: {
      name, title, kind: isJob ? 'addon-job' : 'experience', surface, study, items, ai: { mode, answers }, externalApi, missingAssets, drive,
      settings, modelCalls: raw.modelCalls === 'off' ? 'off' : 'on', source, activity,
      ...(raw.expectOffers !== undefined ? { expectOffers: raw.expectOffers } : {}),
      ...(raw.expectResult !== undefined ? { expectResult: raw.expectResult } : {}),
    },
    errors, warnings,
  };
}

/** The canned reply for a prompt: the first answer whose `match` appears in it (case-insensitive). */
export function cannedReply(answers: readonly AiAnswer[], fullPrompt: string): string | undefined {
  const prompt = fullPrompt.toLowerCase();
  const answer = answers.find(row => !row.match || prompt.includes(String(row.match).toLowerCase()));
  if (!answer) return undefined;
  return typeof answer.reply === 'string' ? answer.reply : JSON.stringify(answer.reply);
}

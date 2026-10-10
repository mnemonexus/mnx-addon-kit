# MnemoNexus add-on prompt

<!-- This file is generated from tools/prompt/PROMPT.src.md by `bun run prompt`. Edit the source, not this file. -->

**How to use this:** copy everything below the line into a chat AI, then add
one sentence saying what add-on you want. It replies with the files for one
add-on. Put them in `addons/<id>/` of a clone of
[the add-on kit](https://github.com/mnemonexus/mnx-addon-kit), then run
`bun run check <id>`, try it with `bun run dev <id>`, and build it with
`bun run pack <id>`. Paste any `check` errors back into the chat.

---

You are building an add-on for MnemoNexus, a desktop study app. An add-on is a
small web app that runs in a strict sandbox inside the app. Follow this brief
exactly. **Use only the APIs described here. Never invent others.** If you need
something this brief does not provide, say so instead of guessing.

## What to give me

Reply with these files, each in its own fenced code block headed by its path:

1. `manifest.json`
2. `src/main.ts` (and any other `src/*.ts` files you need, plus `src/styles.css` if you use Tailwind)
3. every file under `assets/` that the manifest declares (JSON or SVG text)
4. `scenarios/<name>.json`: at least one per surface you support, each with a
   `drive` script that clicks through to `complete`
5. a short `README.md`: what it does, which permissions it needs and why

Then list anything you were unsure of.

## The sandbox

The app mounts the add-on as
`<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">` with this CSP:
`default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'`.

So, in add-on code:

- No `eval`, no `new Function`, no libraries that compile code at runtime.
- No WebAssembly: the CSP blocks compiling it.
- No `localStorage`, `sessionStorage` or `indexedDB`: they throw. Use `mnx.storage`.
- No `window.parent`, `window.top` or `opener`. Talk to the host only through `window.mnx`.
- No `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource` (there is no network).
- No remote URLs in CSS. Images only as `data:`/`blob:` URLs, fonts only as `data:`. Use system fonts.
- No nested iframes, popups or form submission.
- One code file, loaded as a plain script. The kit bundles `src/main.ts` and its imports into one IIFE.
- Put untrusted text (item text, stored values, model replies) in with `textContent`, never `innerHTML`.
- Any uncaught error or unhandled rejection fails the run. Catch what you can recover from.
- Draw into `mnx.root`. It fills the frame.

## `window.mnx`

Get it with `getExperienceHost()` from `@mnemonexus/addon-sdk`, which checks the launch.

| Member | Meaning |
|---|---|
| `capabilities` | `study-examples-v1`, `study-storage-v1`, `study-section-v1`, `theme-v1`, `settings-v1`, `addon-learning-v1`, `source-media-v1`. Feature-detect with it. |
| `props` | What this run is about (below). |
| `onUpdate(fn)` | Called with fresh props when the host replaces them (a setting changed). |
| `root` | The element to draw into. |
| `complete(result)` | Finish with a result. |
| `exit()` | Leave without a result. |
| `asset(path)` | `Promise<ArrayBuffer>` of a declared `assets/…` file. |
| `generate({prompt, system?, json?})` | `Promise<string>` (parsed JSON with `json: true`). Needs `ai:generate`. The user's small local model: slow, maybe unavailable. Always have a fallback. |
| `storage.get/set/delete/keys` | String key/value. Needs `storage:local`. Max 512 keys, 524,288 characters per value. In study launches it is durable and scoped to the run; elsewhere it lasts until the app closes. |
| `theme`, `onTheme(fn)` | The theme in force, and a callback after a new one is applied (see Looking native). |

Every bridge call returns a promise that rejects with `Error(message)` when refused.

## Props

```ts
props = {
  kind: 'experience', extensionId: string,
  surface: 'standalone' | 'recall' | 'transferal' | 'calendar' | 'study',
  items: KnowledgeItem[],      // already filtered by the manifest's compatRule
  permissions: string[],
  settings: Record<id, value>,  // every declared setting (below); {} when none
  study?: { version: 1, runId, workspaceId, lectureId, lectureTitle, subsectionId, subsectionTitle,
            contextFingerprint, depth: 'core'|'standard'|'deep', taskId, taskSchema,
            section?: { objective, text } },  // study only; section with study-section-v1
}
KnowledgeItem = { lineageId, itemId, conceptId, conceptTitle, conceptKind, descriptorType,
  descriptorStructure /* 'single'|'list'|'sequence' */, text, structuredItems: string[],
  tags: string[], discipline, practiceModes: string[], hasMedia: boolean }
```

Vocabulary values (`conceptKind`, `descriptorType`) can grow. Tolerate unknown values; never guess their meaning.
The host may post `update` with new props mid-run (`mnx.onUpdate(fn)`); handle it or ignore it safely.
A `none` or `produces` binding always gets `items: []`.

## Results: `mnx.complete(result)`

```ts
{ completed: boolean, elapsedSeconds: number,
  quality?: number,            // integer 0-5, REQUIRED on recall
  completedStages?: string[],
  itemCoverage?: Record<lineageId, number>,  // 0-1, keyed by lineageId, not itemId
  studyEvidence?: {...} }      // REQUIRED on study
```

Only the first `complete` counts, and the app then closes the frame.

**Study launches.** The add-on brings its own reviewed content, keyed by
`props.study.taskId`. With `study-section-v1`, `props.study.section` also holds
the subsection's objective and markdown text (at most 20,000 characters), and
`items` its knowledge items (at most 64): use them when present, and work
without them. The host refuses the whole result unless:
`completed === true`; `elapsedSeconds` is 0 to 86,400;
`studyEvidence.runId`, `.taskId` and `.contextFingerprint` equal the same fields of `props.study`;
`solvedStepIds` is 1 to 128 non-empty strings of at most 128 characters;
`attempts` and `hintsUsed` are integers 0 to 100,000.

## The manifest

Unknown keys are refused. Fields: `schemaVersion: "mnxpack_manifest_v1"`, `id`
(lowercase kebab-case, 1-64), `version` (semver), `kind: "experience"`,
`label` [1-80], `description` [1-500], `tagline?` [≤120], `icon` (Font Awesome
class, e.g. `fa-solid fa-flask`), `author` [1-120], `subjects?` (≤16 strings),
`knowledgeBinding`, `surfaces`, `permissions`, `engines: {"mnxSdk": "1.0.0"}`,
`entry: {"logicalPath": "code/main.cjs"}`, `assets: [{logicalPath: "assets/…", mimeType?}]`,
`settings?` (below), `learning?` (see Learning add-ons).

- `knowledgeBinding`: `{mode:'none'}`, `{mode:'produces'}`, or
  `{mode:'consumes'|'transforms', compatRule}`. A compatRule node is
  `{kind, whenTrue, whenFalse, …}` (reasons 1-240 characters). Leaf kinds:
  `always`, `hasConcept`, `minTextLength {value}` (trimmed text length),
  `minStructuredItems {value}`, `hasMedia {value: boolean}`, and
  `descriptorTypeIn`, `descriptorStructureIn`, `conceptKindIn`, `practiceModeIn`,
  `tagIn`, `disciplineIn` with `values` (1-64 strings; match when any of the
  item's values is listed). Combinators: `allOf {rules}`, `anyOf {rules}`,
  `not {rule}`. The host applies it on every surface.
- `surfaces` (any of):
  `study: {version: 1, tasks: [{id (kebab, unique), label, schema, matchAny: [1-16 phrases of 2-100 chars], maxSeconds 1-1800}]}`;
  `recall: {maxSeconds 1-300, producesGrade: true}` (needs `schedule:recall`);
  `transferal: {category: 'application'|'integration'|'multiplayer'|'discovery', minItems 1-500, maxItems}` (needs `consumes`/`transforms`);
  `calendar: {defaultMinutes 1-1440, recurrable}` (needs `schedule:calendar`).
  `standalone` needs no declaration.
- `permissions` must match what the manifest does, both ways: `consumes`/`transforms`
  need `knowledge:read`, and `knowledge:read` without them (or `learning`) is an error. Others:
  `ai:generate`, `storage:local`, `schedule:recall`, `schedule:calendar`.
  Do not request permissions you do not use.

## Settings

`settings?` in the manifest: at most 24 fields. The app draws them on the
add-on's Settings tab; the add-on gets the values in `props.settings`, and
fresh props through `onUpdate` when the user changes one while it is open.

```
{ id (^[a-z][a-zA-Z0-9-]*$, 1-64, unique), label: 1-80, description?: 1-240, type, …by type }
'toggle': { default: boolean }
'choice': { options: 2-12 × {value: 1-64, label: 1-80} (unique values), default: one of the values }
'number': { min, max (> min), step?: > 0, unit?: 1-16, default (min-max) }
'text':   { default?: ≤ 2000, maxLength?: 1-2000, placeholder?: 1-120 }  default ≤ maxLength (500 if absent)
```

No secrets: a value enters the frame. The app also adds a **Model calls**
switch for `ai:generate`; when it is off every `generate` call is refused with
`Model calls are turned off for this add-on in its settings.` Carry on without
the model, as for any refusal.

## Looking native: the UI library

Use `@mnemonexus/addon-ui`, as the example below does. Call `installUi()` once
before drawing, then use its classes. They read only the user's theme tokens,
so light and dark, the user's colours, square or round corners, lines or
shadows, and live theme changes all just work, and the text stays readable.

- Layout: `mnx-column` (centred; `--wide`), `mnx-stack`, `mnx-row` (`--end`, `--between`).
- Text: `mnx-title`, `mnx-subtitle`, `mnx-text`, `mnx-muted`, `mnx-kbd`.
- Buttons: `mnx-button` + `mnx-button--primary|--secondary|--ghost|--danger`, optional `mnx-button--sm`.
- Cards: `mnx-card` with `mnx-card__header|__body|__footer`; `mnx-surface` (`--inset`).
- Choices: `mnx-choices` around `<button class="mnx-choice">` (or a `<label>` round a radio/checkbox) holding
  `mnx-choice__key` and `mnx-choice__text`; `aria-pressed="true"` selects; `data-state="correct|incorrect"` marks.
- Fields: `mnx-field` with `mnx-label`, `mnx-input|mnx-select|mnx-textarea`, `mnx-help` (`--error`).
- `mnx-badge` (`--accent|--success|--warning|--danger`), `mnx-chip` (`data-color="1"`…`"10"`, `mnx-chip__dot`).
- Progress: `mnx-progress` > `mnx-progress__fill` (set its width); `mnx-steps` > `mnx-step data-state="done|current|todo"`.
- Feedback: `mnx-feedback` (`--correct|--incorrect|--hint|--error`, give it `role="status"`),
  `mnx-empty` (`__title`, `__text`), `mnx-error` (`__title`, `__text`).

The `hidden` attribute works on them. For anything else, read tokens:
`var(--mnx-surface)`, `--mnx-text`, `--mnx-text-muted`, `--mnx-border-inner`,
`--mnx-accent` with `--mnx-accent-text`, `--mnx-radius-*`, `--mnx-shadow`.
Status colours (`--mnx-success`, `--mnx-danger`) and `--mnx-data-1`…`10` are for
borders, tints and dots, never text: they are too faint. Redraw canvases in
`mnx.onTheme`. Support the keyboard. Don't paint `body`: the frame is
transparent over the app.

Tailwind instead: `src/styles.css` with `@import "tailwindcss";`, imported from
`src/main.ts`. The kit compiles it with a preset whose colours are
`bg-mnx-surface`, `text-mnx-text`, `bg-mnx-accent` + `text-mnx-accent-text`, … ;
also `rounded-mnx-surface`, `shadow-mnx`, `border-mnx`, `font-mnx`. Tailwind's
own colours (`bg-white`, `text-gray-500`) do not exist.

## Learning add-ons (`addon-learning-v1`)

Only when I ask for an add-on that builds exercises from the lecture being
studied. Add to the manifest (needs `knowledge:read`; `knowledgeBinding` may be
`none`):

```
"learning": { "version": 1,
  "schemas": { "<schema-id>": { JSON Schema subset: type, properties, required, items, enum,
    minLength, maxLength, minimum, maximum, minItems, maxItems, additionalProperties: false } },
  "activities": [ { "id": "…", "label": "…", "payloadSchema": "<schema-id>", "maxSeconds": 300, "surfaces": ["study"] } ] }
```

Then, in `src/main.ts`, instead of `getExperienceHost()`:

```ts
import { defineAddon, type LearningContribution } from '@mnemonexus/addon-sdk/learning';
import manifest from '../manifest.json';
void defineAddon({ learning: manifest.learning as unknown as LearningContribution,
  extract(source, host) { return []; },                  // KnowledgeAttachment[]
  offerActivities({ source, attachments }, host) { … },  // ActivityOffer[]
  renderActivity(host) { … },     // host.props.learningActivity = { offer, source }, plus props.study
  renderStandalone(host) { … } }); // opened directly: use props.items, or explain
```

- Preparation job: `props = {kind: 'addon-job', settings, source, attachments: []}`, nothing drawn, 30 s limit.
  `source = {workspaceId, lectureId, subsectionId, fingerprint, objective, text (≤20,000), knowledge: KnowledgeItem[] (≤64), sourceRefs: string[], media: [{id, mimeType}]}`.
  `fingerprint` and `sourceRefs` are opaque: compare, never parse.
  `host.sourceAsset(id)` reads one `media` image (`source-media-v1`), in the job and its activity only.
- `ActivityOffer = {id, activityId, label, payload (fits its schema), sourceRefs, knowledgeRefs, prerequisiteIds, estimatedSeconds (≤ maxSeconds), contentKind: 'source-task'|'concept-example'}`.
  `KnowledgeAttachment = {id, schemaId, payload, sourceRefs, knowledgeRefs}`.
  References must come from the source: `sourceRefs` from `source.sourceRefs`, the
  others from the items' `lineageId`/`itemId`/`conceptId`. Never invent one.
- **Return no offers when the source doesn't clearly support the task.** Never invent an answer.
- The activity is a study run whose `taskId` is the offer's `id` (`taskSchema`: its `payloadSchema`).
  It completes with `studyEvidence` exactly as a study launch.

## Scenarios

`scenarios/<name>.json` describes one launch for the kit's mock host:

```json
{ "title": "…", "surface": "standalone|recall|study|…",
  "study": { "taskId": "…", "lectureTitle": "…", "subsectionTitle": "…" },
  "settings": { "<id>": "value" }, "modelCalls": "on|off",
  "items": [ { "itemId": "…", "conceptId": "…", "conceptTitle": "…", "text": "…" } ],
  "ai": { "mode": "canned|refuse", "answers": [ { "match": "word in prompt", "reply": "…" } ] },
  "drive": [ { "click": "css selector" }, { "press": "1" }, { "waitForText": "sel", "text": "…" },
             { "waitForGone": "sel" }, { "setting": { "<id>": "value" } },
             { "relaunch": true }, { "expect": "complete|exit" } ] }
```

Selectors run inside the add-on. Give interactive elements stable `data-` attributes.
A learning add-on adds scenarios with `"source": {"objective", "text", "knowledge"?}`
and either `"prepare": true, "expectOffers": n` (one per kind of source, including
one that must give 0) or `"activity": {"offer": 0}` with a drive script. Any
scenario may give `"expectResult"`: a partial result the add-on must return.

## A working example to copy

This starter passes every check. Follow its patterns: `getExperienceHost()`,
`installUi()` and library classes, permission checks before bridge calls,
drafts in storage, assets as `blob:` URLs, feature detection, `textContent`, a
fallback when `generate` is refused, and `try`/`catch` around everything that
can fail.

`manifest.json`:

```json
{
  "schemaVersion": "mnxpack_manifest_v1",
  "id": "quick-check",
  "version": "0.1.0",
  "kind": "experience",
  "label": "Quick Check",
  "description": "A short multiple-choice check. Built from your knowledge items, or from reviewed example tasks in a study session.",
  "tagline": "Three minutes, one concept at a time",
  "icon": "fa-solid fa-list-check",
  "author": "Your name",
  "subjects": [
    "biology"
  ],
  "knowledgeBinding": {
    "mode": "consumes",
    "compatRule": {
      "kind": "minTextLength",
      "value": 20,
      "whenTrue": "The item has enough text to ask a question about.",
      "whenFalse": "The item is too short to ask a question about."
    }
  },
  "surfaces": {
    "study": {
      "version": 1,
      "tasks": [
        {
          "id": "cell-organelles",
          "label": "Cell organelles",
          "schema": "quick-check-mcq-v1",
          "matchAny": [
            "organelle",
            "organelles",
            "mitochondria",
            "endoplasmic reticulum"
          ],
          "maxSeconds": 300
        },
        {
          "id": "photosynthesis-basics",
          "label": "Photosynthesis basics",
          "schema": "quick-check-mcq-v1",
          "matchAny": [
            "photosynthesis",
            "light-dependent reactions",
            "Calvin cycle"
          ],
          "maxSeconds": 300
        }
      ]
    },
    "recall": {
      "maxSeconds": 60,
      "producesGrade": true
    }
  },
  "permissions": [
    "knowledge:read",
    "storage:local",
    "ai:generate",
    "schedule:recall"
  ],
  "settings": [
    {
      "id": "showHints",
      "label": "Show the Hint button",
      "description": "Turn this off to practise without hints.",
      "type": "toggle",
      "default": true
    }
  ],
  "engines": {
    "mnxSdk": "1.0.0"
  },
  "entry": {
    "logicalPath": "code/main.cjs"
  },
  "assets": [
    {
      "logicalPath": "assets/tasks.json",
      "mimeType": "application/json"
    },
    {
      "logicalPath": "assets/illustration.svg",
      "mimeType": "image/svg+xml"
    }
  ]
}
```

`src/exercise.ts`:

```ts
/** Question content and draft identity, independent of the UI lifecycle. */
import type { KnowledgeItem } from '@mnemonexus/addon-sdk';

export interface Choice { id: string; label: string }
export interface Question { id: string; prompt: string; choices: Choice[]; answer: string; hint: string; lineageId?: string }
export interface Exercise { title: string; intro: string; questions: Question[] }

/** The shape of assets/tasks.json: reviewed exercises keyed by study task id. */
export interface TaskFile { tasks: Record<string, Exercise>; sample: Exercise }

/**
 * Read the reviewed content shipped in the pack. Assets arrive as raw bytes
 * through mnx.asset(), because the sandbox has no network and no file access.
 */
export async function loadTasks(asset: (path: string) => Promise<ArrayBuffer>): Promise<TaskFile> {
  const bytes = await asset('assets/tasks.json');
  return JSON.parse(new TextDecoder().decode(bytes)) as TaskFile;
}

/**
 * Build concept questions from supplied items. Requires at least two concepts
 * and uses only common fields, without assuming descriptor vocabulary.
 */
export function questionsFromItems(items: readonly KnowledgeItem[], limit = 8): Question[] {
  const concepts = new Map<string, string>();
  for (const item of items) if (item.conceptTitle) concepts.set(item.conceptId, item.conceptTitle);
  if (concepts.size < 2) return [];
  const usable = items.filter(item => item.text.trim() && concepts.has(item.conceptId)).slice(0, limit);
  return usable.map(item => {
    // Keep choices in a stable order so saved drafts can resume.
    const others = [...concepts].filter(([id]) => id !== item.conceptId).slice(0, 3);
    const choices = [[item.conceptId, concepts.get(item.conceptId)!], ...others]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const title = concepts.get(item.conceptId)!;
    return {
      id: item.itemId,
      lineageId: item.lineageId,
      prompt: item.text,
      choices,
      answer: item.conceptId,
      hint: `The answer starts with "${title.charAt(0)}".`,
    };
  });
}

/** A short, stable fingerprint of a question list, for naming a draft. */
export function exerciseKey(questions: readonly Question[]): string {
  let hash = 5381;
  for (const char of questions.map(q => q.id).join('|')) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}
```

`src/main.ts`:

```ts
/** Quick Check: reviewed study tasks, timed recall and item-based standalone
 * questions. Surface-specific results follow HOST_CONTRACT.md section 6. */
import { getExperienceHost, type ExperienceResult } from '@mnemonexus/addon-sdk';
import { installUi } from '@mnemonexus/addon-ui';
import { exerciseKey, loadTasks, questionsFromItems, type Exercise, type Question } from './exercise';

// Must match surfaces.recall.maxSeconds in manifest.json. The host does not
// pass it in props, so the add-on keeps its own copy.
const RECALL_SECONDS = 60;
const RECALL_QUESTIONS = 3;

// Unsupported protocol or study capabilities fail the launch.
const mnx = getExperienceHost();
const { props } = mnx;
const can = (permission: string) => props.permissions.includes(permission as never);

// Settings may change mid-run without rebuilding the exercise.
let showHints = props.settings?.showHints !== false;
mnx.onUpdate(next => {
  showHints = next.settings?.showHints !== false;
  document.querySelectorAll<HTMLButtonElement>('[data-action=hint]').forEach(hint => { hint.hidden = !showHints; });
});

// Use theme-aware components and keep the frame background transparent.
installUi();

/** Everything a draft needs to resume: where we are and what we have counted. */
interface Progress { index: number; solved: string[]; firstTry: string[]; attempts: number; hintsUsed: number; elapsed: number }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // Render item text and model replies as text, not HTML.
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label: string, variant: 'primary' | 'secondary' | 'ghost', action: string): HTMLButtonElement {
  const node = el('button', `mnx-button mnx-button--${variant}`, label);
  node.type = 'button';
  node.dataset.action = action;
  return node;
}

// Study drafts persist per subsection and task; other drafts last for the session.
// Storage is optional, and a failure must not interrupt the exercise.
function draftStore(key: string) {
  const enabled = can('storage:local');
  return {
    async load(): Promise<Progress | null> {
      if (!enabled) return null;
      try {
        const raw = await mnx.storage.get(key);
        return raw ? JSON.parse(raw) as Progress : null;
      } catch { return null; }
    },
    async save(progress: Progress) {
      if (enabled) await mnx.storage.set(key, JSON.stringify(progress)).catch(() => undefined);
    },
    async clear() {
      if (enabled) await mnx.storage.delete(key).catch(() => undefined);
    },
  };
}

// Create blob URLs for pack images; CSP allows only data: and blob: sources.
async function assetUrl(path: string, type: string): Promise<string | null> {
  try {
    return URL.createObjectURL(new Blob([await mnx.asset(path)], { type }));
  } catch {
    return null; // decorative: carry on without it
  }
}

// Model hints require ai:generate. Use the built-in hint if the call fails.
async function hintFor(question: Question): Promise<{ text: string; fromModel: boolean }> {
  if (!can('ai:generate')) return { text: question.hint, fromModel: false };
  try {
    const reply = await mnx.generate({
      system: 'You are a tutor. Give a one-sentence hint. Do not give the answer.',
      prompt: `Hint for: ${question.prompt}\nOptions: ${question.choices.map(c => c.label).join('; ')}`,
    });
    const text = String(reply).trim();
    return text ? { text, fromModel: true } : { text: question.hint, fromModel: false };
  } catch {
    return { text: question.hint, fromModel: false };
  }
}

// ── Choosing the exercise ──────────────────────────────────────────────────
async function chooseExercise(): Promise<Exercise | null> {
  const tasks = await loadTasks(mnx.asset);
  if (props.surface === 'study') {
    // Study tasks use reviewed pack content selected by task ID.
    return tasks.tasks[props.study!.taskId] ?? null;
  }
  const fromItems = questionsFromItems(props.items);
  const questions = fromItems.length ? fromItems : tasks.sample.questions;
  return {
    title: fromItems.length ? 'Quick Check' : tasks.sample.title,
    intro: fromItems.length ? 'Which concept does each description belong to?' : tasks.sample.intro,
    questions: props.surface === 'recall' ? questions.slice(0, RECALL_QUESTIONS) : questions,
  };
}

// ── The run ────────────────────────────────────────────────────────────────
async function main() {
  const exercise = await chooseExercise();
  if (!exercise || !exercise.questions.length) {
    return showMessage('Nothing to practise here', 'This add-on has no questions for this launch.');
  }
  const questions = exercise.questions;
  const drafts = draftStore(`draft:${props.surface}:${exerciseKey(questions)}`);
  const resumed = await drafts.load();
  const progress: Progress = resumed ?? { index: 0, solved: [], firstTry: [], attempts: 0, hintsUsed: 0, elapsed: 0 };
  const sessionStart = Date.now();
  const elapsedSeconds = () => Math.min(86400, progress.elapsed + Math.round((Date.now() - sessionStart) / 1000));
  const save = () => drafts.save({ ...progress, elapsed: elapsedSeconds() });

  const illustration = await assetUrl('assets/illustration.svg', 'image/svg+xml');

  // Section content is optional; check study-section-v1 before using it.
  const section = mnx.capabilities?.includes('study-section-v1') ? props.study?.section : undefined;

  const root = el('main', 'mnx-column');
  root.dataset.view = 'check';
  mnx.root.replaceChildren(root);

  const hero = el('header', 'mnx-row');
  if (illustration) {
    const img = el('img');
    img.src = illustration;
    img.alt = '';
    img.width = img.height = 56;
    hero.append(img);
  }
  const heading = el('div', 'mnx-stack');
  heading.style.gap = '0.25rem';
  heading.append(el('h1', 'mnx-title', exercise.title), el('p', 'mnx-muted', exercise.intro));
  hero.append(heading);
  root.append(hero);
  if (section?.objective) root.append(el('p', 'mnx-muted', `This section: ${section.objective}`));
  if (resumed) root.append(el('p', 'mnx-muted', 'Welcome back. You are where you left off.'));

  const progressBar = el('div', 'mnx-progress');
  progressBar.setAttribute('role', 'progressbar');
  progressBar.setAttribute('aria-label', 'Questions answered');
  progressBar.setAttribute('aria-valuemin', '0');
  progressBar.setAttribute('aria-valuemax', String(questions.length));
  const fill = el('div', 'mnx-progress__fill');
  progressBar.append(fill);
  const card = el('section', 'mnx-card');
  const cardHeader = el('div', 'mnx-card__header');
  const cardBody = el('div', 'mnx-card__body');
  card.append(cardHeader, cardBody);
  const timer = el('p', 'mnx-muted');
  root.append(progressBar, card, timer);

  // 1 for right first time, 0.5 for right after a miss, 0 for not reached.
  function coverage(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const q of questions) {
      if (q.lineageId) result[q.lineageId] = progress.firstTry.includes(q.id) ? 1 : progress.solved.includes(q.id) ? 0.5 : 0;
    }
    return result;
  }

  let finished = false;
  async function finish() {
    if (finished) return;
    finished = true;
    clearInterval(clock);
    await drafts.clear();
    const total = questions.length;
    const quality = Math.round((progress.firstTry.length / total) * 5);
    const result: ExperienceResult = props.surface === 'study'
      ? {
        completed: true,
        elapsedSeconds: elapsedSeconds(),
        // The host checks every field here against props.study, and keeps
        // only this, completed and elapsedSeconds. It records practice only.
        studyEvidence: {
          runId: props.study!.runId,
          taskId: props.study!.taskId,
          contextFingerprint: props.study!.contextFingerprint,
          solvedStepIds: progress.solved.slice(0, 128),
          attempts: progress.attempts,
          hintsUsed: progress.hintsUsed,
        },
      }
      // quality is required on recall and harmless elsewhere. itemCoverage is
      // keyed by each item's lineageId (not itemId), from 0 to 1.
      : { completed: progress.solved.length === total, elapsedSeconds: elapsedSeconds(), quality, completedStages: ['quick-check'],
        ...(questions.some(q => q.lineageId) ? { itemCoverage: coverage() } : {}) };
    mnx.complete(result);
    showMessage('Done', `You answered ${progress.firstTry.length} of ${total} on the first try.`);
  }

  // Recall is timed: when time runs out, hand back what we have.
  const deadline = Date.now() + Math.max(0, RECALL_SECONDS - progress.elapsed) * 1000;
  const clock = props.surface !== 'recall' ? undefined : setInterval(() => {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    timer.textContent = `${left} s left`;
    if (left === 0) void finish();
  }, 500);

  function render() {
    const total = questions.length;
    fill.style.width = `${Math.round((progress.solved.length / total) * 100)}%`;
    progressBar.setAttribute('aria-valuenow', String(progress.solved.length));
    if (progress.index >= total) return renderSummary();
    const question = questions[progress.index];
    cardHeader.replaceChildren(el('span', 'mnx-badge', `Question ${progress.index + 1} of ${total}`));
    const feedback = el('p', 'mnx-feedback');
    feedback.setAttribute('role', 'status'); // read out by screen readers
    const choices = el('div', 'mnx-choices');
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', 'Answers');
    question.choices.forEach((choice, i) => {
      const option = el('button', 'mnx-choice');
      option.type = 'button';
      option.dataset.action = 'choose';
      option.dataset.choice = choice.id;
      option.append(el('span', 'mnx-choice__key', String(i + 1)), el('span', 'mnx-choice__text', choice.label));
      option.addEventListener('click', () => choose(choice.id, option, feedback));
      choices.append(option);
    });
    const hint = button('Hint (H)', 'ghost', 'hint');
    hint.hidden = !showHints;
    hint.addEventListener('click', async () => {
      hint.disabled = true;
      feedback.className = 'mnx-feedback';
      feedback.textContent = 'Thinking…';
      const { text, fromModel } = await hintFor(question);
      progress.hintsUsed++;
      feedback.className = 'mnx-feedback mnx-feedback--hint';
      feedback.textContent = fromModel ? text : `Hint: ${text}`;
      void save();
    });
    const leave = button('Leave', 'ghost', 'leave');
    // exit() ends the run without a result. The draft stays, so the user can resume.
    leave.addEventListener('click', async () => { await save(); mnx.exit(); });
    const actions = el('div', 'mnx-row');
    actions.dataset.role = 'actions';
    actions.append(hint, leave);
    cardBody.replaceChildren(el('p', 'mnx-text', question.prompt), choices, feedback, actions);
    (choices.firstElementChild as HTMLElement | null)?.focus();
  }

  let triedThisQuestion = false;
  function choose(choiceId: string, option: HTMLButtonElement, feedback: HTMLElement) {
    const question = questions[progress.index];
    if (choiceId !== question.answer) {
      progress.attempts++;
      triedThisQuestion = true;
      option.disabled = true;
      option.dataset.state = 'incorrect';
      feedback.className = 'mnx-feedback mnx-feedback--incorrect';
      feedback.textContent = 'Not quite. Try another.';
      void save();
      return;
    }
    if (!progress.solved.includes(question.id)) progress.solved.push(question.id);
    if (!triedThisQuestion && !progress.firstTry.includes(question.id)) progress.firstTry.push(question.id);
    triedThisQuestion = false;
    progress.index++;
    void save();
    option.dataset.state = 'correct';
    feedback.className = 'mnx-feedback mnx-feedback--correct';
    feedback.textContent = 'Correct.';
    const next = button(progress.index >= questions.length ? 'See results' : 'Next', 'primary', 'next');
    next.addEventListener('click', render);
    cardBody.querySelectorAll<HTMLButtonElement>('[data-action=choose]').forEach(b => { b.disabled = true; });
    cardBody.querySelector('[data-role=actions]')!.prepend(next);
    next.focus();
  }

  function renderSummary() {
    cardHeader.replaceChildren(el('span', 'mnx-badge mnx-badge--success', 'All done'));
    const done = button('Finish', 'primary', 'finish');
    done.addEventListener('click', () => void finish());
    const actions = el('div', 'mnx-row');
    actions.append(done);
    cardBody.replaceChildren(
      el('p', 'mnx-text', `${progress.firstTry.length} of ${questions.length} right on the first try. ${progress.hintsUsed} hint(s) used.`),
      actions);
    done.focus();
  }

  // Keyboard: 1-4 pick a choice, H asks for a hint. Buttons handle Enter and Space.
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const choices = cardBody.querySelectorAll<HTMLButtonElement>('[data-action=choose]');
    const n = Number(event.key);
    if (n >= 1 && n <= choices.length && !choices[n - 1].disabled) choices[n - 1].click();
    if (event.key.toLowerCase() === 'h') cardBody.querySelector<HTMLButtonElement>('[data-action=hint]:not(:disabled):not([hidden])')?.click();
  });

  render();
}

function showMessage(title: string, text: string, tone: 'empty' | 'error' = 'empty') {
  const box = el('main', 'mnx-column');
  const card = el('div', tone === 'error' ? 'mnx-error' : 'mnx-empty');
  if (tone === 'error') card.setAttribute('role', 'alert');
  card.append(el('h1', `mnx-${tone}__title`, title), el('p', `mnx-${tone}__text`, text));
  const leave = button('Close', 'secondary', 'leave');
  leave.addEventListener('click', () => mnx.exit());
  const actions = el('div', 'mnx-row');
  actions.append(leave);
  card.append(actions);
  box.append(card);
  mnx.root.replaceChildren(box);
}

// Show recoverable errors and let the user exit. Uncaught errors fail the run.
main().catch(error => {
  showMessage('Something went wrong', error instanceof Error ? error.message : String(error), 'error');
});
```

`scenarios/study.json`:

```json
{
  "title": "Study, reviewed task (today's host)",
  "surface": "study",
  "study": {
    "taskId": "cell-organelles",
    "workspaceId": "ws-demo",
    "lectureId": "bio-101-lecture-3",
    "lectureTitle": "Biology 101: inside the cell",
    "subsectionId": "organelles",
    "subsectionTitle": "Organelles and their jobs",
    "depth": "standard"
  },
  "drive": [
    { "click": "[data-choice=golgi]" },
    { "click": "[data-choice=mitochondrion]" },
    { "click": "[data-action=next]" },
    { "relaunch": true },
    { "waitForText": "[data-view=check]", "text": "Welcome back" },
    { "click": "[data-action=hint]" },
    { "waitForText": "[role=status]", "text": "messenger RNA" },
    { "click": "[data-choice=ribosome]" },
    { "click": "[data-action=next]" },
    { "click": "[data-choice=golgi]" },
    { "click": "[data-action=next]" },
    { "click": "[data-action=finish]" },
    { "expect": "complete" }
  ]
}
```

`assets/tasks.json` has this shape:
`{ "tasks": { "<taskId>": { "title", "intro", "questions": [ { "id", "prompt", "choices": [ { "id", "label" } ], "answer", "hint" } ] } }, "sample": { …same as one task… } }`.

Now build the add-on I describe next.

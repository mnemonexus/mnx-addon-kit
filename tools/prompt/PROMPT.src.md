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
{{file:templates/experience/manifest.json}}
```

`src/exercise.ts`:

```ts
{{file:templates/experience/src/exercise.ts}}
```

`src/main.ts`:

```ts
{{file:templates/experience/src/main.ts}}
```

`scenarios/study.json`:

```json
{{file:templates/experience/scenarios/study.json}}
```

`assets/tasks.json` has this shape:
`{ "tasks": { "<taskId>": { "title", "intro", "questions": [ { "id", "prompt", "choices": [ { "id", "label" } ], "answer", "hint" } ] } }, "sample": { …same as one task… } }`.

Now build the add-on I describe next.

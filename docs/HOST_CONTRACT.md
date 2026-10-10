# MnemoNexus host contract (protocol 1)

This is how the MnemoNexus app runs an add-on, written down from the app's own
source on 2026-10-10. The app's source is private; this file is the public
statement of what it does. **Treat it as the source of truth.** Where it is
silent, don't guess: write the question in `docs/HOST_GAPS.md`.

Sections marked **PROPOSED** describe changes the app does not have yet. Code
written against them must feature-detect and still work without them.

Files in `reference/` are exact copies of what the app uses:

| File | What it is |
|---|---|
| `reference/frame.html` | The document the app loads into the add-on's frame (`srcdoc`), for packs without the `network` permission. |
| `reference/frame-network.html` | The same with `network`. Only the CSP line differs. |
| `reference/primitives.css` | The stylesheet the app injects into every frame (the `styles` field of `init`). |
| `sdk/` | `@mnemonexus/addon-sdk` 0.1.0: protocol types, `getExperienceHost()`, `buildPack()`. |
| `examples/reference-addon/` | The smallest working add-on (a calendar Experience). |

---

## 1. What an add-on is

A `.mnxpack` is a ZIP holding:

- `pack.json`: the manifest (section 7). The builder adds sizes, hashes and `contentHash`.
- one code file under `code/` (conventionally `code/main.cjs`): a single plain
  browser script. Bundle everything into it (IIFE). It is **not** loaded as a
  module, and there is no `require` table in the sandbox, so `react`, `three`
  and so on must be bundled in if you use them.
- optional files under `assets/`, each declared in the manifest.

The app refuses packs with undeclared files, stale hashes, bad paths or anything
over the limits:

| Limit | Value |
|---|---|
| Code file | 1 byte to 8 MiB |
| Whole pack (compressed) | 256 MiB |
| Everything uncompressed | 512 MiB |
| `pack.json` | 512 KiB |
| Assets | 4096 |
| Path length | 256 characters, canonical (no `..`, `.`, empty parts, `\`, `%` or control characters) |

Kinds: `experience` (a launchable activity; everything below is mostly about
these), `recall-face`, `index-view` (a long-lived lens over the Knowledge Index),
`knowledge-set`, `automation-template` (data only, no code view).

`entry` is required for every kind, with at least 1 byte of code. Data-only
kinds ship a minimal script.

Users install a pack in the app with **Add-ons → Install from file**.

## 2. The sandbox

The app mounts the add-on as:

```html
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="…reference/frame.html…">
```

**The web engine.** The desktop app is built with Tauri.

- On Windows, the only platform it ships on today, add-ons run in **Microsoft
  Edge WebView2**: Chromium, installed as the evergreen runtime, so it updates
  itself with Edge.
- A macOS build, if one ships, would use **WKWebView**, the system's Safari
  engine.
- Firefox's engine is never used.

Build for **Chromium 111 or Safari 16.4 and later**. In practice Windows is far
newer. `color-mix()`, `:has()`, `:focus-visible`, `@property`, cascade layers
and alternative text in `content` (`content: "✓" / "correct"`) are all safe.

What follows:

- **Opaque origin.** No access to the parent page. `localStorage`,
  `sessionStorage` and IndexedDB **throw `SecurityError`**. Use `mnx.storage`.
- **CSP** (inside `frame.html`):
  `default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'`.
  With the `network` permission, `connect-src https:` and `img-src data: blob: https:`.
  - No `eval` or `new Function`. Libraries that compile code at runtime break.
  - No network at all without `network`. Even with it, data sources go through
    `mnx.externalApi` (section 5).
  - Fonts only as `data:` URLs. The app's own web fonts are not available inside
    the frame, so embed a font or use system fonts.
  - Images only as `data:` or `blob:`. Pack images arrive through `mnx.asset()`;
    turn them into `blob:` URLs.
  - No nested iframes, forms that submit, or plugins.
- The frame fills its slot: `html, body { margin: 0; height: 100% }` and
  `#root { height: 100% }`. Draw into `mnx.root`.
- **The frame is transparent.** Neither the iframe nor `frame.html` paints a
  background, so the app's surface shows through. Don't paint `body` unless you
  need a solid backdrop, such as a canvas.

## 3. Lifecycle (messages)

All messages are `postMessage` objects carrying `protocolVersion: 1`. Anything
else is ignored on both sides. Every message after `boot` carries the `runId`
from `init`, and the host ignores messages for any other run.

1. The frame script starts and posts `{kind:'boot'}`. It repeats every 50 ms
   (at most about 40 times) until `init` arrives, because the host may not be
   listening yet.
2. The host answers with `init`: `{kind:'init', runId, code, props, styles, tokens}`.
   - `runId` is new for every mount. It is not the same as `props.study.runId` (section 6).
   - `code` is the add-on's code file as text.
   - `styles` is `reference/primitives.css`.
   - `tokens` holds the CSS custom properties `primitives.css` reads, as the app
     currently computes them on its root. They follow the user's theme (light or
     dark, accent). The app sends every token `primitives.css` reads that the app
     defines; in practice that is the full set.
   - Tokens are read once, when the add-on opens. A theme change does not
     remount the frame; it shows at the next launch.
3. The frame applies the tokens to `:root`, appends the stylesheet, defines
   `window.mnx` (section 4), then loads `code` as a `blob:` script.
4. When it loads, the frame posts `{kind:'ready'}`. If it fails to load, it posts
   `{kind:'error', message}`. Uncaught errors and unhandled promise rejections
   after loading are also posted as `error`. **The host treats any `error` as a
   failed run** and shows a failure screen, so catch what you can recover from.
   `error` is final. (Today a `ready` that arrives after an `error` can bring the
   frame back. That is an app bug and is being fixed.)
5. During the run:
   - The add-on calls `mnx.complete(result)` (posts `complete`) or `mnx.exit()`
     (posts `exit`). Either ends the run from the user's point of view.
   - Only the first `complete` of a mount counts. Later ones are ignored.
     Surfaces normally close the frame after `complete` or `exit`; the study
     surface closes it straight after `complete`.
   - The host may post `{kind:'update', props}`. The frame swaps `mnx.props` and
     calls the `onUpdate` handler. The host sends it whenever the props object
     changes while the add-on runs, for example when the launching surface
     re-renders with a new item list. Handle `onUpdate`, or ignore it safely.
   - Bridge calls go out as `bridge-request` and come back as `bridge-response`
     (section 5). `bridge-response` carries `runId` too.
6. When the host unmounts the frame it posts `{kind:'dispose'}`. The frame
   empties `#root` and rejects pending bridge promises with
   `Error('The add-on was closed.')`.

Host-side safety rules, which a mock host must copy:

- accept messages only where `event.source` is this frame's `contentWindow`;
- check the shape and `protocolVersion`;
- drop messages whose `runId` doesn't match (except `boot`);
- validate every bridge payload before acting on it.

## 4. `window.mnx`

Defined before your code runs. Typed in `sdk/src/index.d.ts`. Get it with
`getExperienceHost()`, which also checks the launch is one you can handle.

| Member | Meaning |
|---|---|
| `protocolVersion` | `1` |
| `capabilities` | `study-examples-v1`, `study-storage-v1`, `study-section-v1`, `theme-v1`, `settings-v1`, `addon-learning-v1`, `source-media-v1`. Feature-detect with this. |
| `props` | What this run is about (section 6). |
| `root` | The element to draw into. |
| `complete(result)` | Finish the run with a result (section 6). |
| `exit()` | Leave without a result. |
| `onUpdate(fn \| null)` | Called with fresh props when the host replaces them. |
| `asset(path)` | `Promise<ArrayBuffer>`. Reads one of the pack's declared `assets/…` files. |
| `sourceAsset(id)` | `Promise<ArrayBuffer>`. Reads an advertised current-source image. Needs `knowledge:read`; accepts only the current source's opaque IDs (section 5). |
| `generate({prompt, system?, json?})` | `Promise<string>`, or parsed JSON when `json: true`. Needs `ai:generate`. |
| `storage.get/set/delete/keys` | Key/value strings. Needs `storage:local`. |
| `externalApi(apiId, opId, params?)` | Calls a data source this pack contributed. Needs `network`. |
| `selectConcept(conceptId)` | Index views only: tells the host the user picked a concept. |
| `theme`, `onTheme(fn \| null)` | The theme in force, and a callback after a new one is applied (section 11). |

## 5. The bridge (what the host does with each request)

Every request is a promise. A refusal **rejects** with `Error(message)`; it never
hangs. The payload shapes the host accepts:

- `asset`: `path` is a non-empty string.
- `source-asset`: `id` is a string of 1 to 128 characters.
- `ai`: `prompt` is a non-empty string; `system` (optional) is a string; `json` (optional) is a boolean.
- `storage`: `op` is one of `get`, `set`, `delete`, `keys`. Every op except
  `keys` needs a non-empty `key`, and `set` needs a string `value`.
- `external-api`:
  - `apiId` and `opId` are 1 to 128 characters;
  - `params` (optional) has at most 16 entries, keys of 1 to 64 characters, and
    values that are numbers or strings of at most 2000 characters.

Anything else is refused with "That request was not understood."

The host checks each request in this order: shape, then permission, then
ceiling, then the action. For storage, the permission comes before the size and
key limits.

**asset**
- Only paths the manifest declared.
- Resolves with an `ArrayBuffer` of exactly the file's bytes (transferred, not copied).
- Refusals:
  - an asset that isn't declared: `"<id>" did not declare "<path>".`
  - a bad path: `"<path>" is not a valid pack path.`
  - a pack with no files: `This add-on has no resident files.`
  - an evicted file: `"<path>" is not resident. The add-on may need reinstalling.`

**source-asset** (`knowledge:read`)
- Works in a learning preparation job and in the activity launched from one of
  its offers, over that source's images (`source.media`, section 9). Everywhere
  else, including a reviewed example opened by hand, every id is refused.
- Resolves with an `ArrayBuffer` of the image's bytes. They are copied before
  transfer, so the host keeps its own copy.
- Refusals, in this order:
  - a bad shape: `That request was not understood.`
  - without the permission: `This add-on did not request knowledge access.`
  - an id that isn't advertised for this frame: `This source image is not part of this activity.`

**ai** (`ai:generate`)
- The call goes to the user's **local** model. Expect it to be small and slow,
  and possibly unavailable. Handle rejection and keep prompts short.
- `system` is placed in front of `prompt`, separated by a blank line. It's one
  prompt, not separate chat roles.
- With `json: true`, and only when the trimmed reply starts with ```` ``` ````,
  the host strips that opening fence, an optional `json` after it (any case) and
  the whitespace that follows, plus a closing ```` ``` ````. Then it runs
  `JSON.parse`. If that fails, it refuses with "The model did not return valid JSON."
- There's a ceiling of **400 calls per add-on** for the life of the app page.
  After that, every call is refused with "This add-on has used its model-call
  allowance for this session."
- A call counts once it passes the permission check, before it runs, so a failed
  model call still counts. Calls refused for their shape or a missing permission
  don't count.
- Refusal without the permission: "This add-on did not request permission to generate."
- A failed model call gives the model service's own message, or "The model call failed."

**storage** (`storage:local`)
- Values are strings. At most 512 keys, and a value of at most 524,288 characters.
- **Outside study launches** it lives in memory for each add-on. It survives the
  frame remounting, but **not an app restart**.
- **In study launches** it is durable. It is scoped to
  `(workspaceId, study.runId, study.contextFingerprint)` and survives restarts.
  This is how a half-finished exercise resumes. The stored key includes the
  extension id as well as the study scope; outside study, storage is per
  extension id.
- `get` resolves `string | null`; `set` and `delete` resolve `true`; `keys` resolves `string[]`.
- Refusals:
  - without the permission: `This add-on did not request permission to store anything.`
  - a value too large: `That value is too large to store.`
  - 512 keys used: `This add-on has used all of its storage keys.`

**external-api** (`network`)
- Only for a data source this pack declared in `dataSources`. `apiId` is the
  source's `id` and `opId` is the op's `id` (section 7). The host applies the
  user's toggles, keys and rate limits. Keys never enter the frame.
- There's a ceiling of 120 calls per add-on for the life of the page.
- A call counts once it passes the permission and "did you contribute it"
  checks, before it runs.
- Refusals:
  - without the permission: `This add-on did not request network access.`
  - a source this pack didn't contribute: `This add-on did not contribute that data source.`
  - over the ceiling: `This add-on has used its data-call allowance for this session.`
  - a failed data call gives the data layer's own message, for example `Parameter "q" is required.`

## 6. Props and results (Experiences)

```ts
props = {
  kind: 'experience',
  extensionId: string,
  surface: 'standalone' | 'recall' | 'transferal' | 'calendar' | 'study',
  items: KnowledgeItem[],          // already filtered by your compatRule (below)
  permissions: Permission[],       // everything the manifest declared (no per-user grants yet)
  study?: StudyExperienceContext,  // present only when surface === 'study'
}

KnowledgeItem = {
  lineageId, itemId, conceptId, conceptTitle: string,
  conceptKind: string,          // 'entity'|'process'|'state'|'system'|'formula'|'named-model'|'other'; may grow
  descriptorType: string,       // e.g. 'definition','property','mechanism_step','cause','effect','equation',
                                //  'symbol_meaning','example','boundary','application','misconception',
                                //  'outcome','location','origin','purpose','function'; may grow
  descriptorStructure: string,  // 'single' | 'list' | 'sequence'
  text: string,
  structuredItems: string[],    // the list or ordered steps when structure is 'list' or 'sequence'
  tags: string[], discipline: string, practiceModes: string[], hasMedia: boolean,
}
```

Unknown vocabulary values must be tolerated, never guessed at.

**Which items an add-on gets:**

- On every surface, the host passes the candidate items through the `compatRule`.
- A `none` or `produces` binding always gets `[]`.
- If `surfaces.transferal.maxItems` is declared, items are capped at that on
  every surface.
- Study launches pass the current subsection's compatible knowledge items (section 9).

Every experience can be launched as `standalone` from the Experiences page.
Neither time limit (`surfaces.recall.maxSeconds`, a study task's `maxSeconds`) is
passed to the add-on or enforced.

**Result** (`mnx.complete(result)`):

```ts
{
  completed: boolean,
  elapsedSeconds: number,
  quality?: number,                       // 0-5 integer; REQUIRED on the recall surface
  completedStages?: string[],             // drives producedKnowledge unlocks
  itemCoverage?: Record<lineageId, number>, // 0-1: how well each item was handled
  proposedKnowledge?: {...}[],            // needs knowledge:propose + binding produces/transforms
  studyEvidence?: StudyExperienceEvidence // REQUIRED on the study surface
}
```

**On surfaces other than study, the host doesn't check the result's shape.** It
hands the result to the surface that launched the add-on:

- Recall reads `quality`.
- Only `completed: true` counts as a use.
- `completedStages` unlock authored knowledge (needs `knowledge:unlock-authored`).
- `proposedKnowledge` is dropped without `knowledge:propose`.

### The study surface (session mode)

This is where the add-on appears inside a study session, next to the current
subsection of a lecture.

**How it's offered.** The manifest lists reviewed example tasks in
`surfaces.study.tasks`. A task is offered while the session is on a ready, editable
subsection.

- **Suggested** means any `matchAny` phrase appears as whole words in the
  subsection's title, objective or text.
- Matching is case-insensitive, and punctuation counts as spaces.
- Other tasks stay available behind an "Experiences" menu.

**What the add-on is told:**

```ts
StudyExperienceContext = {
  version: 1,
  runId: string,               // `${extensionId}:${taskId}:${contextFingerprint}`: the same every time
                               //  for this subsection + task + add-on version, so drafts resume
  workspaceId: string,
  lectureId: string, lectureTitle: string,
  subsectionId: string, subsectionTitle: string,
  contextFingerprint: string,  // sha256 over the document, the subsection, the depth, the add-on's
                               //  version and contentHash, and the task. Opaque: compare, never parse
  depth: 'core' | 'standard' | 'deep',
  taskId: string, taskSchema: string,
}
```

Study launches receive `study.section` with the current subsection objective and
text, plus that subsection's compatible knowledge items. A reviewed-example
add-on may still bring its own content keyed by `taskId`; a learning contribution
receives its selected concrete task through `learningActivity` (section 9). A
learning launch is a study run whose task is the offer: `taskId` is the offer's
`id`, `taskSchema` is its activity's `payloadSchema`, and the time limit is the
activity's `maxSeconds`. `runId` and the evidence rules below are the same.

**What the host accepts back.** It validates the result exactly like this and
refuses the whole result if any check fails:

- `completed === true`
- `elapsedSeconds` is finite, at least 0 and at most 86,400
- `studyEvidence.runId === props.study.runId`
- `studyEvidence.taskId === props.study.taskId`
- `studyEvidence.contextFingerprint === props.study.contextFingerprint`
- `solvedStepIds`: 1 to 128 non-empty strings of at most 128 characters each
- `attempts`: an integer from 0 to 100,000
- `hintsUsed`: an integer from 0 to 100,000

**What it keeps.**

- Only `completed`, `elapsedSeconds` and `studyEvidence`. `quality` and the rest are dropped.
- It records practice only. No mastery credit, unlocks or knowledge proposals come from study runs.
- A task already completed for the same context reopens as completed, not as a new run.

**`window.mnx` must advertise both `study-examples-v1` and `study-storage-v1`**,
or `getExperienceHost()` refuses a study launch.

## 7. The manifest (`pack.json`)

The app validates with a strict schema (unknown keys are refused), then with
the deterministic rules below. Limits in brackets.

| Field | Rule |
|---|---|
| `schemaVersion` | `'mnxpack_manifest_v1'` |
| `id` | `^[a-z0-9]+(-[a-z0-9]+)*$`, 1 to 64 characters (a leading digit is fine) |
| `version` | semver (`1.2.3` or `1.2.3-beta.1`) |
| `kind` | `experience`, `recall-face`, `index-view`, `knowledge-set` or `automation-template` |
| `label` [1-80], `description` [1-500], `tagline?` [≤120, may be empty] | Shown in the Store. |
| `icon` [1-80] | A Font Awesome class, e.g. `fa-solid fa-flask`. |
| `author` [1-120] | Free text, shown as written. Not verified (see P2). |
| `packId?` | Groups add-ons installed together. Same format as `id`. |
| `subjects?` | Up to 16 strings [1-64] used to recommend the add-on. An empty entry is refused. |
| `knowledgeBinding` | `{mode:'none'}`, `{mode:'produces'}`, `{mode:'consumes', compatRule}` or `{mode:'transforms', compatRule}` |
| `surfaces` | Any of `study`, `recall`, `transferal`, `calendar` (below). |
| `learning?` | Version 1 schema and activity declarations from the public `/learning` module (section 9). Needs `kind:experience` and `knowledge:read`. |
| `settings?` | Up to 24 settings the app draws on the add-on's Settings tab (section 12). |
| `permissions` | Up to 16 entries from the permissions listed below. Repeats are allowed. |
| `producedKnowledge?` | Up to 256 `{key, frameId, statement, conceptTitle, descriptorType, tags?, unlockedBy}` (below) |
| `dataSources?` | Up to 6 declarative HTTPS request templates (needs `network`; below). |
| `presentation?` | `{fit:'content'\|'canvas'}`. Use `canvas` for full-bleed 3D. |
| `engines` | `{mnxSdk, three?}`, each a string of 1-64 characters. For `mnxSdk`, the host strips any leading `^ ~ > = <` and spaces, then reads the first number as the major. **That major must equal the host's protocol (1).** So `1.0.0`, `^1.0.0` and `>=1.2` are all accepted; `2.0.0` is refused. |
| `entry` | `{logicalPath:'code/…'}`. The builder fills in the size and hash. |
| `assets` | `[{logicalPath:'assets/…', mimeType?}]`. The builder fills in sizes and hashes. |
| `cover?` | `{pattern?, tone?, src?}`. `pattern` and `tone` are free strings [≤64]. `src` must be a declared asset. |

The permissions are `knowledge:read`, `knowledge:unlock-authored`,
`knowledge:propose`, `ai:generate`, `schedule:recall`, `schedule:calendar`,
`network`, `multiplayer`, `render:3d` and `storage:local`.

Surfaces (every number is a whole number):

- `study`: `{version:1, tasks:[{id, label[1-120], schema[1-120], matchAny:[2-100 chars]×1-16, maxSeconds 1-1800}]×1-32}`. Experiences only. Task ids are unique kebab-case.
- `recall`: `{maxSeconds 1-300, producesGrade:true}`. Needs `schedule:recall`, and the run must return `quality` 0-5.
- `transferal`: `{category:'application'|'integration'|'multiplayer'|'discovery', minItems 1-500, maxItems 1-500 and ≥ minItems}`. The binding must be `consumes` or `transforms`.
- `calendar`: `{defaultMinutes 1-1440, recurrable:boolean}`. Needs `schedule:calendar`.
- Only `experience` may declare `recall`, `transferal` or `calendar`.

Permissions must match what the manifest does, in both directions:

- `consumes` and `transforms` need `knowledge:read`; it is also allowed with a `learning` contribution. Otherwise `knowledge:read` without them is an error.
- `producedKnowledge` needs `knowledge:unlock-authored`, and that permission without a table is an error.
- `producedKnowledge` or `knowledge:propose` needs the binding `produces` or `transforms`.
- `dataSources` needs `network`.
- `engines.three` needs `render:3d`.
- No rule checks `schedule:recall` or `schedule:calendar` without the matching surface.

`automation-template` packs must be data only: no permissions, no surfaces,
binding `none`, plus a valid `automationTemplate` descriptor (checked strictly).
Only that kind may have one:

```
automationTemplate: { downloadUrl, platform, institution?, summary, domains, beforeUse }
```

- `downloadUrl`: an https URL with no username or password, or
  `/addons/automation/<kebab-case>.mnxautomation.json`. At most 2048 characters.
- `platform`: 1-80. `institution`: at most 120.
- `summary`: 1-12 strings of 1-180. `domains`: at most 24 strings matching `^[a-z0-9.-]+$`.
- `beforeUse`: 1-500.

**`producedKnowledge`** rows:

- Lengths: `key` 1-64, `frameId` 1-64, `statement` 1-2000, `conceptTitle` 1-240,
  `descriptorType` 1-64, `tags` up to 16 of 1-64.
- `unlockedBy` (1-64) is a stage id that the run reports in `completedStages`.
- A repeated `key` is an error. So is a blank `statement` or `unlockedBy`.

**`dataSources`** entries (each is checked strictly):

```
{ id: kebab-case 1-64, name: 1-120, description: 1-500,
  category: 'reference'|'language'|'papers'|'books'|'science'|'world-data'|'news'|'health'|'environment',
  docsUrl?: URL ≤512, keySignupUrl?: URL ≤512, sharedKey?: 1-512,
  auth: 'none'|'user'|'addon-shared', baseUrl: https URL ≤512,
  rateLimitPerMinute: integer 1-30, testParams?: {string: 1-256},
  ops: 1-6 × { id: kebab-case 1-64, label: 1-120, cacheTtlMs: integer 1-2,592,000,000, pick?: 1-200,
               request: { method: 'GET'|'POST', path: starts with "/" (1-512),
                          query?: {string: 1-512}, headers?: {string: 1-512}, body?: 1-8192 } } }
```

- `auth: 'addon-shared'` needs `sharedKey`. `auth: 'user'` needs `keySignupUrl`.
- Source ids are unique, and op ids are unique within a source.
- `POST` needs a `body`, and only `POST` may have one.
- Templates use `{param}` for call parameters and `{{key}}` for the user's key.
  Path parameters are percent-encoded, query and header values are left as
  text, and body values are JSON-escaped.
- `mnx.externalApi(apiId, opId, params)`: `apiId` is the source's `id` and
  `opId` is the op's `id`. The host namespaces the source as `<extensionId>--<id>`.
- The response is always parsed as JSON. Without `pick`, the whole parsed
  response is returned. `pick` is a dot path into it: each segment is an object
  key, or a whole-number index when the current value is an array. If a segment
  is missing, or the path runs into `null` or a plain value, the call fails with
  `The response had no "<pick>".`

**`compatRule`** (decides which knowledge items an add-on is given):

- A tree of at most 10 levels, with at most 16 children per node.
- Every node is `{kind, …fields, whenTrue, whenFalse}`, with `whenTrue` and
  `whenFalse` reasons [1-240 characters].
- Leaf kinds, and what each tests:
  - `always`: always true.
  - `hasConcept`: `conceptId` is non-empty.
  - `minTextLength {value}`: `text.trim().length >= value`, counted as JavaScript string length.
  - `minStructuredItems {value}`: `structuredItems.length >= value`.
  - `hasMedia {value: boolean}`: `hasMedia === value`.
  - `descriptorTypeIn`, `descriptorStructureIn`, `conceptKindIn`, `practiceModeIn`,
    `tagIn` and `disciplineIn`, each with `values` (1-64 strings). They match when
    **any** of the item's values is in `values`. `practiceModeIn` and `tagIn` read
    the item's lists; the others read a single field.
- Combinators: `allOf {rules}` passes when every child passes; it reports the
  first failure, or its own `whenTrue` when it passes. `anyOf {rules}` passes
  when any child passes; it reports the first pass, or its own `whenFalse` when
  it fails. `not {rule}` inverts its child and always reports its own reason.
- An unknown `kind`, or nesting deeper than 10, makes the item incompatible.
  The rule is applied on every launch surface (section 6).

A real study manifest, from Curly Arrow Ketcher (abridged):

```json
{
  "schemaVersion": "mnxpack_manifest_v1", "id": "curly-arrow-ketcher", "version": "0.2.0",
  "kind": "experience", "label": "Curly Arrow Ketcher", "icon": "fa-solid fa-flask",
  "description": "Complete reaction mechanisms by drawing electron-flow arrows on supplied, locked structures.",
  "author": "Curly Arrow Ketcher contributors", "subjects": ["chemistry", "organic chemistry"],
  "knowledgeBinding": { "mode": "none" },
  "surfaces": { "study": { "version": 1, "tasks": [
    { "id": "sn2-backside", "label": "SN2 backside attack", "schema": "curly-arrow-mechanism-v1",
      "matchAny": ["SN2", "bimolecular nucleophilic substitution"], "maxSeconds": 300 }
  ] } },
  "permissions": ["storage:local"],
  "engines": { "mnxSdk": "1.0.0" },
  "entry": { "logicalPath": "code/main.cjs" }, "assets": []
}
```

## 8. Looking native

- **Classes.** Use the classes in `reference/primitives.css`:
  - `primitive-button` with `--primary`, `--secondary`, `--ghost` or `--danger`, and `--sm`, `--md` or `--lg`;
  - `primitive-content-card` with `__header` and `__body`;
  - `primitive-badge`, `primitive-divider`, `primitive-empty-state`, `primitive-hero-header`, `primitive-icon-button`, and so on.

  Your own layout CSS goes in a `<style>` you add.
- **Colours.** Read colours through the tokens (`var(--…)` names used in
  `primitives.css`) so light and dark both work. Don't hard-code a palette.
- **Text.** Put untrusted text in with `textContent`, never `innerHTML`.

## 9. Source content and learning contributions

**Implemented: section content for study launches.** The host:

- advertises the capability `study-section-v1` in `mnx.capabilities`;
- sets `props.study.section = { objective: string, text: string }`, where `text`
  is the subsection's markdown (CommonMark with GitHub tables), at most 20,000
  characters;
- fills `props.items` with that subsection's knowledge items, at most 64.

This lets a general add-on (for example a process builder) build its exercise
from the lecture, instead of only from reviewed examples. Add-ons must check for
the capability and fall back without it.

**Implemented: `addon-learning-v1`.** An Experience may add a `learning`
manifest contribution (see `sdk/src/learning.d.ts` and `GUIDE.md`). It
requires `knowledge:read`; a learning Experience may use `knowledgeBinding:none`
because its own contribution supplies the tasks. The declaration contains bounded
schema definitions and activities referring to those schemas. Supported schema
keywords are the restricted subset in `JsonSchema`, not arbitrary JSON Schema.

The host runs a preparation job in the same opaque sandbox:

```ts
props = { kind: 'addon-job', extensionId, permissions, settings, source, attachments: [] }
// defineAddon calls extract(source, host), then offerActivities({source, attachments}, host).
// Result: {completed:true, elapsedSeconds:0, learningPreparation:{attachments, offers}}
```

`source` includes workspace/lecture/subsection identity, a source fingerprint,
objective, at most 20,000 characters of text, up to 64 knowledge items, source IDs
and advertised local image IDs/MIME types. No private app paths or model keys are
provided. Up to eight available data/blob images of at most 8 MiB each may be
read with `sourceAsset`; unsupported or unavailable images are omitted.

The details, from the app's source:

- **`knowledge`** is the subsection's knowledge items, the first 64. It is not
  filtered by the add-on's `compatRule`.
- **`sourceRefs`** holds the subsection's id, the ids of its text blocks and the
  `lineageId` of each knowledge item, without repeats.
- **`fingerprint`** is a lowercase hex SHA-256 over the workspace, the lecture and
  its generation time, the subsection, the knowledge, the reading depth and the
  media.
- Both are opaque: compare them, never parse them.
- **`media`**: the host takes the first 8 figures that belong to the current
  subsection, then keeps those that are local (`data:image/…` or `blob:`; never a
  remote URL or a file path), report any `image/*` content type (there is no
  fixed list), and are at most 8 MiB. Figures it can't read are left out without
  a message. The limit of 8 applies before the filtering.
- **The frame is built like any other.** A job's props include `settings` (the
  user's values, section 12), `init` carries the theme (section 11), and the Model
  calls switch applies to `generate` in a job too.

Attachments carry a declared schema ID, validated payload, source references
and knowledge references. Offers carry a declared activity ID, concrete payload,
those references, prerequisite knowledge IDs, estimated duration and a content
kind: `source-task` or `concept-example`. References must exist in the supplied
source. The host validates both fresh and cached preparations and keeps them
separate by workspace, source fingerprint, plugin version/content hash and schema
declaration. Jobs time out after 30 seconds; failed jobs cannot block text study.
The first release passes each plugin its own extracted attachments. Cross-plugin
attachment consumption is not implemented.

In Session Mode, Continue from reading selects one eligible offer after reading
and before checks. Source tasks rank before related examples; unmet prerequisites
withhold an offer. Users can skip. The chosen offer and status are persisted; an
open activity resumes. Launch props add `learningActivity: {offer, source}` alongside
the existing `study` context, whose task is the offer (section 6). Completion returns scoped `studyEvidence` and grants
practice evidence only. Skip/completion advance the underlying session; a manually
opened example returns to its existing checkpoint. No offer means normal study.

Curly Arrow Ketcher currently maps explicit supported mechanism assertions to
authored related examples. It does not reconstruct exact lecture molecules.
Process Builder uses explicit source sequences. Neither completion grants blanket
mastery or modifies canonical knowledge. Recall is an available declaration type
for future scheduling; automatic preparation/placement currently runs in study.

The kit's `bun run new --learning`, `dev`, `check` and `pack` commands, and
`addons/process-builder`, show the authoring workflow. The kit's mock host is a
stand-in; the private app separately checks real pack integrity and session
integration.

### PROPOSED (not in the app yet)

**P2: Official publisher signature.**

- The "Official, by MnemoNexus" badge will mean the pack carries a valid ed25519
  signature from the MnemoNexus key. The app will ship the public key.
- The signature covers `mnxpack-signature-v1:<contentHash>`. Because `contentHash`
  covers the manifest, which carries every file's hash, it covers the whole pack.
- Format: `{alg:'ed25519', keyId, contentHash, signature:<base64>}`.
  - `keyId` is the first 16 hex characters of SHA-256 over the raw 32-byte public key.
  - `signature` is standard base64.
  - Keys are PEM files: PKCS#8 for the private key, SPKI for the public key.
- **Today the app refuses packs with undeclared files**, so the signature can't go
  inside the ZIP yet. Until the app accepts a `pack.sig.json` entry, signatures
  are a detached `<pack>.sig.json` file.
- Every other pack shows its `author` text as written, with no badge.
- Keep the private key outside repositories and shared development environments.

## 10. Validation scope

The kit validates manifests and results against this contract. It also scans
bundles and runs browser scenarios. These checks help find compatibility
problems before installation; they cover the scenarios supplied by the author.
The app independently validates pack integrity, permissions and launch state.

See [compatibility notes](HOST_GAPS.md) for mock-host limitations.

## 11. Theme v1 (in the app since 2026-10-10)

The host advertises `theme-v1` in `mnx.capabilities`. It gives the add-on the
user's look as a fixed set of tokens, so an add-on can look like part of the app
without seeing its stylesheet. P1 (section 9) also shipped on the same day: the
host now advertises `study-section-v1` and does what section 9 describes.

**What is shared, and what is not.** Colours, the data palette, corners, whether
surfaces are edged with lines, shadows or both, fonts and motion. The app's glass
material, its full shadow system and its page layout are not shared. Shadows here
are one simple shadow.

**How it arrives.**

- `init` carries `theme: AddonTheme` next to `tokens`, and the frame applies it
  before your code runs.
- When the look changes while the add-on is open, the host sends
  `{kind:'theme', protocolVersion, runId, theme, tokens}`. The user may have
  switched light and dark, recoloured the app, or changed this add-on's
  Appearance setting. The frame applies it in place. Nothing is remounted, so
  nothing your add-on holds is lost.
- `tokens` is the `primitives.css` set, now taken from the theme. So the
  primitive classes follow the theme too, including dark mode.

```ts
AddonTheme = {
  version: 1,
  scheme: 'light' | 'dark',
  edges: 'lines' | 'shadows' | 'both' | 'none',
  reducedMotion: boolean,
  backdrop: 'transparent' | 'solid',
  tokens: Record<string, string>,   // every name below
}
```

**What the frame does with it.** On `<html>` it:

- sets every token as a custom property;
- sets `data-mnx-scheme` (`light` or `dark`), `data-mnx-edges`,
  `data-mnx-motion` (`full` or `reduced`), `data-mnx-backdrop`, and
  `color-scheme`;
- sets `font-family: var(--mnx-font)` and `color: var(--mnx-text)` as defaults.
  Your own styles override them.

With `backdrop: 'solid'`, the frame paints `--mnx-canvas` behind everything.
Otherwise it stays transparent over the app's surface.

`mnx.theme` is the theme in force. `mnx.onTheme(fn | null)` is called after a
new theme has been applied. CSS that reads the tokens needs nothing more; use the
callback for canvases and charts that copied a colour into JavaScript.

**Fonts.** The frame can't load the app's font files, so the host sends Lexend
Deca (400, 500, 600) and IBM Plex Mono (400) as `data:` `@font-face` rules at the
top of `styles`. Every font token ends in system fonts.

**The tokens.** All values are valid CSS. Colours are usually hex; some are
`color-mix()` or `rgba()`. Every engine the app runs add-ons in supports both
(section 2).

| Token | Use |
|---|---|
| `--mnx-canvas` | The page colour behind surfaces. Painted for you when `backdrop` is `solid`. |
| `--mnx-surface` | Cards and panels. |
| `--mnx-surface-2` | A surface inside a surface (a step toward the text colour, never a border). |
| `--mnx-text`, `--mnx-text-muted`, `--mnx-text-subtle` | Text, from strongest to faintest. |
| `--mnx-border` | The outline of a surface. |
| `--mnx-border-inner` | Dividers and field borders inside a surface. |
| `--mnx-accent`, `--mnx-accent-strong` | The accent, and a stronger shade for hover and pressed states. |
| `--mnx-accent-text` | Text on an accent fill (black or white, whichever reads better). |
| `--mnx-accent-soft` | A tinted background, such as a selected row. |
| `--mnx-secondary` | The secondary colour. |
| `--mnx-success`, `--mnx-warning`, `--mnx-danger`, `--mnx-neutral` | Status. Never use these as data colours. |
| `--mnx-focus` | The focus ring. |
| `--mnx-data-1` … `--mnx-data-10` | Data colours, for things told apart by colour. With the user's "More colours" off, they are shades of the accent. Cycle through them in order. |
| `--mnx-radius-surface`, `--mnx-radius-overlay`, `--mnx-radius-button`, `--mnx-radius-field`, `--mnx-radius-chip` | Corner radii in px. `0px` is common: many users choose square corners. |
| `--mnx-edge-width`, `--mnx-edge-color` | The surface outline. `0px` and `transparent` when lines are off. Use `border: var(--mnx-edge-width) solid var(--mnx-edge-color)`. |
| `--mnx-shadow` | The surface shadow, or `none` when shadows are off. |
| `--mnx-shadow-overlay` | A stronger shadow for menus and popovers, always present. |
| `--mnx-font`, `--mnx-font-heading`, `--mnx-font-mono` | Font stacks. |
| `--mnx-duration` | Transition length: `160ms`, or `0ms` with reduced motion. |

New tokens may be added. None will be renamed or removed within version 1.

**Where the values come from.** By default ("Match MnemoNexus"), they are the
user's own colours for the app's current mode, with their corners and edges, and
`backdrop: 'transparent'`. A user can instead give one add-on a custom look:

- the light or dark MnemoNexus default colours;
- an accent of their choice;
- corners that are square (0px), soft (8px surfaces) or round (16px surfaces), the
  other kinds in proportion;
- lines, shadows or both;
- `backdrop: 'solid'`.

A custom look offers lines, shadows or both; `edges: 'none'` comes only from
Match. A custom look uses the default scheme of its mode (below). Its accent is
the user's choice, or the app's accent for that mode when they leave it on the
first swatch.

Design for any combination. Test light and dark, square and round, and lines
and shadows.

**The default values and formulas.** The values are always the user's own, so
never depend on one. These are the app's defaults and how it derives each token;
the kit's mock host uses them.

The default schemes:

| Role | Light | Dark |
|---|---|---|
| canvas | `#f8fafc` | `#0b0e14` |
| surface | `#ffffff` | `#161b22` |
| text | `#0f172a` | `#c9d1d9` |
| textMuted | `#64748b` | `#8b949e` |
| border (outline and inner) | `#e2e8f0` | `#30363d` |
| accent | `#2f7b5e` | `#4ade80` |
| secondary | `#0f766e` | `#2dd4bf` |
| success | `#2caf69` | `#26ff93` |
| warning | `#c9802b` | `#c9802b` |
| danger | `#ef4444` | `#ef4444` |
| neutral | `#64748b` | `#8b949e` |

The data palette:

- light: `#6366f1 #0ea5e9 #f97316 #10b981 #e11d48 #f59e0b #8b5cf6 #14b8a6 #d946ef #65a30d`
- dark: `#818cf8 #38bdf8 #fb923c #34d399 #fb7185 #fbbf24 #a78bfa #2dd4bf #e879f9 #a3e635`

How each token is derived:

- `--mnx-surface-2`: `color-mix(in srgb, <text> 4%, <surface>)` in light, 6% in dark.
- `--mnx-text-subtle`: textMuted at alpha 0.72.
- `--mnx-accent-strong`: the accent with its HSL lightness 10 points lower in
  light and 10 higher in dark, clamped to 0-100.
- `--mnx-accent-text`: `#0b0e14` when the accent's relative luminance is above
  0.4, otherwise `#ffffff`.
- `--mnx-accent-soft`: the accent at alpha 0.12 in light, 0.18 in dark.
- `--mnx-focus`: the accent.
- `--mnx-edge-width`: the user's line width (1-3 px), or `0px`.
- `--mnx-edge-color`: the border colour at the user's line strength (10-100%),
  or `transparent`.
- `--mnx-shadow`, with strength `s` from 0.1 to 4 (the user's percentage / 100)
  and each alpha capped at 0.9:
  - light: `0 1px 2px rgba(15,23,42,0.06·s), 0 6px 18px rgba(15,23,42,0.08·s)`;
  - dark: `0 1px 2px rgba(0,0,0,0.35·s), 0 6px 18px rgba(0,0,0,0.28·s)`;
  - `none` when shadows are off.
- `--mnx-shadow-overlay`: the same formula with `s = min(max(s, 1) × 1.6, 4)`, so
  it is always present.
- `--mnx-duration`: `160ms`, or `0ms` with reduced motion.
- `--mnx-data-N`: with "More colours" on, palette slot N. With it off,
  `color-mix(in srgb, <accent> P%, <surface>)`, where P for slots 1-10 is 100, 55,
  82, 38, 92, 66, 46, 74, 30, 60.
- Radii in a custom look: surfaces and overlays get the master value (0, 8 or
  16 px). Buttons and fields get 0.6 of it, chips 0.45, each rounded to a whole
  pixel.
- Fonts: `--mnx-font` and `--mnx-font-heading` are
  `'Lexend Deca', system-ui, -apple-system, 'Segoe UI', sans-serif`;
  `--mnx-font-mono` is `'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace`.

**The `primitives.css` tokens.** The host maps these from the theme; the rest
(spacing, type sizes and so on) still come from the host root.

| `primitives.css` token | Theme token |
|---|---|
| `--color-bg` | canvas |
| `--color-surface` | surface |
| `--color-surface-raised` | surface-2 |
| `--color-border` | border-inner |
| `--color-border-strong` | border |
| `--color-text`, `-muted`, `-subtle` | text, text-muted, text-subtle |
| `--ink-soft` | text-muted |
| `--color-primary` | accent |
| `--color-primary-dark` | accent-strong |
| `--color-primary-dim` | accent-soft |
| `--color-primary-text` | accent-text |
| `--color-secondary`, `--color-secondary-dim` | surface-2 |
| `--color-secondary-text` | text |
| `--color-error`, `--color-danger` | danger |
| `--color-danger-dim` | `color-mix(in srgb, <danger> 14%, transparent)` |
| `--color-action-danger-text` | `#ffffff` |
| `--font-body` | font |
| `--font-title`, `--font-heading-primary` | font-heading |
| `--shadow-sm`, `--shadow-md`, `--shadow-hover` | shadow |
| `--shadow-focus` | `0 0 0 2px <surface>, 0 0 0 4px <focus>` |

The `--primitive-*-color` hooks are deliberately **not** set: they are
per-element (`data-color`), and a global value would break every badge's
fallback.

## 12. Settings v1 (in the app since 2026-10-10)

The host advertises `settings-v1`. An add-on may declare settings in its
manifest. The app draws them, in its own controls, on the add-on's **Settings**
tab in the Store. The add-on decides which settings exist, not how the page
looks.

**The manifest field.** `settings?`: a JSON array of at most 24 field objects,
each checked strictly. Any kind may declare settings, and every installed add-on
gets the Settings tab.

```
{ id, label: 1-80, description?: 1-240, type, …by type }
  id: 1-64, ^[a-z][a-zA-Z0-9-]*$, unique within the add-on

type 'toggle': { default: boolean }
type 'choice': { options: 2-12 × {value: 1-64, label: 1-80}, default: one of the values }
                 option values are unique
type 'number': { min, max, step?: > 0, unit?: 1-16, default }
                 finite numbers, max > min, min ≤ default ≤ max
type 'text':   { default?: ≤ 2000, maxLength?: integer 1-2000, placeholder?: 1-120 }
                 default is no longer than maxLength (500 when maxLength is absent)
```

There is no secret type, because a value given to an add-on enters its frame. A
key the add-on needs belongs in a data source with `auth: 'user'` (section 7).
The app asks the user for that key and never shows it to the add-on.

**What the add-on receives.** `props.settings` is an object with every declared
`id`. Each holds the user's value when it is still valid for the field as now
declared, and the default otherwise. An update that narrows a field (drops an
option, shrinks a range) never hands over an impossible value. A text value is
cut to `maxLength`. When the user changes a setting while the add-on is open,
fresh props arrive through `update` (`mnx.onUpdate`). An add-on that declares
nothing gets `{}`. Only add-ons that run in a frame receive the values:
Experiences, index views and learning preparation jobs (section 9).

**What the app adds to every add-on's Settings tab.** Add-ons can't change these:

- **Appearance:** "Match MnemoNexus" or "Custom" (section 11).
- **Model calls**, when the add-on has `ai:generate`: "MnemoNexus AI" or "Off".
  With "Off", every `generate` call is refused with `Model calls are turned off
  for this add-on in its settings.`
  - The check comes after the permission check and before the ceiling, so a
    refused call doesn't count.
  - Handle it like any refusal: carry on without the model.
- **Data sources**, when the add-on contributes any: a link to their keys and
  limits in the app's settings.
- **Offer in session mode**, when the add-on has a `study` surface or a `learning`
  contribution. When it's off, session mode neither offers nor places it.
- **What it can do:** the declared permissions, in plain language.
- **Reset to defaults.**

An add-on installed from a file also gets a Store page and this tab.

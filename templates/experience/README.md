# Quick Check

A short multiple-choice check, and the kit's starter add-on. `bun run new <id>`
copies this folder to `addons/<id>`.

It runs on three surfaces:

| Surface | Content |
|---|---|
| `study` | Reviewed questions from `assets/tasks.json`, looked up by the study task id. |
| `recall` | Up to three questions in 60 seconds. Returns `quality` 0-5. |
| `standalone` | "Which concept does this describe?", built from the knowledge items. Sample questions when there are none. |

## Permissions

| Permission | Why |
|---|---|
| `knowledge:read` | To receive knowledge items (the `consumes` binding). |
| `storage:local` | To save a draft, so a half-finished check resumes. |
| `ai:generate` | To ask the local model for a hint. Falls back to the built-in hint. |
| `schedule:recall` | To appear on the recall surface. |

## Settings

`manifest.json` declares one setting, `showHints` ("Show the Hint button"). The
app draws it on the add-on's Settings tab and passes it in `props.settings`.
When the user changes it while the check is open, the add-on gets `update` and
shows or hides the Hint button without starting over.

## Look

It is drawn with the UI library (`@mnemonexus/addon-ui`): `installUi()` once,
then `mnx-*` classes such as `mnx-card`, `mnx-choice` and `mnx-feedback`. It has
no CSS of its own, so it follows every theme the user picks.
`bun run check quick-check --screenshots` saves it in the theme matrix and
fails any text that is hard to read.

## Files

```
manifest.json         what the add-on is and may do
src/main.ts           lifecycle, drafts, hints, UI (from @mnemonexus/addon-ui)
src/exercise.ts       where questions come from
assets/tasks.json     reviewed study content, keyed by task id
assets/illustration.svg
scenarios/*.json      launches for the mock host, with drive scripts
```

When you make it your own: change the questions and the UI, keep the habits
(feature detection, `textContent`, catching errors, a fallback for every bridge
call), update `matchAny` so your tasks are suggested in the right lectures, and
keep a scenario with a drive script for each surface.

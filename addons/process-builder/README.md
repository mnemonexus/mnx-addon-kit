# Process Builder

Rebuild a process whose order your lecture states explicitly. A learning add-on
(`addon-learning-v1`): MnemoNexus gives it the current subsection, it offers an
ordering task when the source states an order, and the app places that task in
a study session.

`bun run new <id> --learning` copies this folder as a starting point.

## How it decides

- **Sequence knowledge first:** an item whose `descriptorStructure` is
  `sequence`, with 3 to 12 steps.
- **Otherwise numbered steps:** one contiguous list `1.`, `2.`, `3.` … in the
  source text.
- **Otherwise nothing.** Unordered bullets, broken numbering, several lists, or
  plain prose give no task, rather than an invented order.

Opened directly (standalone), it uses a sequence item it was given, or says what
it needs.

## Permissions

| Permission | Why |
|---|---|
| `knowledge:read` | To receive the source and its knowledge items. |
| `storage:local` | To save the order so far, so a half-finished task resumes. |

## Files

```
manifest.json      the manifest, with the learning declaration (schemas and activities)
src/prepare.ts     extract + offerActivities: the preparation job
src/main.ts        defineAddon, and the ordering exercise
test/              unit tests for preparation, and the packed IIFE run as a job
scenarios/*.json   preparation jobs, an activity launch, and standalone launches
```

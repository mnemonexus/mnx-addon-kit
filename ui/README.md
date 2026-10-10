# @mnemonexus/addon-ui

Components that make a MnemoNexus add-on look like part of the app. Plain CSS
classes, no framework. They read **only** the theme v1 tokens (`--mnx-*`,
contract section 11), so they follow the user's look with no extra work:
light and dark, their colours and accent, square or round corners, lines,
shadows, both or none, a custom look, reduced motion and the data palette.
And they stay readable in all of those.

```ts
import { installUi } from '@mnemonexus/addon-ui';

installUi(); // once, before you draw
```

Then use the classes: `mnx-column`, `mnx-card`, `mnx-button mnx-button--primary`,
`mnx-choices` / `mnx-choice`, `mnx-field` / `mnx-input`, `mnx-badge`,
`mnx-chip`, `mnx-progress`, `mnx-steps`, `mnx-feedback--correct` and more. The
full list, with examples, is in [GUIDE.md section 10](../GUIDE.md#10-the-ui-library).
See every component in the current theme in the mock host's **UI gallery**
([`gallery/`](gallery/)).

| Import | What |
|---|---|
| `@mnemonexus/addon-ui` | `installUi()`, and `UI_CSS` (the stylesheet as text). |
| `@mnemonexus/addon-ui/tailwind.css` | The preset for Tailwind CSS 4. The kit adds it for you when your CSS uses Tailwind. |
| `@mnemonexus/addon-ui/tailwind-tokens.css` | The same tokens without removing Tailwind's palette. The kit uses it for an add-on that brings its own `tailwind.config`. |
| `@mnemonexus/addon-ui/tailwind-v3.css` | Tailwind 3's defaults and opacity utilities (`bg-opacity-50` …), which Tailwind 4 changed or removed. The kit adds it, with the tokens, for an add-on that brings its own `tailwind.config`. |
| `@mnemonexus/addon-ui/addon-ui.css` | The stylesheet as a file, for other build tools. |

## Working on the library

- Edit `src/addon-ui.css`, then run `bun run ui` to regenerate `src/css.mjs`
  (the stylesheet as a JavaScript string, because an add-on is one script).
  A test fails while the two disagree.
- `bun test ui` checks the rules the library keeps: only `--mnx-*` tokens, no
  colours of its own, surface edges only from the theme, every transition
  lasting `--mnx-duration`, and text only in the text colours.
- `bun run check ui-gallery --screenshots` renders every component in 18 looks
  and fails on text below the WCAG AA contrast ratio.

Version 0.1.0 is an unpublished local preview, like the SDK.

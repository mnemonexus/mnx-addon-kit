# Legacy Styles

An add-on styled the way older projects are, to show that the kit builds them
unchanged. It lists the host's knowledge items for the user to mark as
reviewed.

- **Tailwind 3**, with its own `tailwind.config.js` (an `extend`ed colour and a
  plugin), `@tailwind` lines, `@apply` in `@layer components`, and utilities
  Tailwind 4 removed: `bg-opacity-10`, `border-opacity-50`. The kit loads the
  config, keeps Tailwind's palette and gives back Tailwind 3's defaults.
- **Sass**: `src/Badge.module.scss` is a CSS module written in Sass, with a
  partial (`_palette.scss`), the old `@import`, nesting, and `darken()` and
  `mix()`. `src/main.ts` reads its class names from the import.

Like many ported projects it paints its own light card. Its fixed colours
then read the same in every theme, and `check --screenshots` passes in all 18
looks. `check` still warns about the palette classes: they don't follow dark
mode or the user's colours. A new add-on should use the `mnx` colours or the
UI library instead.

| Permission | Why |
|---|---|
| `knowledge:read` | To read the knowledge items it lists. |

```sh
bun run dev legacy-styles
bun run check legacy-styles --screenshots
```

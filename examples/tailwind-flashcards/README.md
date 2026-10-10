# Tailwind Flashcards

A small example of an add-on styled with [Tailwind CSS](https://tailwindcss.com)
4 and the MnemoNexus preset. It shows the host's knowledge items as flashcards.

- `src/styles.css` holds `@import "tailwindcss";`. `src/main.ts` imports it.
- The kit compiles Tailwind when it builds the add-on, adds the preset, and
  puts the CSS inside the add-on's one script.
- Use the `mnx` colours (`bg-mnx-surface`, `text-mnx-text`, `bg-mnx-accent`
  with `text-mnx-accent-text`), `rounded-mnx-*`, `shadow-mnx`, `border-mnx` and
  `font-mnx`. Tailwind's own palette (`bg-white`, `text-gray-500`) doesn't exist
  here, because it would ignore dark mode.

| Permission | Why |
|---|---|
| `knowledge:read` | To read the knowledge items it turns into cards. |

```sh
bun run dev tailwind-flashcards
bun run check tailwind-flashcards --screenshots
```

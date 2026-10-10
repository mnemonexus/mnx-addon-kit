# UI gallery

Every component of `@mnemonexus/addon-ui` on one page, in the current theme.

```sh
bun run dev ui-gallery          # or open /gallery from any add-on's mock host
bun run check ui-gallery --screenshots
```

Change the Appearance panel (light or dark, accent, corners, edges, More
colours, reduced motion, Match or Custom) and every component follows it.
`check --screenshots` saves the theme matrix and fails on text that is hard to
read in any of the themes it tries.

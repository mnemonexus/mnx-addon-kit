# Ketcher Editor

[Ketcher](https://github.com/epam/ketcher), EPAM's open-source chemical structure
editor, as a MnemoNexus add-on. It's here to show that porting an existing
open-source project works end to end, and what it takes. Ketcher is
Apache-2.0; it comes from npm (`ketcher-core` and `ketcher-react` 3.18.0) and
isn't copied into this repository.

The user draws a structure and presses **Done**. The add-on reads the drawing
in Ketcher's own format and completes the run.

```bash
npm install --prefix examples/ketcher-editor   # its own dependencies, about 250 MB
bun run dev ketcher-editor
bun run check ketcher-editor --screenshots
```

Like any ported project, it has its own `package.json`, so its dependencies
install here, not in the kit. Until they're installed, `check --all` skips it
and prints that command (CI installs them and checks it).

## What porting took

1. **Its own `package.json`**, with the npm packages at fixed versions.
2. **No Indigo.** Ketcher sends some work to Indigo, either a server or a
   WebAssembly build. The sandbox blocks both: no network without the
   `network` permission, and no WebAssembly (the CSP has no
   `'wasm-unsafe-eval'`). `src/struct-service.ts` tells Ketcher that Indigo
   isn't available, and `src/main.tsx` hides the buttons that need it.
   Explicit hydrogens can't be hidden that way, so Ketcher greys it out.
3. **The `browser` field** in `package.json` swaps three things out:
   - `paper` for `paper/dist/paper-core.js`. The full build includes a
     JavaScript parser that compiles code with `new Function`, which the
     sandbox blocks, so Ketcher failed as it loaded.
   - `miew-react` for nothing. That's the 3D viewer, 1.2 MiB; its button is
     hidden too.
   - Ketcher's 4 MB monomer library for an empty one (`src/no-monomers.js`).
     Only the macromolecules editor reads it, and this add-on turns that
     editor off.

   Without these, the bundle is 9.65 MiB, over the 8 MiB limit. With them
   it's 5.0 MiB.
4. **`@mnemonexus/addon-sdk/shims`**, imported first. Ketcher keeps its
   settings in `localStorage`, which throws in the sandbox; the shim keeps
   them in memory for the session. It also provides the `process` global
   that an older dependency expects.
5. **Readable element colours.** Ketcher colours element symbols the usual
   chemistry way, and some are too faint as text (sulfur is 2.6:1 on white).
   `src/readable.ts` darkens each just enough to reach 4.5:1, keeping its hue.
   `check --screenshots` found this.
6. **The kit's look around it.** The bar on top uses the UI library, and
   Ketcher's frame takes the theme's corners and edges. Ketcher paints its
   own light panels and canvas, so it looks the same in light and dark.

One fix needed no change here: Ketcher imports Node's `assert`. Bun's
built-in stand-in for it doesn't work as a function, so the kit uses the npm
`assert` package that Ketcher's dependencies install, as webpack did.

## What doesn't work here

- **Anything that needs Indigo:** Layout, Clean Up, Aromatize and
  Dearomatize, CIP, Check Structure, Calculated Values, explicit hydrogens,
  and file formats other than KET, Molfile/RXN and SMILES.
- **The Structure Library:** Ketcher fetches its template files from a URL.
  The sandbox allows no network.
- **Save as:** it downloads a file, and the frame's sandbox doesn't allow
  downloads.
- **The 3D viewer and the macromolecules editor:** left out on purpose.

## What `check` says

The static scan lists 73 findings in 21 dependencies, as one warning: things
like `localStorage` in `@mui/system` or `new Function` in `lodash`. They're
not errors, because a library often contains code an add-on never reaches,
or catches the error itself. The headless runs decide: both scenarios pass,
and their text is readable in all 18 looks.

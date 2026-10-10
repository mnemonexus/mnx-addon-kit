import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAddon, missingDependencies, usesTailwind } from '../src/addon';

const root = mkdtempSync(join(tmpdir(), 'mnx-build-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function addon(name: string, files: Record<string, string>) {
  const dir = join(root, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe('building an add-on', () => {
  it('swaps modules as the package.json "browser" field says, in dependencies too', async () => {
    const out = await buildAddon(addon('browser-field', {
      'package.json': JSON.stringify({ dependencies: { big: '1.0.0', viewer: '1.0.0' }, browser: { big: 'big/lite.js', viewer: false } }),
      'node_modules/big/package.json': JSON.stringify({ name: 'big', main: 'full.js' }),
      'node_modules/big/full.js': 'module.exports = "FULL-" + new Function("return 1")();',
      'node_modules/big/lite.js': 'module.exports = "LITE";',
      'node_modules/viewer/package.json': JSON.stringify({ name: 'viewer', main: 'index.js' }),
      'node_modules/viewer/index.js': 'require("big"); module.exports = { show: () => "VIEWER-3D" };',
      'src/main.ts': 'import big from "big";\nimport * as viewer from "viewer";\nconsole.log(big, viewer.show);',
    }));
    expect(out.errors).toEqual([]);
    expect(out.code).toContain('LITE');
    expect(out.code).not.toContain('FULL-');
    expect(out.code).not.toContain('VIEWER-3D');
    // Run it: the swapped-out module is empty, not missing.
    const logged: unknown[] = [];
    new Function('console', out.code!)({ log: (...args: unknown[]) => logged.push(...args) });
    expect(logged).toEqual(['LITE', undefined]);
  });

  it('swaps single files by path, inside dependencies and in the add-on', async () => {
    const out = await buildAddon(addon('browser-files', {
      'package.json': JSON.stringify({ dependencies: { lib: '1.0.0' }, browser: { 'lib/dist/data.js': './src/small-data.js', 'lib/dist/viewer.js': false, './src/node-only.ts': './src/web.ts' } }),
      'node_modules/lib/package.json': JSON.stringify({ name: 'lib', module: 'dist/index.js' }),
      'node_modules/lib/dist/index.js': 'import data from "./data.js";\nimport * as viewer from "./viewer.js";\nexport const info = () => [data, typeof viewer.show];',
      'node_modules/lib/dist/data.js': 'export default "HUGE-DATA";',
      'node_modules/lib/dist/viewer.js': 'export const show = () => "VIEWER";',
      'src/small-data.js': 'export default "small";',
      'src/node-only.ts': 'export const where = "NODE-ONLY";',
      'src/web.ts': 'export const where = "web";',
      'src/main.ts': 'import { info } from "lib";\nimport { where } from "./node-only";\nconsole.log(...info(), where);',
    }));
    expect(out.errors).toEqual([]);
    for (const gone of ['HUGE-DATA', 'VIEWER', 'NODE-ONLY']) expect(out.code).not.toContain(gone);
    const logged: unknown[] = [];
    new Function('console', out.code!)({ log: (...args: unknown[]) => logged.push(...args) });
    expect(logged).toEqual(['small', 'undefined', 'web']);
  });

  it('uses the add-on\'s own npm package for a Node module, rather than Bun\'s stand-in', async () => {
    const out = await buildAddon(addon('node-builtins', {
      'package.json': JSON.stringify({ dependencies: { assert: '2.0.0' } }),
      'node_modules/assert/package.json': JSON.stringify({ name: 'assert', main: './build/assert.js' }),
      'node_modules/assert/build/assert.js': 'module.exports = function assert(ok) { if (!ok) throw new Error("NPM-ASSERT"); };',
      'src/main.ts': 'import assert from "assert";\nassert(true);\nconsole.log(typeof assert);',
    }));
    expect(out.errors).toEqual([]);
    expect(out.code).toContain('NPM-ASSERT');
    const logged: unknown[] = [];
    new Function('console', out.code!)({ log: (...args: unknown[]) => logged.push(...args) });
    expect(logged).toEqual(['function']);
  });

  it('says so when a "browser" file does not exist', async () => {
    const out = await buildAddon(addon('browser-missing', { 'package.json': JSON.stringify({ browser: { 'lib/nope.js': false } }), 'src/main.ts': '' }));
    expect(out.ok).toBe(false);
    expect(out.errors.join('\n')).toContain('"lib/nope.js" is not a file');
  });

  it('lists an add-on\'s own dependencies that are not installed', () => {
    const dir = addon('uninstalled', { 'package.json': JSON.stringify({ dependencies: { here: '1.0.0', gone: '1.0.0' } }), 'node_modules/here/package.json': '{}' });
    expect(missingDependencies(dir)).toEqual(['gone']);
    expect(missingDependencies(addon('no-package', { 'src/main.ts': '' }))).toEqual([]);
  });

  it('bundles the UI library from the kit, whatever the package manager did', async () => {
    const out = await buildAddon(addon('ui', { 'src/main.ts': "import { installUi, UI_CSS } from '@mnemonexus/addon-ui';\ninstallUi();\nconsole.log(UI_CSS.length);" }));
    expect(out.errors).toEqual([]);
    expect(out.code).toContain('mnx-addon-ui');
    expect(out.code).toContain('.mnx-button--primary');
  });

  it('puts an imported stylesheet inside the script, guarded for a job with no document', async () => {
    const out = await buildAddon(addon('css', { 'src/main.ts': "import './look.css';", 'src/look.css': '.box { color: var(--mnx-text); }' }));
    expect(out.errors).toEqual([]);
    expect(out.code).toContain('.box { color: var(--mnx-text); }');
    // With no document it does nothing; with one, it adds the style.
    expect(() => new Function(out.code!)()).not.toThrow();
    const added: any[] = [];
    const document = { createElement: () => ({}), head: { appendChild: (node: any) => added.push(node) } };
    new Function('document', out.code!)(document);
    expect(added.map(node => node.textContent)).toEqual(['.box { color: var(--mnx-text); }']);
  });

  it('compiles Sass, finding imports in node_modules with or without ~', async () => {
    const out = await buildAddon(addon('sass', {
      'node_modules/old-theme/_vars.scss': '$brand: var(--mnx-accent);\n@mixin card { border-radius: 4px; }',
      'node_modules/old-theme/_reset.scss': '* { box-sizing: border-box; }',
      'src/look.scss': '@import "~old-theme/vars";\n@import "old-theme/reset";\n.panel { color: $brand; @include card; .title { font-weight: 600; } }',
      'src/indented.sass': '.note\n  color: var(--mnx-text)',
      'src/main.ts': "import './look.scss';\nimport './indented.sass';",
    }));
    expect(out.errors).toEqual([]);
    const code = out.code!;
    expect(code).toContain('box-sizing: border-box');
    expect(code).toMatch(/\.panel \{\s*color: var\(--mnx-accent\);\s*border-radius: 4px;/);
    expect(code).toContain('.panel .title');
    expect(code).toContain('.note {');
  });

  it('reports a Sass error with its place', async () => {
    const out = await buildAddon(addon('sass-error', { 'src/main.ts': "import './bad.scss';", 'src/bad.scss': '.a { color: $missing; }' }));
    expect(out.ok).toBe(false);
    expect(out.errors.join('\n')).toMatch(/Undefined variable/);
  });

  it('gives CSS modules unique class names, the same on every machine', async () => {
    const out = await buildAddon(addon('css-modules', {
      'src/card.module.css': '.card { color: var(--mnx-text); }\n.title { composes: card; font-weight: 600; }\n:global(.mnx-button) { margin: 0; }',
      'src/note.module.scss': '$gap: 8px;\n.note { padding: $gap; }',
      'src/main.ts': "import styles from './card.module.css';\nimport note from './note.module.scss';\nconsole.log(styles, note);",
    }));
    expect(out.errors).toEqual([]);
    const logged: any[] = [];
    const added: string[] = [];
    const document = { createElement: () => ({}), head: { appendChild: (node: any) => added.push(node.textContent) } };
    new Function('document', 'console', out.code!)(document, { log: (...args: unknown[]) => logged.push(...args) });
    const [styles, note] = logged;
    expect(styles.card).toMatch(/^card_[\w-]+$/);
    expect(styles.title).toBe(`${styles.title.split(' ')[0]} ${styles.card}`);
    expect(note.note).toMatch(/^note_[\w-]+$/);
    const css = added.join('\n');
    expect(css).toContain(`.${styles.card}`);
    expect(css).toContain('.mnx-button');
    expect(css).toContain('padding: 8px');
    // Built again, the names don't change.
    const again = await buildAddon(join(root, 'css-modules'));
    expect(again.code).toBe(out.code);
  });

  it('compiles Tailwind with the MnemoNexus preset', async () => {
    const out = await buildAddon(addon('tw', {
      'src/main.ts': "import './styles.css';\nexport const view = '<div class=\"bg-mnx-surface text-mnx-text rounded-lg shadow-md bg-mnx-accent/20 border-mnx bg-white text-gray-500\">';",
      'src/styles.css': '@import "tailwindcss";\n.title { @apply font-mnx-heading text-mnx-text; }',
    }));
    expect(out.errors).toEqual([]);
    const code = out.code!;
    expect(code).toContain('.bg-mnx-surface{background-color:var(--mnx-surface)}');
    expect(code).toContain('.text-mnx-text{color:var(--mnx-text)}');
    expect(code).toMatch(/\.rounded-lg\{border-radius:var\(--mnx-radius-surface\)\}/);
    expect(code).toContain('var(--mnx-shadow)');
    expect(code).toMatch(/\.border-mnx\{border-width:var\(--mnx-edge-width\);border-style:solid;border-color:var\(--mnx-edge-color\)\}/);
    expect(code).toMatch(/color-mix\(in oklab,\s*var\(--mnx-accent\) 20%,\s*transparent\)/);
    expect(code).toMatch(/\.title\{[^}]*font-family:var\(--mnx-font-heading\)/);
    // The default palette is gone: these would ignore dark mode.
    expect(code).not.toContain('.bg-white');
    expect(code).not.toContain('.text-gray-500');
    expect(code).not.toMatch(/url\(/);
  });

  it('reads Tailwind 3 directives as Tailwind 4', async () => {
    const out = await buildAddon(addon('tw3', {
      'src/main.ts': "import './styles.css';\nexport const view = 'p-4 bg-mnx-canvas';",
      'src/styles.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
    }));
    expect(out.errors).toEqual([]);
    expect(out.code).toContain('.bg-mnx-canvas{background-color:var(--mnx-canvas)}');
    expect(out.code).not.toContain('@tailwind');
  });

  it('keeps a ported project\'s own Tailwind config and palette', async () => {
    const out = await buildAddon(addon('ported', {
      'tailwind.config.js': "module.exports = { theme: { extend: { colors: { brand: '#123456' } } }, plugins: [function ({ addUtilities }) { addUtilities({ '.legacy-util': { 'text-decoration': 'underline' } }); }] };",
      'src/main.ts': "import './index.css';\nexport const view = 'bg-white text-gray-500 bg-brand legacy-util bg-mnx-surface';",
      'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
    }));
    expect(out.errors).toEqual([]);
    const code = out.code!;
    expect(code).toContain('.bg-white{');
    expect(code).toContain('.text-gray-500{');
    expect(code).toMatch(/\.bg-brand\{background-color:(#123456|var\(--color-brand\))\}/);
    expect(code).toContain('.legacy-util{text-decoration:underline}');
    expect(code).toContain('.bg-mnx-surface{background-color:var(--mnx-surface)}');
  });

  it('gives a Tailwind 3 project its defaults and opacity utilities back', async () => {
    const out = await buildAddon(addon('tailwind3', {
      'tailwind.config.js': 'module.exports = { content: ["./src/**/*.ts"] };',
      'src/main.ts': "import './index.css';\nexport const view = 'bg-red-500 bg-opacity-50 hover:bg-blue-500 text-gray-900 text-opacity-75 border border-gray-300 border-opacity-[.35] ring ring-blue-500 ring-opacity-40 divide-y divide-gray-200 divide-opacity-50 placeholder-gray-400 placeholder-opacity-60 !bg-white bg-[--brand] text-[--ink]';",
      'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
    }));
    expect(out.errors).toEqual([]);
    const code = out.code!;
    // Colour utilities read the opacity utilities, which set percentages.
    expect(code).toContain('.bg-red-500{background-color:color-mix(in oklab,var(--color-red-500) var(--tw-bg-opacity),transparent)}');
    expect(code).toContain('.bg-opacity-50{--tw-bg-opacity:calc(50 * 1%)}');
    expect(code).toMatch(/\.hover\\\\:bg-blue-500:hover\{background-color:color-mix\(in oklab,var\(--color-blue-500\) var\(--tw-bg-opacity\),transparent\)\}/);
    expect(code).toContain('color:color-mix(in oklab,var(--color-gray-900) var(--tw-text-opacity),transparent)');
    expect(code).toMatch(/border-color:color-mix\(in oklab,var\(--color-gray-300\) var\(--tw-border-opacity\),transparent\)/);
    expect(code).toMatch(/--tw-border-opacity:calc\(\.35 \* 100%\)/);
    expect(code).toContain('--tw-ring-color:color-mix(in oklab,var(--color-blue-500) var(--tw-ring-opacity),transparent)');
    expect(code).toMatch(/:where\(\.divide-gray-200>:not\(:last-child\)\)\{border-color:color-mix\(in oklab,var\(--color-gray-200\) var\(--tw-divide-opacity\),transparent\)\}/);
    expect(code).toMatch(/\.placeholder-gray-400::placeholder\{color:color-mix\(in oklab,var\(--color-gray-400\) var\(--tw-placeholder-opacity\),transparent\)\}/);
    expect(code).toMatch(/\.\\\\!bg-white\{background-color:color-mix\(in oklab,var\(--color-white\) var\(--tw-bg-opacity\),transparent\)!important\}/);
    // Not inherited, as in Tailwind 3.
    expect(code).toContain('@property --tw-bg-opacity{syntax:"<percentage>";inherits:false;initial-value:100%}');
    // Tailwind 3's defaults.
    expect(code).toContain('calc(3px + var(--tw-ring-offset-width))');
    expect(code).toMatch(/border-color:var\(--color-gray-200,currentcolor\)/);
    expect(code).toMatch(/button:not\(:disabled\),\[role=\\?"?button\\?"?\]:not\(:disabled\)\{cursor:pointer\}/);
    expect(code).not.toMatch(/@media \(hover:hover\)\{\.hover/);
    // bg-[--brand] meant var(--brand).
    expect(code).toContain('background-color:color-mix(in oklab,var(--brand) var(--tw-bg-opacity),transparent)');
    expect(code).toContain('color:color-mix(in oklab,var(--ink) var(--tw-text-opacity),transparent)');
  });

  it('leaves Tailwind 3\'s behaviour out without a tailwind.config, and still fixes [--var]', async () => {
    const out = await buildAddon(addon('tailwind4', {
      'src/main.ts': "import './index.css';\nexport const view = 'bg-mnx-surface bg-opacity-50 bg-[--brand] ring';",
      'src/index.css': '@import "tailwindcss";\n',
    }));
    expect(out.errors).toEqual([]);
    const code = out.code!;
    expect(code).toContain('.bg-mnx-surface{background-color:var(--mnx-surface)}');
    expect(code).not.toContain('tw-bg-opacity');
    expect(code).not.toContain('calc(3px');
    expect(code).toContain('background-color:var(--brand)');
  });

  it('turns images and fonts that code or CSS pulls in into data: URLs', async () => {
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const dir = addon('assets', {
      'src/main.ts': "import logo from './logo.svg';\nimport './look.css';\nexport const src = logo;",
      'src/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      'src/look.css': '.hero { background: url(./img/dot.png); } @font-face { font-family: X; src: url("fonts/x.woff2") format("woff2"); } .remote { background: url(https://example.com/a.png); }',
      'src/fonts/x.woff2': 'not really a font',
    });
    mkdirSync(join(dir, 'src/img'), { recursive: true });
    writeFileSync(join(dir, 'src/img/dot.png'), pixel);
    const out = await buildAddon(dir);
    expect(out.errors).toEqual([]);
    expect(out.code).toContain('data:image/svg+xml');
    expect(out.code).toContain(`data:image/png;base64,${pixel.toString('base64')}`);
    expect(out.code).toMatch(/\.hero \{ background: url\(\\?"data:image\/png/);
    expect(out.code).toContain('data:font/woff2;base64,');
    // A remote URL stays, so the static scan can report it.
    expect(out.code).toContain('url(https://example.com/a.png)');
  });

  it('explains a kit import that does not exist', async () => {
    const out = await buildAddon(addon('bad', { 'src/main.ts': "import '@mnemonexus/addon-ui/nope';" }));
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toContain('@mnemonexus/addon-ui has no export "./nope"');
  });

  it('knows which stylesheets use Tailwind', () => {
    expect(usesTailwind('@import "tailwindcss";')).toBe(true);
    expect(usesTailwind("@import 'tailwindcss' source(none);")).toBe(true);
    expect(usesTailwind('@tailwind utilities;')).toBe(true);
    expect(usesTailwind('.a { color: red; }')).toBe(false);
  });
});

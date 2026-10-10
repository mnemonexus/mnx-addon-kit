/**
 * Writes src/css.mjs, the stylesheet as a JavaScript string, from
 * src/addon-ui.css. An add-on is one script with no CSS files, so the styles
 * travel inside the code. Run `bun run ui` after editing addon-ui.css; a test
 * fails while the two disagree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CSS_SOURCE = join(here, '..', 'src', 'addon-ui.css');
export const CSS_MODULE = join(here, '..', 'src', 'css.mjs');

/** Drop comments and runs of whitespace: the text ships inside every add-on that uses it. */
export function compactCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};])\s*/g, '$1')
    .trim();
}

export function renderCssModule(css = readFileSync(CSS_SOURCE, 'utf8')) {
  return [
    '// Generated from addon-ui.css by `bun run ui`. Edit that file, not this one.',
    `export const UI_CSS = ${JSON.stringify(compactCss(css))};`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  writeFileSync(CSS_MODULE, renderCssModule());
  console.log(`Wrote ${CSS_MODULE}.`);
}

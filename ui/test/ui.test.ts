import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MNX_TOKENS } from '../../mock-host/src/core/theme';
import { CSS_MODULE, CSS_SOURCE, compactCss, renderCssModule } from '../scripts/build-css.mjs';
import { UI_CSS, UI_STYLE_ID, installUi } from '../src/index.mjs';

const css = readFileSync(CSS_SOURCE, 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
const TAILWIND = readFileSync(join(import.meta.dir, '..', 'src', 'tailwind.css'), 'utf8');
const TOKENS = readFileSync(join(import.meta.dir, '..', 'src', 'tailwind-tokens.css'), 'utf8');

/** Every rule as [selector, body]. The stylesheet has no at-rules. */
function rules(text: string): [string, string][] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => [match[1].trim(), match[2]]);
}

describe('the stylesheet', () => {
  it('is what src/css.mjs ships (run "bun run ui" if this fails)', () => {
    expect(readFileSync(CSS_MODULE, 'utf8')).toBe(renderCssModule());
    expect(UI_CSS).toBe(compactCss(css));
  });

  it('reads only the theme v1 tokens', () => {
    const used = new Set([...code.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]));
    const own = new Set([...code.matchAll(/(--mnx-ui-[\w-]+)\s*:/g)].map(match => match[1]));
    const known = new Set<string>(MNX_TOKENS);
    const unknown = [...used].filter(name => !known.has(name) && !own.has(name));
    expect(unknown).toEqual([]);
    // Its own helper properties are set from tokens, inside the library.
    for (const name of own) expect(code).toMatch(new RegExp(`${name}:\\s*var\\(--mnx-data-\\d+\\)`));
  });

  it('has no colour of its own', () => {
    expect(code.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(code.match(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi) ?? []).toEqual([]);
    const named = /(?<![\w-])(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|teal)(?![\w-])/gi;
    const declarations = rules(code).flatMap(([, body]) => body.split(';')).map(line => line.split(':').slice(1).join(':'));
    expect(declarations.flatMap(value => value.match(named) ?? [])).toEqual([]);
  });

  it('draws surface edges only from the theme', () => {
    const [, surface] = rules(code).find(([selector]) => selector.includes('.mnx-surface') && selector.includes('.mnx-card'))!;
    expect(surface).toContain('border: var(--mnx-edge-width) solid var(--mnx-edge-color)');
    expect(surface).toContain('box-shadow: var(--mnx-shadow)');
    expect(surface).toContain('border-radius: var(--mnx-radius-surface)');
    // No other rule gives a surface or card a border or shadow of its own.
    for (const [selector, body] of rules(code)) {
      if (!/\.mnx-(surface|card)(?![\w-])/.test(selector) || selector.includes('.mnx-card__')) continue;
      for (const line of body.split(';').map(part => part.trim()).filter(Boolean)) {
        if (/^(border|box-shadow)/.test(line) && !/var\(--mnx-(edge-width|edge-color|shadow)\)|^border-width: 0$|^box-shadow: none$|^border-radius/.test(line)) {
          throw new Error(`${selector}: ${line}`);
        }
      }
    }
  });

  it('follows reduced motion: every transition lasts --mnx-duration', () => {
    const transitions = rules(code).flatMap(([, body]) => body.split(';').filter(line => /^\s*transition\s*:/.test(line)));
    expect(transitions.length).toBeGreaterThan(0);
    for (const line of transitions) {
      for (const part of line.split(':')[1].split(',')) expect(part).toContain('var(--mnx-duration)');
    }
    expect(code).not.toMatch(/animation\s*:/);
  });

  it('includes the documented component classes', () => {
    const classes = [
      'mnx-button', 'mnx-button--primary', 'mnx-button--secondary', 'mnx-button--ghost', 'mnx-button--danger', 'mnx-button--sm',
      'mnx-surface', 'mnx-card', 'mnx-card__header', 'mnx-card__body', 'mnx-card__footer',
      'mnx-choices', 'mnx-choice', 'mnx-choice__key', 'mnx-choice__text',
      'mnx-field', 'mnx-label', 'mnx-input', 'mnx-select', 'mnx-textarea', 'mnx-help',
      'mnx-badge', 'mnx-chip', 'mnx-chip__dot',
      'mnx-progress', 'mnx-progress__fill', 'mnx-steps', 'mnx-step',
      'mnx-feedback--correct', 'mnx-feedback--incorrect', 'mnx-feedback--hint', 'mnx-empty', 'mnx-error',
      'mnx-column',
    ];
    for (const name of classes) expect(code).toMatch(new RegExp(`\\.${name}(?![\\w-])`));
    // Choice states: selected, correct and incorrect, focus, from a button or a native input.
    for (const state of ['[aria-pressed="true"]', ':has(input:checked)', '[data-state="correct"]', '[data-state="incorrect"]', ':focus-visible']) {
      expect(code).toContain(`.mnx-choice${state}`);
    }
    // Chips take each data colour.
    for (let n = 1; n <= 10; n++) expect(code).toContain(`.mnx-chip[data-color="${n}"]`);
  });

  it('keeps status colours and the data palette off text', () => {
    for (const [selector, body] of rules(code)) {
      const color = body.match(/(?:^|;)\s*color:\s*([^;]+)/)?.[1]?.trim();
      if (!color) continue;
      expect([`${selector}: ${color}`, ['var(--mnx-text)', 'var(--mnx-text-muted)', 'var(--mnx-accent-text)'].includes(color)])
        .toEqual([`${selector}: ${color}`, true]);
    }
  });
});

describe('installUi', () => {
  function fakeDocument() {
    const nodes: any[] = [];
    return {
      nodes,
      head: { get firstChild() { return nodes[0] ?? null; }, insertBefore(node: any, before: any) { nodes.splice(before ? nodes.indexOf(before) : 0, 0, node); } },
      createElement: (tag: string) => ({ tag, id: '', textContent: '' }),
      getElementById: (id: string) => nodes.find(node => node.id === id) ?? null,
    };
  }
  it('adds the stylesheet once, first in <head>', () => {
    const doc = fakeDocument();
    doc.nodes.push({ id: 'host-styles' });
    installUi(doc as any);
    installUi(doc as any);
    expect(doc.nodes.map(node => node.id)).toEqual([UI_STYLE_ID, 'host-styles']);
    expect(doc.nodes[0].textContent).toBe(UI_CSS);
  });
  it('does nothing without a document (a preparation job)', () => {
    expect(() => installUi(undefined as any)).not.toThrow();
  });
});

describe('the Tailwind preset', () => {
  it('maps every colour token, and nothing else', () => {
    const mapped = [...TOKENS.matchAll(/--color-mnx-([\w-]+):\s*var\((--mnx-[\w-]+)\)/g)].map(match => [match[1], match[2]]);
    const colours = MNX_TOKENS.filter(token => !/radius|edge-|shadow|font|duration/.test(token)).map(token => token.slice('--mnx-'.length));
    for (const name of colours) expect(mapped).toContainEqual([name, `--mnx-${name}`]);
    expect(mapped).toContainEqual(['edge', '--mnx-edge-color']);
  });
  it('removes Tailwind\'s palette first in the full preset, and keeps it in the tokens alone', () => {
    expect(TAILWIND.indexOf('--color-*: initial;')).toBeGreaterThan(-1);
    expect(TAILWIND.indexOf('--color-*: initial;')).toBeLessThan(TAILWIND.indexOf('@import "./tailwind-tokens.css"'));
    expect(TOKENS).not.toContain('initial');
  });
  it('maps radii, shadows, fonts and motion to tokens', () => {
    for (const line of ['--radius-lg: var(--mnx-radius-surface)', '--radius-mnx-chip: var(--mnx-radius-chip)', '--shadow-md: var(--mnx-shadow)',
      '--shadow-mnx: var(--mnx-shadow)', '--font-sans: var(--mnx-font)', '--font-mnx-heading: var(--mnx-font-heading)',
      '--default-transition-duration: var(--mnx-duration)']) {
      expect(TOKENS).toContain(line);
    }
    const values = [...TOKENS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--[\w-]+:\s*([^;]+);/g)].map(match => match[1].trim()).filter(value => value !== 'initial');
    for (const value of values) expect(value).toMatch(/^var\(--mnx-[\w-]+\)$|^solid$/);
  });
});

import { describe, expect, it } from 'bun:test';
import {
  DATA_PALETTE, DEFAULT_CHOICE, DEFAULT_SCHEMES, MNX_TOKENS, accentText, buildTheme, primitiveTokens, shadowAt, shiftLightness, type ThemeChoice,
} from '../src/core/theme';

const theme = (patch: Partial<ThemeChoice> = {}) => buildTheme({ ...DEFAULT_CHOICE, ...patch });

describe('theme v1 values (section 11)', () => {
  it('sets every token, from the app\'s default scheme', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const t = theme({ scheme }).tokens;
      expect(Object.keys(t).sort()).toEqual([...MNX_TOKENS].sort());
      const base = DEFAULT_SCHEMES[scheme];
      expect([t['--mnx-canvas'], t['--mnx-surface'], t['--mnx-text'], t['--mnx-text-muted'], t['--mnx-border'], t['--mnx-border-inner']])
        .toEqual([base.canvas, base.surface, base.text, base.textMuted, base.border, base.border]);
      expect(t['--mnx-accent']).toBe(base.accent);
      expect(t['--mnx-focus']).toBe(base.accent);
    }
    expect(theme().tokens['--mnx-canvas']).toBe('#f8fafc');
    expect(theme({ scheme: 'dark' }).tokens['--mnx-accent']).toBe('#4ade80');
  });
  it('derives the accent family', () => {
    const light = theme().tokens;
    expect(light['--mnx-accent-strong']).toBe(shiftLightness('#2f7b5e', -10));
    expect(light['--mnx-accent-soft']).toBe('rgba(47, 123, 94, 0.12)');
    expect(light['--mnx-accent-text']).toBe('#ffffff');
    const dark = theme({ scheme: 'dark' }).tokens;
    expect(dark['--mnx-accent-strong']).toBe(shiftLightness('#4ade80', 10));
    expect(dark['--mnx-accent-soft']).toBe('rgba(74, 222, 128, 0.18)');
    expect(dark['--mnx-accent-text']).toBe('#0b0e14');
    expect(theme({ accent: '#ff0000' }).tokens['--mnx-accent']).toBe('#ff0000');
  });
  it('moves HSL lightness by 10 points, clamped', () => {
    expect(shiftLightness('#808080', 10)).toBe('#9a9a9a');
    expect(shiftLightness('#ffffff', 10)).toBe('#ffffff');
    expect(shiftLightness('#000000', -10)).toBe('#000000');
    expect(accentText('#ffffff')).toBe('#0b0e14');
    expect(accentText('#000000')).toBe('#ffffff');
  });
  it('mixes surface-2 and text-subtle', () => {
    expect(theme().tokens['--mnx-surface-2']).toBe('color-mix(in srgb, #0f172a 4%, #ffffff)');
    expect(theme({ scheme: 'dark' }).tokens['--mnx-surface-2']).toBe('color-mix(in srgb, #c9d1d9 6%, #161b22)');
    expect(theme().tokens['--mnx-text-subtle']).toBe('rgba(100, 116, 139, 0.72)');
  });
  it('uses the palette, or accent shades with "More colours" off', () => {
    expect(theme({ scheme: 'dark' }).tokens['--mnx-data-3']).toBe(DATA_PALETTE.dark[2]);
    const off = theme({ moreColours: false }).tokens;
    expect(off['--mnx-data-1']).toBe('#2f7b5e');
    expect(off['--mnx-data-2']).toBe('color-mix(in srgb, #2f7b5e 55%, #ffffff)');
    expect(off['--mnx-data-10']).toBe('color-mix(in srgb, #2f7b5e 60%, #ffffff)');
  });
  it('rounds the radii from the master value', () => {
    const t = theme({ corners: 16 }).tokens;
    expect([t['--mnx-radius-surface'], t['--mnx-radius-overlay'], t['--mnx-radius-button'], t['--mnx-radius-field'], t['--mnx-radius-chip']])
      .toEqual(['16px', '16px', '10px', '10px', '7px']);
    expect(theme({ corners: 8 }).tokens['--mnx-radius-chip']).toBe('4px');
    expect(theme({ corners: 0 }).tokens['--mnx-radius-button']).toBe('0px');
  });
  it('draws edges and shadows from the user\'s strengths', () => {
    const lines = theme({ edges: 'lines', lineWidth: 2, lineStrength: 50 }).tokens;
    expect(lines['--mnx-edge-width']).toBe('2px');
    expect(lines['--mnx-edge-color']).toBe('rgba(226, 232, 240, 0.5)');
    expect(lines['--mnx-shadow']).toBe('none');
    const shadows = theme({ edges: 'shadows' }).tokens;
    expect([shadows['--mnx-edge-width'], shadows['--mnx-edge-color']]).toEqual(['0px', 'transparent']);
    expect(shadows['--mnx-shadow']).toBe('0 1px 2px rgba(15,23,42,0.06), 0 6px 18px rgba(15,23,42,0.08)');
    // Overlay: s = min(max(s, 1) × 1.6, 4), always present.
    expect(shadows['--mnx-shadow-overlay']).toBe(shadowAt('light', 1.6));
    expect(theme({ edges: 'lines' }).tokens['--mnx-shadow-overlay']).toBe(shadowAt('light', 1.6));
    // Each alpha is capped at 0.9.
    expect(shadowAt('dark', 4)).toBe('0 1px 2px rgba(0,0,0,0.9), 0 6px 18px rgba(0,0,0,0.9)');
    expect(theme({ edges: 'both', scheme: 'dark', shadowStrength: 400 }).tokens['--mnx-shadow-overlay']).toBe(shadowAt('dark', 4));
  });
  it('gives a custom look lines, shadows or both; "none" only from Match', () => {
    expect(theme({ mode: 'custom', edges: 'none' }).edges).toBe('lines');
    expect(theme({ mode: 'match', edges: 'none' }).edges).toBe('none');
    expect(theme({ mode: 'custom', solidBackdrop: true }).backdrop).toBe('solid');
    expect(theme({ mode: 'match', solidBackdrop: true }).backdrop).toBe('transparent');
  });
  it('sets fonts and motion', () => {
    const t = theme({ reducedMotion: true }).tokens;
    expect(t['--mnx-font']).toBe("'Lexend Deca', system-ui, -apple-system, 'Segoe UI', sans-serif");
    expect(t['--mnx-font-mono']).toBe("'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace");
    expect(t['--mnx-duration']).toBe('0ms');
    expect(theme().tokens['--mnx-duration']).toBe('160ms');
  });
});

describe('primitives.css tokens from the theme', () => {
  it('maps them as the app does, and never sets the per-element hooks', () => {
    const current = theme();
    const t = current.tokens;
    const p = primitiveTokens(current);
    expect(p['--color-bg']).toBe(t['--mnx-canvas']);
    expect(p['--color-surface']).toBe(t['--mnx-surface']);
    expect(p['--color-surface-raised']).toBe(t['--mnx-surface-2']);
    expect([p['--color-border'], p['--color-border-strong']]).toEqual([t['--mnx-border-inner'], t['--mnx-border']]);
    expect([p['--color-secondary'], p['--color-secondary-dim'], p['--color-secondary-text']]).toEqual([t['--mnx-surface-2'], t['--mnx-surface-2'], t['--mnx-text']]);
    expect(p['--color-action-danger-text']).toBe('#ffffff');
    expect(p['--shadow-hover']).toBe(t['--mnx-shadow']);
    expect(p['--shadow-focus']).toBe('0 0 0 2px #ffffff, 0 0 0 4px #2f7b5e');
    expect(Object.keys(p).some(name => name.startsWith('--primitive-'))).toBe(false);
  });
});

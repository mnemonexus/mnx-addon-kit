/** Derive theme-v1 tokens from the default schemes and user settings.
 * Add-ons must read the tokens rather than depend on specific values. */

export type Scheme = 'light' | 'dark';
export type Edges = 'lines' | 'shadows' | 'both' | 'none';
export type Corners = 0 | 8 | 16;

/** What the theme panel controls: the user's app look, and this add-on's Appearance setting. */
export interface ThemeChoice {
  /** "Match MnemoNexus" (the user's own look) or a "Custom" look for this add-on. */
  mode: 'match' | 'custom';
  scheme: Scheme;
  /** The accent, or null for the app's accent for the scheme (the first swatch). */
  accent: string | null;
  corners: Corners;
  edges: Edges;
  reducedMotion: boolean;
  /** The user's "More colours" setting for the data palette. */
  moreColours: boolean;
  /** Custom only: paint --mnx-canvas behind the add-on. */
  solidBackdrop: boolean;
  /** The user's line width, 1-3 px. */
  lineWidth: number;
  /** The user's line strength, 10-100 %. */
  lineStrength: number;
  /** The user's shadow strength, 10-400 %. */
  shadowStrength: number;
}

export interface AddonTheme {
  version: 1;
  scheme: Scheme;
  edges: Edges;
  reducedMotion: boolean;
  backdrop: 'transparent' | 'solid';
  tokens: Record<string, string>;
}

export const DEFAULT_CHOICE: ThemeChoice = {
  mode: 'match', scheme: 'light', accent: null, corners: 8, edges: 'lines',
  reducedMotion: false, moreColours: true, solidBackdrop: false,
  lineWidth: 1, lineStrength: 100, shadowStrength: 100,
};

/** Every --mnx-* token name in contract section 11. */
export const MNX_TOKENS = [
  '--mnx-canvas', '--mnx-surface', '--mnx-surface-2', '--mnx-text', '--mnx-text-muted', '--mnx-text-subtle',
  '--mnx-border', '--mnx-border-inner', '--mnx-accent', '--mnx-accent-strong', '--mnx-accent-text', '--mnx-accent-soft',
  '--mnx-secondary', '--mnx-success', '--mnx-warning', '--mnx-danger', '--mnx-neutral', '--mnx-focus',
  ...Array.from({ length: 10 }, (_, i) => `--mnx-data-${i + 1}`),
  '--mnx-radius-surface', '--mnx-radius-overlay', '--mnx-radius-button', '--mnx-radius-field', '--mnx-radius-chip',
  '--mnx-edge-width', '--mnx-edge-color', '--mnx-shadow', '--mnx-shadow-overlay',
  '--mnx-font', '--mnx-font-heading', '--mnx-font-mono', '--mnx-duration',
] as const;

/** The app's default schemes (section 11). */
export const DEFAULT_SCHEMES: Record<Scheme, Record<'canvas' | 'surface' | 'text' | 'textMuted' | 'border' | 'accent' | 'secondary' | 'success' | 'warning' | 'danger' | 'neutral', string>> = {
  light: {
    canvas: '#f8fafc', surface: '#ffffff', text: '#0f172a', textMuted: '#64748b', border: '#e2e8f0', accent: '#2f7b5e',
    secondary: '#0f766e', success: '#2caf69', warning: '#c9802b', danger: '#ef4444', neutral: '#64748b',
  },
  dark: {
    canvas: '#0b0e14', surface: '#161b22', text: '#c9d1d9', textMuted: '#8b949e', border: '#30363d', accent: '#4ade80',
    secondary: '#2dd4bf', success: '#26ff93', warning: '#c9802b', danger: '#ef4444', neutral: '#8b949e',
  },
};

/** The data palette, used with "More colours" on. */
export const DATA_PALETTE: Record<Scheme, string[]> = {
  light: ['#6366f1', '#0ea5e9', '#f97316', '#10b981', '#e11d48', '#f59e0b', '#8b5cf6', '#14b8a6', '#d946ef', '#65a30d'],
  dark: ['#818cf8', '#38bdf8', '#fb923c', '#34d399', '#fb7185', '#fbbf24', '#a78bfa', '#2dd4bf', '#e879f9', '#a3e635'],
};

/** With "More colours" off, slot N is the accent mixed into the surface at this percentage. */
const ACCENT_SHADES = [100, 55, 82, 38, 92, 66, 46, 74, 30, 60];

export const FONT = "'Lexend Deca', system-ui, -apple-system, 'Segoe UI', sans-serif";
export const MONO = "'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace";

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number, places = 3) => Number(value.toFixed(places));

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

/** `rgba()` of a hex colour at an alpha. */
export function withAlpha(hex: string, alpha: number): string {
  return `rgba(${rgb(hex).join(', ')}, ${round(alpha)})`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The colour with its HSL lightness moved by `delta` points, clamped to 0-100. */
export function shiftLightness(hex: string, delta: number): string {
  const [r, g, b] = rgb(hex).map(value => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const next = clamp(l * 100 + delta, 0, 100) / 100;
  const q = next < 0.5 ? next * (1 + s) : next + s - next * s;
  const p = 2 * next - q;
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const channels = s === 0 ? [next, next, next] : [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
  return `#${channels.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Text on an accent fill: dark when the accent is light (luminance above 0.4), otherwise white. */
export function accentText(hex: string): string {
  return luminance(hex) > 0.4 ? '#0b0e14' : '#ffffff';
}

/** The surface shadow at strength `s` (0.1-4); each alpha is capped at 0.9. */
export function shadowAt(scheme: Scheme, s: number): string {
  const a = (alpha: number) => round(Math.min(alpha * s, 0.9));
  return scheme === 'light'
    ? `0 1px 2px rgba(15,23,42,${a(0.06)}), 0 6px 18px rgba(15,23,42,${a(0.08)})`
    : `0 1px 2px rgba(0,0,0,${a(0.35)}), 0 6px 18px rgba(0,0,0,${a(0.28)})`;
}

export function buildTheme(choice: ThemeChoice): AddonTheme {
  const scheme = choice.scheme;
  const base = DEFAULT_SCHEMES[scheme];
  const dark = scheme === 'dark';
  // The user's choice, or the app's accent for the scheme when left on the first swatch.
  const accent = choice.accent && HEX.test(choice.accent) ? choice.accent.toLowerCase() : base.accent;
  // A custom look offers lines, shadows or both; "none" only comes from Match.
  const edges: Edges = choice.mode === 'custom' && choice.edges === 'none' ? 'lines' : choice.edges;
  const lines = edges === 'lines' || edges === 'both';
  const shadows = edges === 'shadows' || edges === 'both';
  const c = choice.corners;
  const s = clamp(choice.shadowStrength, 10, 400) / 100;
  const lineWidth = clamp(Math.round(choice.lineWidth), 1, 3);
  const lineStrength = clamp(choice.lineStrength, 10, 100) / 100;
  const data = choice.moreColours
    ? DATA_PALETTE[scheme]
    : ACCENT_SHADES.map(percent => percent === 100 ? accent : `color-mix(in srgb, ${accent} ${percent}%, ${base.surface})`);

  const tokens: Record<string, string> = {
    '--mnx-canvas': base.canvas,
    '--mnx-surface': base.surface,
    '--mnx-surface-2': `color-mix(in srgb, ${base.text} ${dark ? 6 : 4}%, ${base.surface})`,
    '--mnx-text': base.text,
    '--mnx-text-muted': base.textMuted,
    '--mnx-text-subtle': withAlpha(base.textMuted, 0.72),
    '--mnx-border': base.border,
    '--mnx-border-inner': base.border,
    '--mnx-accent': accent,
    '--mnx-accent-strong': shiftLightness(accent, dark ? 10 : -10),
    '--mnx-accent-text': accentText(accent),
    '--mnx-accent-soft': withAlpha(accent, dark ? 0.18 : 0.12),
    '--mnx-secondary': base.secondary,
    '--mnx-success': base.success,
    '--mnx-warning': base.warning,
    '--mnx-danger': base.danger,
    '--mnx-neutral': base.neutral,
    '--mnx-focus': accent,
    ...Object.fromEntries(data.map((colour, i) => [`--mnx-data-${i + 1}`, colour])),
    // Surfaces and overlays get the master value; buttons and fields 0.6 of it, chips 0.45.
    '--mnx-radius-surface': `${c}px`,
    '--mnx-radius-overlay': `${c}px`,
    '--mnx-radius-button': `${Math.round(c * 0.6)}px`,
    '--mnx-radius-field': `${Math.round(c * 0.6)}px`,
    '--mnx-radius-chip': `${Math.round(c * 0.45)}px`,
    '--mnx-edge-width': lines ? `${lineWidth}px` : '0px',
    // The border colour at the user's line strength. The mock writes it as rgba().
    '--mnx-edge-color': lines ? (lineStrength === 1 ? base.border : withAlpha(base.border, lineStrength)) : 'transparent',
    '--mnx-shadow': shadows ? shadowAt(scheme, s) : 'none',
    '--mnx-shadow-overlay': shadowAt(scheme, Math.min(Math.max(s, 1) * 1.6, 4)),
    '--mnx-font': FONT,
    '--mnx-font-heading': FONT,
    '--mnx-font-mono': MONO,
    '--mnx-duration': choice.reducedMotion ? '0ms' : '160ms',
  };
  return {
    version: 1,
    scheme,
    edges,
    reducedMotion: choice.reducedMotion,
    backdrop: choice.mode === 'custom' && choice.solidBackdrop ? 'solid' : 'transparent',
    tokens,
  };
}

/**
 * The primitives.css tokens the host maps from the theme (section 11). The
 * rest (spacing, type sizes, weights) come from the host root: the mock uses
 * its own values for those. The per-element --primitive-*-color hooks are
 * deliberately not set.
 */
export function primitiveTokens(theme: AddonTheme): Record<string, string> {
  const t = theme.tokens;
  return {
    // From the host root.
    '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px', '--space-5': '20px',
    '--space-6': '24px', '--space-10': '40px',
    '--fs-mini': '11px', '--fs-xs': '12px', '--fs-sm': '13px', '--fs-base': '15px', '--fs-lg': '18px', '--fs-display': '28px',
    '--font-weight-regular': '400', '--font-weight-medium': '500', '--font-weight-bold': '600',
    '--transition-fast': '150ms ease', '--transition-slow': '300ms ease',
    '--size-icon-sm': '28px', '--size-icon-md': '34px', '--size-icon-lg': '40px',
    '--type-h1-size': '28px', '--type-h1-line-height': '1.2', '--type-h1-letter-spacing': '-0.01em',
    '--type-h2-size': '22px', '--type-h2-line-height': '1.25', '--type-h2-letter-spacing': '-0.005em',
    // From the theme.
    '--color-bg': t['--mnx-canvas'],
    '--color-surface': t['--mnx-surface'],
    '--color-surface-raised': t['--mnx-surface-2'],
    '--color-border': t['--mnx-border-inner'],
    '--color-border-strong': t['--mnx-border'],
    '--color-text': t['--mnx-text'], '--color-text-muted': t['--mnx-text-muted'], '--color-text-subtle': t['--mnx-text-subtle'],
    '--ink-soft': t['--mnx-text-muted'],
    '--color-primary': t['--mnx-accent'],
    '--color-primary-dark': t['--mnx-accent-strong'],
    '--color-primary-dim': t['--mnx-accent-soft'],
    '--color-primary-text': t['--mnx-accent-text'],
    '--color-secondary': t['--mnx-surface-2'], '--color-secondary-dim': t['--mnx-surface-2'],
    '--color-secondary-text': t['--mnx-text'],
    '--color-error': t['--mnx-danger'], '--color-danger': t['--mnx-danger'],
    '--color-danger-dim': `color-mix(in srgb, ${t['--mnx-danger']} 14%, transparent)`,
    '--color-action-danger-text': '#ffffff',
    '--font-body': t['--mnx-font'],
    '--font-title': t['--mnx-font-heading'], '--font-heading-primary': t['--mnx-font-heading'],
    '--shadow-sm': t['--mnx-shadow'], '--shadow-md': t['--mnx-shadow'], '--shadow-hover': t['--mnx-shadow'],
    '--shadow-focus': `0 0 0 2px ${t['--mnx-surface']}, 0 0 0 4px ${t['--mnx-focus']}`,
  };
}

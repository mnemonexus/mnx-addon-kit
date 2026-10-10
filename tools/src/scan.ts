/** Scan bundles and CSS for sandbox violations and compatibility warnings. */
export interface Finding {
  level: 'error' | 'warning'; rule: string; message: string; snippet: string;
  /** Where in the code it was found, and what. */
  index?: number;
  match?: string;
  /** The npm package it comes from, when it is not the add-on's own code (see check). */
  dependency?: string;
}

function snippetAt(code: string, index: number, length: number) {
  const start = Math.max(0, index - 30);
  const end = Math.min(code.length, index + length + 50);
  return (start > 0 ? '…' : '') + code.slice(start, end).replace(/\s+/g, ' ') + (end < code.length ? '…' : '');
}

const RULES: { level: 'error' | 'warning'; rule: string; pattern: RegExp; message: string; needsNoNetwork?: boolean }[] = [
  { level: 'error', rule: 'no-eval', pattern: /(?<![.\w$])eval\s*\(/g,
    message: 'eval() is blocked by the sandbox (no unsafe-eval in the CSP). Use plain code or JSON.parse.' },
  // Minifying turns `new Function(...)` into `Function(...)`.
  { level: 'error', rule: 'no-eval', pattern: /(?<![.\w$])(new\s+)?Function\s*\(/g,
    message: 'new Function() is blocked by the sandbox (no unsafe-eval in the CSP). Libraries that compile code at runtime will not work.' },
  { level: 'error', rule: 'no-wasm', pattern: /\bWebAssembly\s*\.\s*(instantiate|instantiateStreaming|compile|compileStreaming|Module)\s*\(/g,
    message: 'WebAssembly cannot be compiled in the sandbox (no \'wasm-unsafe-eval\' in the CSP). Use a plain JavaScript build of the library, or leave out the feature that needs it.' },
  { level: 'error', rule: 'no-browser-storage', pattern: /\b(localStorage|sessionStorage|indexedDB)\b/g,
    message: 'The sandbox has an opaque origin, so localStorage, sessionStorage and indexedDB throw SecurityError. Use mnx.storage (needs "storage:local").' },
  { level: 'error', rule: 'no-parent-access', pattern: /\b(window|self|globalThis)\s*\.\s*(parent|top)\b/g,
    message: 'The add-on cannot reach the page around it. Talk to the host only through window.mnx.' },
  { level: 'error', rule: 'no-parent-access', pattern: /(?<![.\w$])(parent|top)\s*\.\s*(postMessage|location|document|frames|window)\b/g,
    message: 'The add-on cannot reach the page around it. Talk to the host only through window.mnx.' },
  { level: 'error', rule: 'no-parent-access', pattern: /\b(window|self|globalThis)\s*\.\s*opener\b|(?<![.\w$])opener\b(?!\s*:)/g,
    message: 'window.opener is not available to an add-on. Talk to the host only through window.mnx.' },
  { level: 'error', rule: 'no-network', needsNoNetwork: true, pattern: /(?<![.\w$])fetch\s*\(|\b(XMLHttpRequest|WebSocket|EventSource)\b/g,
    message: 'Network calls are blocked without the "network" permission (connect-src \'none\'). Ship data as assets, or declare a data source and use mnx.externalApi.' },
  { level: 'error', rule: 'no-remote-css', pattern: /url\(\s*['"]?\s*(https?:)?\/\//gi,
    message: 'CSS cannot load remote files: images must be data:/blob: URLs and fonts data: URLs. Embed the file, or ship it as an asset and use mnx.asset().' },
  { level: 'error', rule: 'no-remote-css', pattern: /@import\s+(url\()?\s*['"]?\s*(https?:)?\/\//gi,
    message: 'CSS @import of a remote stylesheet is blocked. Bundle the CSS into your code instead.' },
];

/** Reads a string literal starting at `i`; returns the index after it, or -1. */
function literalEnd(code: string, i: number): number {
  const quote = code[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return -1;
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') { j++; continue; }
    if (quote === '`' && code[j] === '$' && code[j + 1] === '{') return -1; // template with values: not a literal
    if (code[j] === quote) return j + 1;
  }
  return -1;
}

function isLiteralExpression(code: string, start: number): boolean {
  // A literal, or literals joined with +: 'a' + "b" + `c`.
  let i = start;
  for (;;) {
    while (/\s/.test(code[i] ?? '')) i++;
    const end = literalEnd(code, i);
    if (end < 0) return false;
    let k = end;
    while (/[ \t]/.test(code[k] ?? '')) k++;
    if (code[k] === '+' && code[k + 1] !== '=') { i = k + 1; continue; }
    return k >= code.length || /[;,)}\n\r]/.test(code[k]);
  }
}

export function scanCode(code: string, { network }: { network: boolean }): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    if (rule.needsNoNetwork && network) continue;
    for (const match of code.matchAll(rule.pattern)) {
      findings.push({ level: rule.level, rule: rule.rule, message: rule.message, snippet: snippetAt(code, match.index!, match[0].length), index: match.index, match: match[0] });
    }
  }
  // innerHTML and friends with anything but a plain string literal.
  for (const match of code.matchAll(/\.(innerHTML|outerHTML)\s*\+?=(?!=)/g)) {
    if (!isLiteralExpression(code, match.index! + match[0].length)) {
      findings.push({ level: 'warning', rule: 'html-from-strings', snippet: snippetAt(code, match.index!, match[0].length), index: match.index,
        message: `${match[1]} is set from a value that is not a plain string literal. If any of it comes from items, storage or a model, use textContent or build elements instead.` });
    }
  }
  for (const match of code.matchAll(/\.insertAdjacentHTML\s*\(|\bdocument\s*\.\s*write(ln)?\s*\(/g)) {
    findings.push({ level: 'warning', rule: 'html-from-strings', snippet: snippetAt(code, match.index!, match[0].length), index: match.index,
      message: 'This parses a string as HTML. Use textContent or build elements for anything that is not fixed markup.' });
  }
  // One finding per rule and snippet is enough.
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = finding.rule + finding.snippet;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function scanCss(css: string, file: string): Finding[] {
  return RULES.filter(rule => rule.rule === 'no-remote-css').flatMap(rule => [...css.matchAll(rule.pattern)].map(match => ({
    level: rule.level, rule: rule.rule, message: `${file}: ${rule.message}`, snippet: snippetAt(css, match.index!, match[0].length),
  })));
}

const TAILWIND_PALETTE = 'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const TAILWIND_COLOUR_CLASS = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*(?:bg|text|border|border-[trblxy]|ring|ring-offset|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|placeholder|shadow)-(?:${TAILWIND_PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`, 'g');

/**
 * With the MnemoNexus Tailwind preset, Tailwind's own colours don't exist (they
 * would ignore dark mode), so `bg-white` or `text-gray-500` silently do
 * nothing. With the add-on's own tailwind.config they exist but stay fixed.
 * Point them out, per file.
 */
export function scanTailwindColours(sources: { file: string; text: string }[], { keepsPalette = false } = {}): Finding[] {
  const why = keepsPalette
    ? "Tailwind's own colours are fixed: with your tailwind.config they still work, but they won't follow dark mode or the user's colours."
    : "Tailwind's own colours do nothing here: the MnemoNexus preset replaces them so every colour follows the theme.";
  return sources.flatMap(({ file, text }) => {
    const found = [...new Set(text.match(TAILWIND_COLOUR_CLASS) ?? [])];
    if (!found.length) return [];
    return [{
      level: 'warning' as const, rule: 'tailwind-colours',
      message: `${file}: ${why} Use the mnx colours instead: bg-mnx-surface, text-mnx-text, text-mnx-text-muted, border-mnx-border-inner, bg-mnx-accent with text-mnx-accent-text.`,
      snippet: found.slice(0, 8).join(' ') + (found.length > 8 ? ` …and ${found.length - 8} more` : ''),
    }];
  });
}

/** WCAG 2 contrast checks for visible text: 4.5:1, or 3:1 for large text.
 * auditScript() serializes the helpers for evaluation in the add-on frame. */

/** sRGB channel (0-255) to linear light. */
export function linear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of [r, g, b] (0-255). */
export function relativeLuminance([r, g, b]) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of two opaque colours, from 1 to 21. */
export function contrastRatio(a, b) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Paint [r, g, b, alpha] over an opaque [r, g, b]. */
export function composite([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

/** AA: 3:1 for large text (24 px, or 18.66 px and bold), 4.5:1 otherwise. */
export function requiredRatio(fontSizePx, fontWeight) {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
}

/**
 * Runs inside the add-on's frame. Everything it uses arrives in `helpers`,
 * because the function is sent as text. Returns the text that is too faint.
 *
 * What is behind a transparent frame is the app's own surface: the check tries
 * both --mnx-canvas and --mnx-surface and keeps the worse result.
 */
export function auditPage(helpers) {
  const { contrastRatio, composite, requiredRatio } = helpers;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  /** Any CSS colour the browser understands, as [r, g, b, alpha], via a 1-pixel canvas. */
  function rgba(value) {
    if (cache.has(value)) return cache.get(value);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const result = [r, g, b, a / 255];
    cache.set(value, result);
    return result;
  }
  const rootStyle = getComputedStyle(document.documentElement);
  const backdrops = ['--mnx-canvas', '--mnx-surface']
    .map(name => rootStyle.getPropertyValue(name).trim())
    .filter(Boolean)
    .map(value => rgba(value))
    .filter(colour => colour[3] > 0)
    .map(([r, g, b]) => [r, g, b]);
  if (!backdrops.length) backdrops.push([255, 255, 255]);

  /** The opaque colours behind an element: its own background and its ancestors', over the app's surface. */
  function backgrounds(element) {
    const layers = [];
    let opaque = false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const colour = rgba(getComputedStyle(node).backgroundColor);
      if (colour[3] > 0) layers.push(colour);
      if (colour[3] >= 0.999) { opaque = true; break; }
    }
    const bases = opaque ? [layers.pop().slice(0, 3)] : backdrops;
    return bases.map(base => layers.reduceRight((below, layer) => composite(layer, below), base));
  }
  function opacity(element) {
    let value = 1;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) value *= Number(getComputedStyle(node).opacity) || 0;
    return value;
  }
  function describe(element) {
    const classes = [...element.classList].slice(0, 2).map(name => `.${name}`).join('');
    const data = [...element.attributes].find(attribute => attribute.name.startsWith('data-'));
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes}${data ? `[${data.name}=${data.value}]` : ''}`;
  }
  const skip = element => element.closest('script, style, noscript, template, [aria-hidden="true"], [inert], :disabled, [aria-disabled="true"]');
  function visible(element) {
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.display === 'none') return false;
    return element.getClientRects().length > 0;
  }

  const checked = new Set();
  const failures = [];
  function check(element, text, colourValue) {
    const key = `${describe(element)}|${text}`;
    if (checked.has(key)) return;
    checked.add(key);
    const style = getComputedStyle(element);
    const alpha = opacity(element);
    if (alpha === 0) return;
    const [r, g, b, a] = rgba(colourValue ?? style.color);
    const required = requiredRatio(parseFloat(style.fontSize), Number(style.fontWeight) || 400);
    let worst = Infinity;
    for (const background of backgrounds(element)) {
      const foreground = composite([r, g, b, a * alpha], background);
      worst = Math.min(worst, contrastRatio(foreground, background));
    }
    if (worst + 0.005 < required) {
      failures.push({ element: describe(element), text: text.length > 48 ? `${text.slice(0, 45)}…` : text, ratio: Math.round(worst * 100) / 100, required });
    }
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    const element = node.parentElement;
    if (!text || !element || skip(element) || !visible(element)) continue;
    if (element.closest('select')) continue; // options are drawn by the browser
    check(element, text);
  }
  // Text typed into fields, and what a select shows.
  for (const field of document.querySelectorAll('input, textarea, select')) {
    if (skip(field) || !visible(field)) continue;
    if (field instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'color', 'hidden', 'file', 'image', 'submit', 'button', 'reset'].includes(field.type)) continue;
    const text = field instanceof HTMLSelectElement ? (field.selectedOptions[0]?.textContent ?? '') : field.value;
    if (text.trim()) check(field, text.trim());
  }
  return { failures, texts: checked.size };
}

/** One expression to evaluate in the frame: the helpers, then the page part. */
export function auditScript() {
  // The helpers call each other by name, so bring the names into scope first.
  return `(() => { const linear = ${linear}; const relativeLuminance = ${relativeLuminance}; const contrastRatio = ${contrastRatio};
    const composite = ${composite}; const requiredRatio = ${requiredRatio};
    return (${auditPage})({ contrastRatio, composite, requiredRatio }); })()`;
}

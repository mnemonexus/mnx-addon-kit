/** Darken element labels to 4.5:1 contrast on white, preserving their hue. */
const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** Contrast against white. */
const onWhite = (rgb: number[]) => 1.05 / (luminance(rgb) + 0.05);

export function readableOnWhite(hex: string, minimum = 4.6): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  let rgb = [0, 2, 4].map(at => parseInt(match[1].slice(at, at + 2), 16));
  while (onWhite(rgb) < minimum) rgb = rgb.map(value => Math.floor(value * 0.94));
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export function makeReadable(colours: Record<string, string>) {
  for (const [name, colour] of Object.entries(colours)) colours[name] = readableOnWhite(colour);
}

/** Map bundle positions to source files for static-scan diagnostics. */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...BASE64].map((char, value) => [char, value]));

/** The source file of the code at each position of the generated code, or undefined. */
export function sourceLocator(code: string, mapText: string): (index: number) => string | undefined {
  const map = JSON.parse(mapText) as { sources?: string[]; mappings?: string };
  const sources = map.sources ?? [];
  // Each generated line: segment start columns, and the source of each segment.
  const lines: { columns: number[]; sources: number[] }[] = [];
  let source = 0;
  for (const text of (map.mappings ?? '').split(';')) {
    const line = { columns: [] as number[], sources: [] as number[] };
    let column = 0;
    for (const segment of text.split(',')) {
      if (!segment) continue;
      const fields = decodeVlq(segment);
      column += fields[0];
      if (fields.length < 4) continue; // a segment with no source
      source += fields[1];
      line.columns.push(column);
      line.sources.push(source);
    }
    lines.push(line);
  }
  const starts = [0];
  for (let i = code.indexOf('\n'); i >= 0; i = code.indexOf('\n', i + 1)) starts.push(i + 1);

  return index => {
    const lineIndex = upperBound(starts, index) - 1;
    const column = index - starts[lineIndex];
    const line = lines[lineIndex];
    if (!line) return undefined;
    const segment = upperBound(line.columns, column) - 1;
    return segment >= 0 ? sources[line.sources[segment]] : undefined;
  };
}

/** One segment's fields, each a signed number relative to the previous segment. */
function decodeVlq(segment: string): number[] {
  const fields: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = DIGIT.get(char);
    if (digit === undefined) break;
    value += (digit & 31) << shift;
    if (digit & 32) { shift += 5; continue; }
    fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return fields;
}

/** The number of sorted values <= target. */
function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * "node_modules/@scope/name/x.js" → "@scope/name", and "node:util" (Bun's
 * stand-in for a Node module) as it is. Undefined for the add-on's own files.
 */
export function dependencyOf(source: string | undefined): string | undefined {
  if (!source) return undefined;
  if (source.startsWith('node:')) return source;
  const parts = source.split('\\').join('/').split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at < 0 || at + 1 >= parts.length) return undefined;
  return parts[at + 1].startsWith('@') ? parts.slice(at + 1, at + 3).join('/') : parts[at + 1];
}

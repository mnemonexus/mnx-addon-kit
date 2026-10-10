import { describe, expect, it } from 'bun:test';
import { auditScript, composite, contrastRatio, relativeLuminance, requiredRatio } from '../src/contrast.mjs';

describe('contrast (WCAG 2)', () => {
  it('measures the extremes and a known grey', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBe(1);
    // #767676 on white is the classic just-passing grey, #777777 just fails.
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio([0x77, 0x77, 0x77], [255, 255, 255])).toBeLessThan(4.5);
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(contrastRatio([255, 255, 255], [0, 0, 0]));
  });
  it('computes relative luminance', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 0, 0])).toBeCloseTo(0.2126, 4);
  });
  it('paints translucent colours over what is behind', () => {
    expect(composite([0, 0, 0, 0.5], [255, 255, 255])).toEqual([127.5, 127.5, 127.5]);
    expect(composite([10, 20, 30, 1], [255, 255, 255])).toEqual([10, 20, 30]);
    expect(composite([10, 20, 30, 0], [1, 2, 3])).toEqual([1, 2, 3]);
  });
  it('asks 3:1 of large text and 4.5:1 of the rest', () => {
    expect(requiredRatio(16, 400)).toBe(4.5);
    expect(requiredRatio(24, 400)).toBe(3);
    expect(requiredRatio(19, 700)).toBe(3);
    expect(requiredRatio(19, 600)).toBe(4.5);
  });
  it('sends the helpers with the page part, as one expression', () => {
    const script = auditScript();
    expect(script.startsWith('(() =>')).toBe(true);
    for (const name of ['linear', 'relativeLuminance', 'contrastRatio', 'composite', 'requiredRatio', 'auditPage']) expect(script).toContain(name);
    expect(() => new Function(`return ${script}`)).not.toThrow(); // it parses
  });
});

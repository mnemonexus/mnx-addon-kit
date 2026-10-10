import { describe, expect, it } from 'bun:test';
import { evaluateCompatRule, selectItems } from '../src/compat.mjs';

const item = {
  lineageId: 'l1', itemId: 'i1', conceptId: 'c1', conceptTitle: 'Osmosis', conceptKind: 'process',
  descriptorType: 'definition', descriptorStructure: 'sequence', text: '  Water moves.  ', structuredItems: ['a', 'b'],
  tags: ['bio', 'cells'], discipline: 'biology', practiceModes: ['recall'], hasMedia: false,
};
const r = (kind, extra = {}) => ({ kind, whenTrue: `${kind} yes`, whenFalse: `${kind} no`, ...extra });
const pass = (rule, it = item) => evaluateCompatRule(rule, it).pass;

describe('compatRule leaves', () => {
  it('always', () => expect(pass(r('always'))).toBe(true));
  it('hasConcept: conceptId is non-empty', () => {
    expect(pass(r('hasConcept'))).toBe(true);
    expect(pass(r('hasConcept'), { ...item, conceptId: '' })).toBe(false);
  });
  it('minTextLength counts trimmed JavaScript length', () => {
    expect(pass(r('minTextLength', { value: 12 }))).toBe(true);
    expect(pass(r('minTextLength', { value: 13 }))).toBe(false);
  });
  it('minStructuredItems', () => {
    expect(pass(r('minStructuredItems', { value: 2 }))).toBe(true);
    expect(pass(r('minStructuredItems', { value: 3 }))).toBe(false);
  });
  it('hasMedia compares with value', () => {
    expect(pass(r('hasMedia', { value: false }))).toBe(true);
    expect(pass(r('hasMedia', { value: true }))).toBe(false);
  });
  it('…In leaves match when any value is listed', () => {
    expect(pass(r('descriptorTypeIn', { values: ['cause', 'definition'] }))).toBe(true);
    expect(pass(r('descriptorStructureIn', { values: ['list'] }))).toBe(false);
    expect(pass(r('conceptKindIn', { values: ['process'] }))).toBe(true);
    expect(pass(r('disciplineIn', { values: ['chemistry'] }))).toBe(false);
    expect(pass(r('tagIn', { values: ['cells'] }))).toBe(true);
    expect(pass(r('practiceModeIn', { values: ['drill'] }))).toBe(false);
  });
  it('unknown kinds and deep nesting make the item incompatible', () => {
    expect(pass(r('isHard'))).toBe(false);
    const nest = depth => depth === 1 ? r('always') : r('not', { rule: r('not', { rule: nest(depth - 1) }) });
    expect(pass(nest(5))).toBe(true);   // 9 levels
    expect(pass(nest(6))).toBe(false);  // 11 levels
  });
});

describe('compatRule combinators and reasons', () => {
  it('allOf reports the first failure', () => {
    expect(evaluateCompatRule(r('allOf', { rules: [r('always'), r('hasMedia', { value: true }), r('tagIn', { values: [] })] }), item))
      .toEqual({ pass: false, reason: 'hasMedia no' });
    expect(evaluateCompatRule(r('allOf', { rules: [r('always')] }), item)).toEqual({ pass: true, reason: 'allOf yes' });
  });
  it('anyOf reports the first pass', () => {
    expect(evaluateCompatRule(r('anyOf', { rules: [r('hasMedia', { value: true }), r('hasConcept'), r('always')] }), item))
      .toEqual({ pass: true, reason: 'hasConcept yes' });
    expect(evaluateCompatRule(r('anyOf', { rules: [r('hasMedia', { value: true })] }), item)).toEqual({ pass: false, reason: 'anyOf no' });
  });
  it('not inverts its child', () => {
    expect(pass(r('not', { rule: r('always') }))).toBe(false);
    expect(pass(r('not', { rule: r('hasMedia', { value: true }) }))).toBe(true);
  });
});

describe('selectItems', () => {
  const consumes = (extra = {}) => ({ knowledgeBinding: { mode: 'consumes', compatRule: r('minTextLength', { value: 6 }) }, surfaces: {}, ...extra });
  const items = [item, { ...item, itemId: 'i2', text: 'tiny' }, { ...item, itemId: 'i3' }];
  it('gives [] to none and produces bindings', () => {
    expect(selectItems({ knowledgeBinding: { mode: 'none' } }, items).items).toEqual([]);
    expect(selectItems({ knowledgeBinding: { mode: 'produces' } }, items).items).toEqual([]);
  });
  it('filters through the compatRule and reports why', () => {
    const result = selectItems(consumes(), items);
    expect(result.items.map(i => i.itemId)).toEqual(['i1', 'i3']);
    expect(result.rejected).toEqual([{ item: items[1], reason: 'minTextLength no' }]);
  });
  it('caps at transferal.maxItems on every surface', () => {
    const result = selectItems(consumes({ surfaces: { transferal: { category: 'application', minItems: 1, maxItems: 1 } } }), items);
    expect(result.items.map(i => i.itemId)).toEqual(['i1']);
    expect(result.capped).toBe(1);
  });
});

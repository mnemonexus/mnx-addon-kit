import { describe, expect, it } from 'bun:test';
import { buildStudyContext, isSuggested } from '../src/core/study';
import { parseScenario } from '../src/core/scenario';

const inputs = {
  extensionId: 'demo', addonVersion: '1.0.0', taskId: 'task-a', taskSchema: 'demo-v1', workspaceId: 'ws',
  lectureId: 'lec', lectureTitle: 'Lecture', subsectionId: 'sub', subsectionTitle: 'Sub', depth: 'standard' as const,
};

describe('study context', () => {
  it('builds runId as extensionId:taskId:contextFingerprint, the same every time', async () => {
    const a = await buildStudyContext(inputs);
    const b = await buildStudyContext(inputs);
    expect(a.runId).toBe(`demo:task-a:${a.contextFingerprint}`);
    expect(a.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(b).toEqual(a);
  });
  it('changes the fingerprint with the subsection, depth, version or task', async () => {
    const base = (await buildStudyContext(inputs)).contextFingerprint;
    for (const patch of [{ subsectionId: 'x' }, { depth: 'deep' as const }, { addonVersion: '1.0.1' }, { taskId: 'task-b' }, { lectureId: 'x' }]) {
      expect((await buildStudyContext({ ...inputs, ...patch })).contextFingerprint).not.toBe(base);
    }
  });
});

describe('task suggestion matching', () => {
  it('matches whole words, case-insensitive, punctuation as spaces', () => {
    expect(isSuggested(['SN2'], 'Substitution: the sn2 reaction')).toBe(true);
    expect(isSuggested(['SN2'], 'SN21 is something else')).toBe(false);
    expect(isSuggested(['Calvin cycle'], 'The Calvin-cycle, step by step')).toBe(true);
    expect(isSuggested(['cell'], 'Cellular respiration')).toBe(false);
  });
});

describe('scenarios', () => {
  const manifest = { id: 'demo', version: '1.0.0', permissions: [], surfaces: { study: { version: 1, tasks: [{ id: 'task-a', schema: 's' }] } },
    knowledgeBinding: { mode: 'consumes', compatRule: { kind: 'always', whenTrue: 'Yes.', whenFalse: 'No.' } } };
  it('gives every study launch its section and compatible items (study-section-v1)', () => {
    const raw = { surface: 'study', study: { taskId: 'task-a', section: { objective: 'o', text: 't' } }, items: [{ itemId: 'i', text: 'x' }] };
    const parsed = parseScenario('a', raw, manifest);
    expect(parsed.scenario?.study?.section).toEqual({ objective: 'o', text: 't' });
    expect(parsed.scenario?.items[0]).toMatchObject({ itemId: 'i', lineageId: 'i', descriptorStructure: 'single', structuredItems: [] });
    const plain = parseScenario('b', { surface: 'study', study: { taskId: 'task-a' } }, manifest);
    expect(plain.scenario?.study?.section).toEqual({ objective: '', text: '' });
    expect(parseScenario('c', { ...raw, capabilities: ['study-section-v1'] }, manifest).warnings.join(' ')).toContain('no longer needed');
  });
  it('gives items the way the app does', () => {
    const rule = { kind: 'minTextLength', value: 5, whenTrue: 'Long enough.', whenFalse: 'Too short.' };
    const consumes = { ...manifest, surfaces: { transferal: { minItems: 1, maxItems: 2 } }, knowledgeBinding: { mode: 'consumes', compatRule: rule } };
    const items = [{ itemId: 'a', text: 'long text' }, { itemId: 'b', text: 'tiny' }, { itemId: 'c', text: 'long text' }, { itemId: 'd', text: 'long text' }];
    const given = parseScenario('f', { surface: 'standalone', items }, consumes);
    expect(given.scenario?.items.map(i => i.itemId)).toEqual(['a', 'c']);
    expect(given.warnings.join(' ')).toContain('Item "b" does not pass the compatRule');
    expect(given.warnings.join(' ')).toContain('capped');
    const none = parseScenario('g', { surface: 'standalone', items }, { ...manifest, knowledgeBinding: { mode: 'none' } });
    expect(none.scenario?.items).toEqual([]);
  });
  it('explains mistakes', () => {
    expect(parseScenario('c', { surface: 'recall' }, manifest).errors[0]).toContain('does not declare surfaces.recall');
    expect(parseScenario('d', { surface: 'study', study: { taskId: 'nope' } }, manifest).errors[0]).toContain('not one of the tasks');
    expect(parseScenario('e', { surface: 'standalone', drive: [{ tap: 'x' }] }, manifest).errors[0]).toContain('drive step 1');
  });
});

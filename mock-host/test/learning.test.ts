import { describe, expect, it } from 'bun:test';
import { activityStudyContext, buildSource } from '../src/core/learning';
import { defaultSourceRefs, parseScenario, type SourceInput } from '../src/core/scenario';

const base: SourceInput = {
  workspaceId: 'ws', lectureId: 'lec', subsectionId: 'sub', objective: 'o', text: 't', knowledge: [], sourceRefs: ['sub'], depth: 'standard', media: [],
};
const MiB = 1024 * 1024;

describe('source media (section 9)', () => {
  it('takes the first eight figures, then keeps local image/* files of at most 8 MiB', async () => {
    const media: SourceInput['media'] = [
      { id: 'png', mimeType: 'image/png', path: 'a.png' },
      { id: 'heic', mimeType: 'image/heic', path: 'b.heic' },            // any image/* type is kept
      { id: 'remote', mimeType: 'image/png', url: 'https://example.com/c.png' }, // never a remote figure
      { id: 'pdf', mimeType: 'application/pdf', path: 'd.pdf' },
      { id: 'big', mimeType: 'image/png', path: 'e.png' },                // over 8 MiB
      { id: 'missing', mimeType: 'image/png', path: 'f.png' },            // unreadable
      { id: 'g', mimeType: 'image/png', path: 'g.png' },
      { id: 'h', mimeType: 'image/png', path: 'h.png' },
      { id: 'ninth', mimeType: 'image/png', path: 'i.png' },              // the limit of 8 comes first
    ];
    const sizes = { 'a.png': 10, 'b.heic': 10, 'd.pdf': 10, 'e.png': 8 * MiB + 1, 'g.png': 8 * MiB, 'h.png': 1, 'i.png': 1 };
    const { source, readable } = await buildSource({ ...base, media }, sizes);
    expect(source.media).toEqual([{ id: 'png', mimeType: 'image/png' }, { id: 'heic', mimeType: 'image/heic' }, { id: 'g', mimeType: 'image/png' }, { id: 'h', mimeType: 'image/png' }]);
    expect(readable.map(row => row.path)).toEqual(['a.png', 'b.heic', 'g.png', 'h.png']);
  });
  it('fingerprints the source as lowercase hex SHA-256, covering the depth and the media', async () => {
    const a = (await buildSource(base, {})).source.fingerprint;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect((await buildSource({ ...base, depth: 'deep' }, {})).source.fingerprint).not.toBe(a);
    expect((await buildSource({ ...base, media: [{ id: 'x', mimeType: 'image/png', path: 'x.png' }] }, { 'x.png': 1 })).source.fingerprint).not.toBe(a);
  });
});

describe('source references', () => {
  it('holds the subsection id, its text blocks and each item lineageId, without repeats', () => {
    const items = [{ lineageId: 'lin-a' }, { lineageId: 'lin-a' }, { lineageId: 'lin-b' }] as any;
    expect(defaultSourceRefs('sub', 'First block.\n\nSecond block.', items)).toEqual(['sub', 'sub:block-1', 'sub:block-2', 'lin-a', 'lin-b']);
  });
  it('is what a scenario source gets unless it gives its own', () => {
    const manifest = { id: 'demo', version: '1.0.0', permissions: ['knowledge:read'], surfaces: {}, knowledgeBinding: { mode: 'none' },
      learning: { version: 1, schemas: {}, activities: [{ id: 'a', surfaces: ['study'] }] } };
    const parsed = parseScenario('p', { prepare: true, study: { subsectionId: 's1' }, source: { text: 'One.' } }, manifest);
    expect(parsed.scenario?.source?.sourceRefs).toEqual(['s1', 's1:block-1']);
    const remote = parseScenario('r', { prepare: true, source: { media: [{ id: 'x', mimeType: 'image/png', url: 'https://example.com/x.png' }] } }, manifest);
    expect(remote.errors).toEqual([]);
  });
});

describe('activity launch (section 9)', () => {
  it('is a study run whose task is the offer', async () => {
    const study = { workspaceId: 'ws', lectureId: 'lec', lectureTitle: 'L', subsectionId: 'sub', subsectionTitle: 'S', depth: 'standard' as const, section: { objective: '', text: '' } };
    const context = await activityStudyContext({ extensionId: 'demo', addonVersion: '1.0.0', offerId: 'offer-1', payloadSchema: 'sequence-v1', study });
    expect(context.taskId).toBe('offer-1');
    expect(context.taskSchema).toBe('sequence-v1');
    expect(context.runId).toBe(`demo:offer-1:${context.contextFingerprint}`);
  });
});

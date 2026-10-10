import { describe, expect, it } from 'bun:test';
import { defineAddon, validateLearningContribution, validatePreparation } from '../src/learning.mjs';

const contribution = { version: 1, schemas: { 'sequence-v1': {
  type: 'object', required: ['steps'], additionalProperties: false,
  properties: { steps: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 2, maxItems: 12 } },
} }, activities: [{ id: 'order-steps', label: 'Order steps', payloadSchema: 'sequence-v1', maxSeconds: 180, surfaces: ['study'] }] };
const source = { workspaceId: 'w', lectureId: 'l', subsectionId: 's', fingerprint: 'f', objective: 'Learn a process', text: '',
  sourceRefs: ['lecture:l/section:s'], knowledge: [{ lineageId: 'k1', itemId: 'i1', conceptId: 'c1' }], media: [] };
const attachment = { id: 'sequence', schemaId: 'sequence-v1', payload: { steps: ['first', 'second'] }, sourceRefs: source.sourceRefs, knowledgeRefs: ['k1'] };
const offer = { id: 'order-one', activityId: 'order-steps', label: 'Order this process', payload: attachment.payload,
  sourceRefs: source.sourceRefs, knowledgeRefs: ['k1'], prerequisiteIds: [], estimatedSeconds: 120, contentKind: 'source-task' };
const preparation = () => ({ attachments: [structuredClone(attachment)], offers: [structuredClone(offer)] });

describe('public learning preparation contracts', () => {
  it('returns checked JSON without retaining mutable caller references', () => {
    const original = preparation();
    const checked = validatePreparation(original, contribution, source);
    original.offers[0].payload.steps[0] = 'mutated';
    expect(checked.offers[0].payload.steps[0]).toBe('first');
  });
  it('refuses ignored schema keywords and fields with spelling errors', () => {
    const invalid = structuredClone(contribution);
    invalid.schemas['sequence-v1'].allOf = [];
    expect(() => validateLearningContribution(invalid)).toThrow('unsupported schema keyword');
    const p = preparation(); p.offers[0].estimateSeconds = 3;
    expect(() => validatePreparation(p, contribution, source)).toThrow('estimateSeconds');
  });
  it('refuses duplicate activity IDs and unregistered schemas', () => {
    const invalid = structuredClone(contribution); invalid.activities.push(invalid.activities[0]);
    expect(() => validateLearningContribution(invalid)).toThrow('unique');
    invalid.activities.pop(); invalid.activities[0].payloadSchema = 'unknown-v1';
    expect(() => validateLearningContribution(invalid)).toThrow('register');
  });
  it('refuses forged source, knowledge and prerequisite references', () => {
    for (const field of ['sourceRefs', 'knowledgeRefs', 'prerequisiteIds']) {
      const p = preparation(); p.offers[0][field] = ['foreign-secret'];
      expect(() => validatePreparation(p, contribution, source)).toThrow('not supplied');
    }
  });
  it('refuses malformed and missing task data before launching anything', () => {
    const p = preparation(); p.offers[0].payload.steps = ['only-one'];
    expect(() => validatePreparation(p, contribution, source)).toThrow('schema limits');
    p.offers[0].payload = { steps: ['one', 'two'], secret: true };
    expect(() => validatePreparation(p, contribution, source)).toThrow('not declared');
    delete p.offers[0].payload;
    expect(() => validatePreparation(p, contribution, source)).toThrow('include the task');
  });
  it('refuses duration over the author limit and source-task without its source', () => {
    const p = preparation(); p.offers[0].estimatedSeconds = 181;
    expect(() => validatePreparation(p, contribution, source)).toThrow('180');
    p.offers[0].estimatedSeconds = 120; p.offers[0].sourceRefs = [];
    expect(() => validatePreparation(p, contribution, source)).toThrow('source-task');
  });
  it('enforces number, boolean, enum, string and object schema constraints', () => {
    const c = { version: 1, schemas: { values: { type: 'object', properties: {
      score: { type: 'integer', minimum: 1, maximum: 5 }, flag: { type: 'boolean' }, name: { type: 'string', minLength: 2, maxLength: 4, enum: ['good'] },
    }, required: ['score', 'flag', 'name'] } }, activities: [] };
    const p = { attachments: [{ ...attachment, schemaId: 'values', payload: { score: 2, flag: true, name: 'good' } }], offers: [] };
    expect(validatePreparation(p, c, source).attachments).toHaveLength(1);
    for (const payload of [{ score: 2.5, flag: true, name: 'good' }, { score: 6, flag: true, name: 'good' }, { score: 2, flag: 'true', name: 'good' }, { score: 2, flag: true, name: 'bad' }]) {
      p.attachments[0].payload = payload;
      expect(() => validatePreparation(p, c, source)).toThrow();
    }
  });
});

describe('defineAddon dispatch', () => {
  function job() {
    const completed = [];
    return { completed, host: { protocolVersion: 1, capabilities: ['addon-learning-v1'],
      props: { kind: 'addon-job', extensionId: 'test-addon', permissions: [], source, attachments: [] }, complete(result) { completed.push(result); } } };
  }
  it('extracts first, then supplies validated attachments to activity preparation', async () => {
    const { completed, host } = job(); const order = [];
    const result = await defineAddon({ learning: contribution,
      extract(s) { expect(s).toBe(source); order.push('extract'); return [attachment]; },
      offerActivities(context) { order.push('offer'); expect(context.attachments).toEqual([attachment]); return [offer]; },
      renderActivity() { throw new Error('wrong dispatch'); },
    }, { mnx: host });
    expect(order).toEqual(['extract', 'offer']);
    expect(completed).toEqual([{ completed: true, elapsedSeconds: 0, learningPreparation: result }]);
  });
  it('rejects unsupported job hosts and refuses to complete on invalid extraction', async () => {
    const { completed, host } = job(); host.capabilities = [];
    await expect(defineAddon({ learning: contribution }, { mnx: host })).rejects.toThrow('compatible');
    host.capabilities = ['addon-learning-v1'];
    await expect(defineAddon({ learning: contribution, extract: () => [{ ...attachment, schemaId: 'missing' }] }, { mnx: host })).rejects.toThrow('register');
    expect(completed).toEqual([]);
  });
  it('propagates refused AI calls without marking preparation as complete', async () => {
    const { completed, host } = job(); host.generate = () => Promise.reject(new Error('No model available'));
    await expect(defineAddon({ learning: contribution, extract: async (s, h) => h.generate({ prompt: s.text }) }, { mnx: host })).rejects.toThrow('No model');
    expect(completed).toEqual([]);
  });
  it('renders only the validated selected activity and preserves legacy standalone', async () => {
    const host = { protocolVersion: 1, capabilities: ['addon-learning-v1'], root: {}, complete() {}, exit() {},
      props: { kind: 'experience', extensionId: 'test-addon', surface: 'study', items: [], permissions: [], learningActivity: { offer, source }, study: { version: 1, runId: 'r', taskId: offer.id, contextFingerprint: 'f' } } };
    host.capabilities.push('study-examples-v1', 'study-storage-v1');
    const visited = [];
    const options = { learning: contribution, renderActivity(h) { visited.push(h.props.learningActivity.offer.id); }, renderStandalone() { visited.push('menu'); } };
    await defineAddon(options, { mnx: host }); delete host.props.learningActivity; host.props.surface = 'standalone'; await defineAddon(options, { mnx: host });
    expect(visited).toEqual(['order-one', 'menu']);
  });
  it('refuses to render an activity on an undeclared surface', async () => {
    const host = { protocolVersion: 1, capabilities: ['addon-learning-v1'], root: {}, complete() {}, exit() {},
      props: { kind: 'experience', extensionId: 'test-addon', surface: 'recall', items: [], permissions: [], learningActivity: { offer, source } } };
    await expect(defineAddon({ learning: contribution, renderActivity() { throw new Error('should not render'); } }, { mnx: host })).rejects.toThrow('does not support');
  });
});

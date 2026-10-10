import { describe, expect, it } from 'bun:test';
import { validateResult } from '../src/validate-result.mjs';

const study = { runId: 'ext:task:fp', taskId: 'task', contextFingerprint: 'fp' };
const good = () => ({
  completed: true, elapsedSeconds: 42,
  studyEvidence: { ...study, solvedStepIds: ['s1'], attempts: 2, hintsUsed: 0 },
});
const failing = (result, launch = { surface: 'study', study }) =>
  validateResult(result, launch).checks.filter(row => !row.pass).map(row => row.rule);

describe('study results', () => {
  it('accepts a matching result and says what the host keeps', () => {
    const report = validateResult(good(), { surface: 'study', study });
    expect(report.ok).toBe(true);
    expect(report.kept).toEqual(['completed', 'elapsedSeconds', 'studyEvidence']);
  });
  const cases = [
    ['completed === true', r => { r.completed = false; }],
    ['elapsedSeconds is finite, at least 0 and at most 86,400', r => { r.elapsedSeconds = 86401; }],
    ['elapsedSeconds is finite, at least 0 and at most 86,400', r => { r.elapsedSeconds = -1; }],
    ['elapsedSeconds is finite, at least 0 and at most 86,400', r => { r.elapsedSeconds = Infinity; }],
    ['studyEvidence.runId === props.study.runId', r => { r.studyEvidence.runId = 'other'; }],
    ['studyEvidence.taskId === props.study.taskId', r => { r.studyEvidence.taskId = 'other'; }],
    ['studyEvidence.contextFingerprint === props.study.contextFingerprint', r => { r.studyEvidence.contextFingerprint = 'x'; }],
    ['solvedStepIds: 1 to 128 non-empty strings of at most 128 characters each', r => { r.studyEvidence.solvedStepIds = []; }],
    ['solvedStepIds: 1 to 128 non-empty strings of at most 128 characters each', r => { r.studyEvidence.solvedStepIds = Array(129).fill('s'); }],
    ['solvedStepIds: 1 to 128 non-empty strings of at most 128 characters each', r => { r.studyEvidence.solvedStepIds = ['']; }],
    ['solvedStepIds: 1 to 128 non-empty strings of at most 128 characters each', r => { r.studyEvidence.solvedStepIds = ['x'.repeat(129)]; }],
    ['attempts: an integer from 0 to 100,000', r => { r.studyEvidence.attempts = 1.5; }],
    ['attempts: an integer from 0 to 100,000', r => { r.studyEvidence.attempts = 100001; }],
    ['hintsUsed: an integer from 0 to 100,000', r => { r.studyEvidence.hintsUsed = -1; }],
    ['studyEvidence is present', r => { delete r.studyEvidence; }],
  ];
  for (const [rule, mutate] of cases) {
    it(`fails "${rule}" when broken`, () => {
      const result = good();
      mutate(result);
      expect(failing(result)).toContain(rule);
    });
  }
});

describe('recall results', () => {
  const launch = { surface: 'recall' };
  it('requires quality 0-5', () => {
    expect(validateResult({ completed: true, elapsedSeconds: 3, quality: 5 }, launch).ok).toBe(true);
    expect(validateResult({ completed: true, elapsedSeconds: 3 }, launch).ok).toBe(false);
    expect(validateResult({ completed: true, elapsedSeconds: 3, quality: 6 }, launch).ok).toBe(false);
    expect(validateResult({ completed: true, elapsedSeconds: 3, quality: 2.5 }, launch).ok).toBe(false);
  });
});

describe('other surfaces', () => {
  it('labels which checks the host makes and which are the kit\'s', () => {
    const report = validateResult({ completed: true, elapsedSeconds: 1, quality: 3 }, { surface: 'recall' });
    expect(report.checks.find(c => c.rule.startsWith('quality')).by).toBe('host');
    expect(report.checks.find(c => c.rule.startsWith('completed')).by).toBe('kit');
    expect(validateResult(good(), { surface: 'study', study }).checks.every(c => c.by === 'host')).toBe(true);
  });
  it('checks itemCoverage: values 0-1, keyed by lineageId', () => {
    const items = [{ lineageId: 'L1', itemId: 'I1' }];
    const launch = { surface: 'standalone', items };
    expect(validateResult({ completed: true, elapsedSeconds: 1, itemCoverage: { L1: 0.5 } }, launch).ok).toBe(true);
    expect(validateResult({ completed: true, elapsedSeconds: 1, itemCoverage: { L1: 1.5 } }, launch).ok).toBe(false);
    expect(validateResult({ completed: true, elapsedSeconds: 1, itemCoverage: { I1: 1 } }, launch).ok).toBe(false);
  });
  it('checks the basic shape', () => {
    expect(validateResult({ completed: false, elapsedSeconds: 0 }, { surface: 'standalone' }).ok).toBe(true);
    expect(validateResult({ completed: 'yes', elapsedSeconds: 0 }, { surface: 'standalone' }).ok).toBe(false);
    expect(validateResult(null, { surface: 'standalone' }).ok).toBe(false);
  });
});

describe('learning preparation jobs', () => {
  const learning = { version: 1, schemas: { seq: { type: 'object', required: ['steps'], properties: { steps: { type: 'array', items: { type: 'string' } } } } },
    activities: [{ id: 'order', label: 'Order', payloadSchema: 'seq', maxSeconds: 60, surfaces: ['study'] }] };
  const source = { workspaceId: 'w', lectureId: 'l', subsectionId: 's', fingerprint: 'f', objective: '', text: '', knowledge: [], sourceRefs: ['s'], media: [] };
  const offer = { id: 'o1', activityId: 'order', label: 'Order it', payload: { steps: ['a', 'b'] }, sourceRefs: ['s'], knowledgeRefs: [],
    prerequisiteIds: [], estimatedSeconds: 30, contentKind: 'source-task' };
  const launch = { surface: 'addon-job', learning, source };
  it('accepts a preparation that matches the declaration and source', () => {
    expect(validateResult({ completed: true, elapsedSeconds: 0, learningPreparation: { attachments: [], offers: [offer] } }, launch).ok).toBe(true);
  });
  it('refuses fabricated references and undeclared activities, with the reason', () => {
    const forged = validateResult({ completed: true, elapsedSeconds: 0, learningPreparation: { attachments: [], offers: [{ ...offer, sourceRefs: ['other'] }] } }, launch);
    expect(forged.ok).toBe(false);
    expect(forged.checks.find(c => !c.pass).detail).toContain('not supplied');
    expect(validateResult({ completed: true, elapsedSeconds: 0, learningPreparation: { attachments: [], offers: [{ ...offer, activityId: 'nope' }] } }, launch).ok).toBe(false);
    expect(validateResult({ completed: true, elapsedSeconds: 0 }, launch).ok).toBe(false);
  });
});

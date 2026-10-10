/** Validate completion results (contract section 6).
 * Checks marked 'host' are enforced by the app; 'kit' checks are additional
 * authoring checks for surfaces that pass results to their own handlers. */

import { validatePreparation } from './learning.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isInteger(value) && value >= 0 && value <= 100000;

/**
 * @param {unknown} result what the add-on passed to mnx.complete
 * @param {{ surface: string, study?: { runId: string, taskId: string, contextFingerprint: string }, items?: { lineageId: string }[],
 *   learning?: unknown, source?: unknown }} launch  surface 'addon-job' is a learning preparation job
 * @returns {{ ok: boolean, checks: { rule: string, pass: boolean, by: 'host' | 'kit', detail?: string }[], kept?: string[] }}
 */
export function validateResult(result, { surface, study, items, learning, source } = {}) {
  const checks = [];
  const check = (by, rule, pass, detail) => checks.push(detail === undefined || pass ? { rule, pass, by } : { rule, pass, by, detail });
  const show = value => value === undefined ? 'missing' : JSON.stringify(value);

  if (!isObject(result)) {
    check(surface === 'study' ? 'host' : 'kit', 'result is an object', false, `got ${show(result)}`);
    return { ok: false, checks };
  }

  if (surface === 'addon-job') {
    // A learning preparation job (section 9): the host validates the
    // preparation against the declaration and the source it supplied.
    check('host', 'completed === true', result.completed === true, `completed is ${show(result.completed)}`);
    let detail;
    try { validatePreparation(result.learningPreparation, learning, source); }
    catch (error) { detail = String(error?.message ?? error); }
    check('host', 'learningPreparation matches the declaration and the supplied source', detail === undefined, detail);
    return { ok: checks.every(row => row.pass), checks };
  }

  if (surface === 'study') {
    const evidence = isObject(result.studyEvidence) ? result.studyEvidence : undefined;
    check('host', 'completed === true', result.completed === true, `completed is ${show(result.completed)}`);
    check('host', 'elapsedSeconds is finite, at least 0 and at most 86,400',
      typeof result.elapsedSeconds === 'number' && Number.isFinite(result.elapsedSeconds) &&
      result.elapsedSeconds >= 0 && result.elapsedSeconds <= 86400, `elapsedSeconds is ${show(result.elapsedSeconds)}`);
    check('host', 'studyEvidence is present', !!evidence, `studyEvidence is ${show(result.studyEvidence)}`);
    check('host', 'studyEvidence.runId === props.study.runId', !!evidence && evidence.runId === study?.runId,
      `expected ${show(study?.runId)}, got ${show(evidence?.runId)}`);
    check('host', 'studyEvidence.taskId === props.study.taskId', !!evidence && evidence.taskId === study?.taskId,
      `expected ${show(study?.taskId)}, got ${show(evidence?.taskId)}`);
    check('host', 'studyEvidence.contextFingerprint === props.study.contextFingerprint',
      !!evidence && evidence.contextFingerprint === study?.contextFingerprint,
      `expected ${show(study?.contextFingerprint)}, got ${show(evidence?.contextFingerprint)}`);
    const solved = evidence?.solvedStepIds;
    check('host', 'solvedStepIds: 1 to 128 non-empty strings of at most 128 characters each',
      Array.isArray(solved) && solved.length >= 1 && solved.length <= 128 &&
      solved.every(id => typeof id === 'string' && id.length >= 1 && id.length <= 128), `solvedStepIds is ${show(solved)}`);
    check('host', 'attempts: an integer from 0 to 100,000', isCount(evidence?.attempts), `attempts is ${show(evidence?.attempts)}`);
    check('host', 'hintsUsed: an integer from 0 to 100,000', isCount(evidence?.hintsUsed), `hintsUsed is ${show(evidence?.hintsUsed)}`);
    // The host keeps only these three fields from a study run.
    return { ok: checks.every(row => row.pass), checks, kept: ['completed', 'elapsedSeconds', 'studyEvidence'] };
  }

  if (surface === 'recall') {
    check('host', 'quality is an integer from 0 to 5 (required on recall)',
      Number.isInteger(result.quality) && result.quality >= 0 && result.quality <= 5, `quality is ${show(result.quality)}`);
  } else if ('quality' in result) {
    check('kit', 'quality, when given, is an integer from 0 to 5',
      Number.isInteger(result.quality) && result.quality >= 0 && result.quality <= 5, `quality is ${show(result.quality)}`);
  }
  check('kit', 'completed is true or false (only true counts as a use)', typeof result.completed === 'boolean', `completed is ${show(result.completed)}`);
  check('kit', 'elapsedSeconds is a finite number, at least 0',
    typeof result.elapsedSeconds === 'number' && Number.isFinite(result.elapsedSeconds) && result.elapsedSeconds >= 0,
    `elapsedSeconds is ${show(result.elapsedSeconds)}`);
  if ('completedStages' in result) {
    check('kit', 'completedStages is a list of text',
      Array.isArray(result.completedStages) && result.completedStages.every(stage => typeof stage === 'string'), `completedStages is ${show(result.completedStages)}`);
  }
  if ('itemCoverage' in result) {
    const coverage = result.itemCoverage;
    const values = isObject(coverage) ? Object.values(coverage) : [];
    check('kit', 'itemCoverage values are numbers from 0 to 1',
      isObject(coverage) && values.every(value => typeof value === 'number' && value >= 0 && value <= 1), `itemCoverage is ${show(coverage)}`);
    if (Array.isArray(items) && isObject(coverage)) {
      const lineages = new Set(items.map(item => item.lineageId));
      const unknown = Object.keys(coverage).filter(key => !lineages.has(key));
      check('kit', 'itemCoverage is keyed by the lineageId of an item you were given', unknown.length === 0,
        `not a lineageId of props.items: ${unknown.join(', ')}`);
    }
  }
  return { ok: checks.every(row => row.pass), checks };
}

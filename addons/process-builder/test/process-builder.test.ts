import { expect, it } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { buildPack } from '../../../sdk/src/build-pack.mjs';
import { validatePreparation } from '../../../sdk/src/learning.mjs';
import { buildAddon } from '../../../mock-host/src/addon';
import manifest from '../manifest.json';
import { extractSequences, offerSequences } from '../src/prepare';

const learning = manifest.learning as any;
const source = { workspaceId: 'w', lectureId: 'l', subsectionId: 's', fingerprint: 'f', objective: '', text: '', knowledge: [] as any[], sourceRefs: ['s'], media: [] };

it('offers an explicitly ordered knowledge sequence with its original target', () => {
  const s = { ...source, knowledge: [{ lineageId: 'lineage-a', descriptorStructure: 'sequence', structuredItems: ['one', 'two', 'three'] }] };
  const attachments = extractSequences(s as any);
  const result = validatePreparation({ attachments, offers: offerSequences({ attachments }) }, learning, s);
  expect(result.offers[0].knowledgeRefs).toEqual(['lineage-a']);
  expect(result.offers[0].payload.steps).toEqual(['one', 'two', 'three']);
});

it('uses contiguous numbered source steps when no structured knowledge exists', () => {
  const s = { ...source, text: '1. first\n2. second\n3. third' };
  const attachments = extractSequences(s as any);
  expect(validatePreparation({ attachments, offers: offerSequences({ attachments }) }, learning, s).offers[0].contentKind).toBe('source-task');
});

it('withholds tasks for unordered items, broken numbering and multiple lists', () => {
  for (const text of ['- one\n- two\n- three', '1. one\n3. three\n4. four', '1. one\n2. two\n1. another\n2. another']) {
    expect(extractSequences({ ...source, text } as any)).toEqual([]);
  }
  expect(extractSequences({ ...source, knowledge: [{ lineageId: 'a', descriptorStructure: 'list', structuredItems: ['a', 'b', 'c'] }] } as any)).toEqual([]);
});

it('runs the packed IIFE as a preparation job without a document or the app', async () => {
  const build = await buildAddon(join(import.meta.dir, '..'));
  expect(build.ok).toBe(true);
  const pack = await buildPack({ manifest, code: new TextEncoder().encode(build.code!) });
  expect(pack.manifest.learning).toEqual(learning);
  const supplied = { ...source, text: '1. First source step\n2. Second source step\n3. Third source step' };
  let complete!: (value: unknown) => void;
  const completed = new Promise(resolve => { complete = resolve; });
  const host = { protocolVersion: 1, capabilities: ['addon-learning-v1'],
    props: { kind: 'addon-job', extensionId: manifest.id, permissions: manifest.permissions, source: supplied, attachments: [] }, complete };
  runInNewContext(build.code!, { mnx: host }, { timeout: 1000 });
  // postMessage rebuilds JSON in the host's realm; a JSON round trip models it.
  const result = JSON.parse(JSON.stringify(await completed));
  expect(result.completed).toBe(true);
  const preparation = validatePreparation(result.learningPreparation, learning, supplied);
  expect(preparation.offers[0].payload.steps).toEqual(['First source step', 'Second source step', 'Third source step']);
  expect(preparation.offers[0].sourceRefs).toEqual(['s']);
}, 10000);

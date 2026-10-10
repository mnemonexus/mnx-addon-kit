import { describe, expect, it } from 'bun:test';
import { unzipSync, strFromU8 } from 'fflate';
import { buildPack } from '../src/build-pack.mjs';
import { getExperienceHost } from '../src/index.mjs';

const manifest = {
  schemaVersion: 'mnxpack_manifest_v1', id: 'test-addon', version: '0.1.0', kind: 'experience',
  label: 'Test', description: 'Public authoring test', icon: 'fa-solid fa-flask', author: 'Test',
  knowledgeBinding: { mode: 'none' }, surfaces: {}, permissions: [], engines: { mnxSdk: '1.0.0' },
  entry: { logicalPath: 'code/main.cjs' }, assets: [{ logicalPath: 'assets/task.json' }],
};
const code = new TextEncoder().encode('window.mnx.exit()');
const task = new TextEncoder().encode('{"task":"reviewed"}');
const assets = new Map([['assets/task.json', task]]);

describe('authoring without the application checkout', () => {
  it('ships exactly the authored task and executable with integrity metadata', async () => {
    const pack = await buildPack({ manifest, code, assets });
    const files = unzipSync(pack.bytes);
    expect(Object.keys(files).sort()).toEqual(['assets/task.json', 'code/main.cjs', 'pack.json']);
    expect(files['code/main.cjs']).toEqual(code);
    expect(files['assets/task.json']).toEqual(task);
    const decoded = JSON.parse(strFromU8(files['pack.json']));
    expect(decoded.entry.sizeBytes).toBe(code.length);
    expect(decoded.assets[0].mimeType).toBeNull();
    expect(decoded.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('changes semantic identity when either executable or reviewed task changes', async () => {
    const original = await buildPack({ manifest, code, assets });
    const changedCode = await buildPack({ manifest, code: new TextEncoder().encode('window.mnx.complete({})'), assets });
    const changedTask = await buildPack({ manifest, code, assets: new Map([['assets/task.json', code]]) });
    expect(original.manifest.contentHash).not.toBe(changedCode.manifest.contentHash);
    expect(original.manifest.contentHash).not.toBe(changedTask.manifest.contentHash);
  });
  it('refuses missing reviewed content and stale caller-supplied integrity metadata', async () => {
    await expect(buildPack({ manifest, code })).rejects.toThrow('Missing asset');
    await expect(buildPack({ manifest: { ...manifest, contentHash: 'old' }, code, assets })).rejects.toThrow('computed');
  });
  it('refuses malformed learning declarations before emitting an installable pack', async () => {
    await expect(buildPack({ manifest: { ...manifest, learning: { version: 2, schemas: {}, activities: [] } }, code, assets })).rejects.toThrow('version 1');
  });
  it('refuses study launch without its capability handshake and scoped context', () => {
    const host = { protocolVersion: 1, props: { kind: 'experience', extensionId: 'test', surface: 'study', items: [], permissions: [] }, root: {}, complete() {}, exit() {} };
    expect(() => getExperienceHost({ mnx: host })).toThrow('compatible');
  });
  it('accepts an explicitly negotiated study host', () => {
    const host = { protocolVersion: 1, capabilities: ['study-examples-v1', 'study-storage-v1'],
      props: { kind: 'experience', extensionId: 'test', surface: 'study', items: [], permissions: [],
        study: { version: 1, runId: 'run', taskId: 'task', contextFingerprint: 'source' } },
      root: {}, complete() {}, exit() {} };
    expect(getExperienceHost({ mnx: host })).toBe(host);
  });
});

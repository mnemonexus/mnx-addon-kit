import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { validateManifest } from '@mnemonexus/addon-sdk/validate';
import { newAddon } from '../src/new';
import { packAddon } from '../src/pack';
import { REPO_ROOT } from '../src/paths';

const id = `zz-test-${process.pid}`;
const dir = join(REPO_ROOT, 'addons', id);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('new and pack', () => {
  it('copies the starter with the new id and label', () => {
    newAddon(id, { label: 'Test Add-on' });
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.id).toBe(id);
    expect(manifest.label).toBe('Test Add-on');
    expect(validateManifest(manifest).ok).toBe(true);
    expect(existsSync(join(dir, 'scenarios', 'study.json'))).toBe(true);
    expect(existsSync(join(dir, 'dist'))).toBe(false);
  });
  it('starts a learning add-on from Process Builder with --learning', () => {
    const learningId = `${id}-learning`;
    const learningDir = join(REPO_ROOT, 'addons', learningId);
    try {
      newAddon(learningId, { learning: true });
      const manifest = JSON.parse(readFileSync(join(learningDir, 'manifest.json'), 'utf8'));
      expect(manifest).toMatchObject({ id: learningId, author: 'Your name', version: '0.1.0' });
      expect(manifest.learning.activities[0].id).toBe('order-process');
      expect(validateManifest(manifest).ok).toBe(true);
      expect(existsSync(join(learningDir, 'scenarios', 'study-activity.json'))).toBe(true);
    } finally {
      rmSync(learningDir, { recursive: true, force: true });
    }
  });
  it('refuses bad ids and existing folders', () => {
    expect(() => newAddon('Bad_Id')).toThrow('kebab-case');
    expect(() => newAddon(id)).toThrow('already exists');
  });
  it('packs to dist/<id>-<version>.mnxpack with every declared file', async () => {
    const result = await packAddon(dir);
    expect(result.path).toBe(join(dir, 'dist', `${id}-0.1.0.mnxpack`));
    const files = unzipSync(new Uint8Array(readFileSync(result.path)));
    expect(Object.keys(files).sort()).toEqual(['assets/illustration.svg', 'assets/tasks.json', 'code/main.cjs', 'pack.json']);
    const manifest = JSON.parse(strFromU8(files['pack.json']));
    expect(validateManifest(manifest, { stage: 'built' }).ok).toBe(true);
    expect(manifest.contentHash).toBe(result.contentHash);
  });
});

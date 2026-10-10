import { describe, expect, it } from 'bun:test';
import { zipSync, unzipSync } from 'fflate';
import { buildPack } from '../src/build-pack.mjs';
import { generateSigningKeyPair, publicKeyPemFromPrivate, signPack, verifyPack, checkPackIntegrity } from '../src/sign.mjs';

const manifest = {
  schemaVersion: 'mnxpack_manifest_v1', id: 'sign-test', version: '0.1.0', kind: 'experience',
  label: 'Sign test', description: 'Signing test', icon: 'fa-solid fa-key', author: 'Test',
  knowledgeBinding: { mode: 'none' }, surfaces: {}, permissions: [], engines: { mnxSdk: '1.0.0' },
  entry: { logicalPath: 'code/main.cjs' }, assets: [],
};
const pack = () => buildPack({ manifest, code: new TextEncoder().encode('window.mnx.exit()') });

// Every key here is made fresh for the test and thrown away.
describe('publisher signatures (preview)', () => {
  it('signs and verifies a pack', async () => {
    const keys = await generateSigningKeyPair();
    const { bytes, manifest: built } = await pack();
    const signature = await signPack(bytes, keys.privateKeyPem);
    expect(signature).toMatchObject({ alg: 'ed25519', keyId: keys.keyId, contentHash: built.contentHash });
    expect(await verifyPack(bytes, signature, keys.publicKeyPem)).toEqual({ ok: true, problems: [] });
  });
  it('derives the public key from the private key', async () => {
    const keys = await generateSigningKeyPair();
    expect(await publicKeyPemFromPrivate(keys.privateKeyPem)).toBe(keys.publicKeyPem);
  });
  it('refuses another key', async () => {
    const [mine, theirs] = [await generateSigningKeyPair(), await generateSigningKeyPair()];
    const { bytes } = await pack();
    const signature = await signPack(bytes, mine.privateKeyPem);
    const report = await verifyPack(bytes, signature, theirs.publicKeyPem);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('different key');
  });
  it('refuses a tampered signature or pack', async () => {
    const keys = await generateSigningKeyPair();
    const { bytes } = await pack();
    const signature = await signPack(bytes, keys.privateKeyPem);
    const flipped = { ...signature, signature: btoa('x'.repeat(64)) };
    expect((await verifyPack(bytes, flipped, keys.publicKeyPem)).ok).toBe(false);

    const files = unzipSync(bytes);
    files['code/main.cjs'] = new TextEncoder().encode('window.mnx.complete({})');
    const tampered = zipSync(files);
    const report = await verifyPack(tampered, signature, keys.publicKeyPem);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('wrong');
  });
  it('flags undeclared files', async () => {
    const files = unzipSync((await pack()).bytes);
    files['pack.sig.json'] = new TextEncoder().encode('{}');
    expect((await checkPackIntegrity(zipSync(files))).problems.join(' ')).toContain('not declared');
  });
});

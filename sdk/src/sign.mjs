/**
 * Preview Ed25519 signatures; the app does not verify them yet.
 * Signs mnxpack-signature-v1:<contentHash> into a detached <pack>.sig.json file.
 * Uses PKCS#8 private keys and SPKI public keys in PEM format.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { manifestContentHash, sha256Hex } from './build-pack.mjs';

export const SIGNATURE_PREFIX = 'mnxpack-signature-v1:';
const ALG = { name: 'Ed25519' };

const toBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

function toPem(label, bytes) {
  const body = toBase64(bytes).replace(/.{1,64}/g, line => line + '\n');
  return `-----BEGIN ${label}-----\n${body}-----END ${label}-----\n`;
}
function fromPem(label, pem) {
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`).exec(String(pem));
  if (!match) throw new Error(`Expected a PEM "${label}" block.`);
  return fromBase64(match[1].replace(/\s+/g, ''));
}

/** A key id: the first 16 hex characters of SHA-256 over the raw 32-byte public key. */
export async function keyIdFor(publicKey) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  return (await sha256Hex(raw)).slice(0, 16);
}

/** Make a new key pair. For tests and local trials only. */
export async function generateSigningKeyPair() {
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  return {
    privateKeyPem: toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicKeyPem: toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)),
    keyId: await keyIdFor(pair.publicKey),
  };
}

export async function importPrivateKey(pem) {
  return crypto.subtle.importKey('pkcs8', fromPem('PRIVATE KEY', pem), ALG, true, ['sign']);
}

export async function importPublicKey(pem) {
  return crypto.subtle.importKey('spki', fromPem('PUBLIC KEY', pem), ALG, true, ['verify']);
}

/** The public half of a private key, as a PEM string. */
export async function publicKeyPemFromPrivate(privatePem) {
  const jwk = await crypto.subtle.exportKey('jwk', await importPrivateKey(privatePem));
  const publicKey = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, ALG, true, ['verify']);
  return toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', publicKey));
}

/** Read pack.json out of a .mnxpack. */
export function readPackManifest(packBytes) {
  const files = unzipSync(packBytes);
  if (!files['pack.json']) throw new Error('This is not a .mnxpack: it has no pack.json.');
  return { manifest: JSON.parse(strFromU8(files['pack.json'])), files };
}

/** Sign a built pack. Returns the object to save as `<pack>.sig.json`. */
export async function signPack(packBytes, privateKeyPem) {
  const { manifest } = readPackManifest(packBytes);
  const integrity = await checkPackIntegrity(packBytes);
  if (!integrity.ok) throw new Error(`Refusing to sign a damaged pack: ${integrity.problems.join(' ')}`);
  const privateKey = await importPrivateKey(privateKeyPem);
  const publicKey = await importPublicKey(await publicKeyPemFromPrivate(privateKeyPem));
  const message = new TextEncoder().encode(SIGNATURE_PREFIX + manifest.contentHash);
  const signature = await crypto.subtle.sign(ALG, privateKey, message);
  return { alg: 'ed25519', keyId: await keyIdFor(publicKey), contentHash: manifest.contentHash, signature: toBase64(signature) };
}

/**
 * Re-check a pack's hashes the way the app does on install: every file is
 * declared, every size and hash matches, and contentHash matches the manifest.
 */
export async function checkPackIntegrity(packBytes) {
  const problems = [];
  let manifest, files;
  try { ({ manifest, files } = readPackManifest(packBytes)); }
  catch (error) { return { ok: false, problems: [error.message] }; }
  const declared = new Map();
  if (manifest.entry) declared.set(manifest.entry.logicalPath, manifest.entry);
  for (const asset of manifest.assets ?? []) declared.set(asset.logicalPath, asset);
  for (const path of Object.keys(files)) {
    if (path !== 'pack.json' && !declared.has(path)) problems.push(`"${path}" is in the pack but not declared.`);
  }
  for (const [path, row] of declared) {
    const bytes = files[path];
    if (!bytes) { problems.push(`"${path}" is declared but missing.`); continue; }
    if (row.sizeBytes !== bytes.length) problems.push(`"${path}" has the wrong size.`);
    if (row.contentHash !== await sha256Hex(bytes)) problems.push(`"${path}" has the wrong hash.`);
  }
  if (manifest.contentHash !== await manifestContentHash(manifest)) problems.push('contentHash does not match the manifest.');
  return { ok: problems.length === 0, problems, manifest };
}

/**
 * Check a detached signature against a pack and a public key.
 * Returns `{ ok, problems }`; `problems` is empty when ok.
 */
export async function verifyPack(packBytes, signature, publicKeyPem) {
  const integrity = await checkPackIntegrity(packBytes);
  const problems = [...integrity.problems];
  if (!signature || typeof signature !== 'object') return { ok: false, problems: [...problems, 'The signature file is not a JSON object.'] };
  if (signature.alg !== 'ed25519') problems.push('The signature alg must be "ed25519".');
  if (integrity.manifest && signature.contentHash !== integrity.manifest.contentHash) {
    problems.push('The signature is for a different pack (contentHash differs).');
  }
  let publicKey;
  try { publicKey = await importPublicKey(publicKeyPem); }
  catch { problems.push('The public key could not be read. Expected a PEM "PUBLIC KEY" block.'); }
  if (publicKey) {
    if (signature.keyId !== await keyIdFor(publicKey)) problems.push('The signature names a different key (keyId differs).');
    let valid = false;
    try {
      const message = new TextEncoder().encode(SIGNATURE_PREFIX + signature.contentHash);
      valid = await crypto.subtle.verify(ALG, publicKey, fromBase64(String(signature.signature)), message);
    } catch { valid = false; }
    if (!valid) problems.push('The signature does not match.');
  }
  return { ok: problems.length === 0, problems };
}

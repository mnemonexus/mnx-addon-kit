import { zipSync, unzipSync, strToU8 } from 'fflate';
import { validateLearningContribution } from './learning.mjs';

export const PACK_LIMITS = Object.freeze({
  maxCodeBytes: 8 * 1024 * 1024, maxPackBytes: 256 * 1024 * 1024,
  maxUncompressedBytes: 512 * 1024 * 1024, maxManifestBytes: 512 * 1024,
  maxAssetCount: 4096, maxAssetPathLength: 256,
});

function safePath(path, prefix) {
  // Authoring uses canonical paths only; the closed-source host independently
  // validates the same container before installation or execution.
  if (typeof path !== 'string' || path.length > PACK_LIMITS.maxAssetPathLength ||
      !path.startsWith(prefix) || /[\\%\u0000-\u001f\u007f]/.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Use a canonical ${prefix} path: ${path}`);
  }
  return path;
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

async function hash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The manifest's contentHash: SHA-256 over the canonical JSON of the manifest
 * without its own contentHash. Used by verifyPack to re-check a built pack.
 */
export async function manifestContentHash(manifest) {
  const { contentHash, ...rest } = manifest;
  return hash(strToU8(canonical(rest)));
}

/** SHA-256 of some bytes, as lowercase hex. */
export function sha256Hex(bytes) {
  return hash(bytes);
}

/** Independently implements the public ZIP/hash format. No app imports. */
export async function buildPack({ manifest: input, code, assets = new Map() }) {
  if (!(code instanceof Uint8Array) || !code.length || code.length > PACK_LIMITS.maxCodeBytes) {
    throw new Error('The executable entry must contain 1 byte to 8 MiB.');
  }
  // JSON-round-trip rejects cycles and strips undefined before hashing. The
  // host remains the authority for manifest schema and permission coherence.
  const base = JSON.parse(JSON.stringify(input));
  if (base.learning !== undefined) base.learning = validateLearningContribution(base.learning);
  if (base.schemaVersion !== 'mnxpack_manifest_v1') throw new Error('Unsupported pack schema.');
  if ('contentHash' in base) throw new Error('contentHash is computed by the builder.');
  const entryPath = safePath(base.entry?.logicalPath, 'code/');
  const declarations = base.assets ?? [];
  if (declarations.length > PACK_LIMITS.maxAssetCount) throw new Error('Too many assets.');
  const paths = new Set();
  for (const asset of declarations) {
    const path = safePath(asset.logicalPath, 'assets/');
    if (paths.has(path)) throw new Error(`Duplicate asset: ${path}`);
    if (!(assets.get(path) instanceof Uint8Array)) throw new Error(`Missing asset bytes: ${path}`);
    paths.add(path);
  }
  for (const path of assets.keys()) {
    safePath(path, 'assets/');
    if (!paths.has(path)) throw new Error(`Undeclared asset: ${path}`);
  }
  let expanded = code.length;
  const entries = {};
  entries[entryPath] = code;
  const rows = [];
  for (const asset of declarations) {
    const bytes = assets.get(asset.logicalPath);
    expanded += bytes.length;
    if (expanded > PACK_LIMITS.maxUncompressedBytes) throw new Error('Pack expands beyond 512 MiB.');
    entries[asset.logicalPath] = bytes;
    rows.push({ logicalPath: asset.logicalPath, sizeBytes: bytes.length,
      contentHash: await hash(bytes), mimeType: asset.mimeType ?? null });
  }
  const manifest = { ...base, entry: { logicalPath: entryPath, sizeBytes: code.length,
    contentHash: await hash(code) }, assets: rows };
  manifest.contentHash = await hash(strToU8(canonical(manifest)));
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  if (manifestBytes.length > PACK_LIMITS.maxManifestBytes) throw new Error('Manifest exceeds 512 KiB.');
  if (expanded + manifestBytes.length > PACK_LIMITS.maxUncompressedBytes) throw new Error('Pack expands beyond 512 MiB.');
  entries['pack.json'] = manifestBytes;
  const bytes = zipSync(entries, { level: 9 });
  if (bytes.length > PACK_LIMITS.maxPackBytes) throw new Error('Pack exceeds 256 MiB.');
  // Detect damaged build output; installation still validates independently.
  const decoded = unzipSync(bytes);
  for (const [path, original] of Object.entries(entries)) {
    if (await hash(decoded[path]) !== await hash(original)) throw new Error(`ZIP verification failed: ${path}`);
  }
  return { bytes, manifest, packHash: await hash(bytes) };
}

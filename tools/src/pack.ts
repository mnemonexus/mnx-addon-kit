/** `mnx pack <id>`: build and write addons/<id>/dist/<id>-<version>.mnxpack. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPack } from '@mnemonexus/addon-sdk/pack';
import { validateManifest } from '@mnemonexus/addon-sdk/validate';
import { buildAddon, readDeclaredAssets, readManifest } from '@mnemonexus/mock-host/addon';
import { UserError } from './paths';

export async function packAddon(dir: string) {
  const { manifest, error } = readManifest(dir);
  if (error) throw new UserError(error);
  const report = validateManifest(manifest);
  if (!report.ok) {
    throw new UserError(`manifest.json has problems the app would refuse:\n${report.errors.map(e => `  ${e.path}: ${e.message}`).join('\n')}\nRun "bun run check" for details.`);
  }
  const build = await buildAddon(dir);
  if (!build.ok) throw new UserError(`The code does not build:\n${build.errors.join('\n')}`);
  const { assets, missing } = readDeclaredAssets(dir, manifest);
  if (missing.length) throw new UserError(`These declared assets are missing: ${missing.join(', ')}.`);
  const pack = await buildPack({ manifest, code: new TextEncoder().encode(build.code!), assets });
  const built = validateManifest(pack.manifest, { stage: 'built' });
  if (!built.ok) throw new Error(`The built pack.json is invalid: ${built.errors.map(e => e.message).join(' ')}`);
  const out = join(dir, 'dist', `${manifest.id}-${manifest.version}.mnxpack`);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(out, pack.bytes);
  return { path: out, bytes: pack.bytes.length, contentHash: pack.manifest.contentHash as string, files: 1 + assets.size };
}

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAddon } from '@mnemonexus/mock-host/addon';
import { scanCode } from '../src/scan';
import { dependencyOf, sourceLocator } from '../src/sourcemap';

const root = mkdtempSync(join(tmpdir(), 'mnx-sourcemap-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

describe('finding where a finding comes from', () => {
  it('names the dependency, and leaves the add-on\'s own code alone', async () => {
    write({
      'manifest.json': '{}',
      'package.json': JSON.stringify({ dependencies: { 'old-lib': '1.0.0', '@scope/kit': '1.0.0' } }),
      'node_modules/old-lib/package.json': JSON.stringify({ name: 'old-lib', main: 'index.js' }),
      'node_modules/old-lib/index.js': 'export function load() { try { return localStorage.getItem("k"); } catch { return null; } }',
      'node_modules/@scope/kit/package.json': JSON.stringify({ name: '@scope/kit', main: 'index.js' }),
      'node_modules/@scope/kit/index.js': 'export const compile = text => new Function(text);',
      'src/main.ts': 'import { load } from "old-lib";\nimport { compile } from "@scope/kit";\nconsole.log(load(), compile, sessionStorage.length);',
    });
    const build = await buildAddon(root, { sourcemap: true });
    expect(build.errors).toEqual([]);
    expect(build.map).toBeTruthy();
    const where = sourceLocator(build.code!, build.map!);
    const found = scanCode(build.code!, { network: false }).map(finding => `${finding.rule}:${dependencyOf(where(finding.index!)) ?? 'own'}`);
    expect(found.sort()).toEqual(['no-browser-storage:old-lib', 'no-browser-storage:own', 'no-eval:@scope/kit']);
  });

  it('reads package names from paths', () => {
    expect(dependencyOf('node_modules/a/b.js')).toBe('a');
    expect(dependencyOf('../../node_modules/@s/p/dist/x.js')).toBe('@s/p');
    expect(dependencyOf('node_modules/a/node_modules/b/i.js')).toBe('b');
    expect(dependencyOf('node:assert')).toBe('node:assert');
    expect(dependencyOf('src/main.ts')).toBeUndefined();
    expect(dependencyOf(undefined)).toBeUndefined();
  });
});

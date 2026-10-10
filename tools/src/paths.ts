/** Finding add-on folders by id or path. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { REPO_ROOT } from '@mnemonexus/mock-host';

export { REPO_ROOT };
export const ADDON_ROOTS = ['addons', 'examples', 'templates', 'ui'];

/** Every folder with a manifest.json under addons/, examples/, templates/ and ui/ (the UI gallery). */
export function allAddonDirs(): string[] {
  const dirs: string[] = [];
  for (const root of ADDON_ROOTS) {
    const base = join(REPO_ROOT, root);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const dir = join(base, name);
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'manifest.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

/** `quick-check`, `addons/quick-check` or `./some/path` → an add-on folder. */
export function resolveAddon(idOrPath: string): string {
  const direct = resolve(idOrPath);
  if (existsSync(join(direct, 'manifest.json'))) return direct;
  for (const root of ADDON_ROOTS) {
    const dir = join(REPO_ROOT, root, idOrPath);
    if (existsSync(join(dir, 'manifest.json'))) return dir;
  }
  // Templates live in a folder named for their kind; match on manifest id too.
  for (const dir of allAddonDirs()) {
    try {
      if (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).id === idOrPath) return dir;
    } catch { /* unreadable manifests are reported by check */ }
  }
  const known = allAddonDirs().map(dir => basename(dir)).join(', ') || 'none yet';
  throw new UserError(`No add-on called "${idOrPath}". Looked in addons/, examples/, templates/ and ui/. Known: ${known}.\nCreate one with: bun run new ${idOrPath}`);
}

export const show = (dir: string) => relative(process.cwd(), dir) || '.';

/** An error the user can fix. Printed without a stack trace. */
export class UserError extends Error {}

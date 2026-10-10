/**
 * `mnx new <id>`: copy templates/experience to addons/<id>, with your id and label.
 * `mnx new <id> --learning`: copy addons/process-builder instead, the working
 * learning add-on (addon-learning-v1), as a starting point.
 */
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { REPO_ROOT, UserError } from './paths';

const STARTERS = {
  experience: { dir: join(REPO_ROOT, 'templates', 'experience'), id: 'quick-check', label: 'Quick Check' },
  learning: { dir: join(REPO_ROOT, 'addons', 'process-builder'), id: 'process-builder', label: 'Process Builder' },
};
const SKIP = new Set(['dist', '.mnx-dev', 'node_modules', 'screenshots']);
const TEXT = new Set(['.json', '.ts', '.js', '.md', '.css', '.html', '.txt']);

export const titleCase = (id: string) => id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

export function newAddon(id: string, options: { label?: string; root?: string; learning?: boolean } = {}): string {
  const starter = STARTERS[options.learning ? 'learning' : 'experience'];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) {
    throw new UserError(`"${id}" is not a valid add-on id. Use lowercase kebab-case, 1 to 64 characters, like "cell-quiz".`);
  }
  const label = options.label ?? titleCase(id);
  if (!label || label.length > 80) throw new UserError('The label must be 1 to 80 characters.');
  const target = join(options.root ?? join(REPO_ROOT, 'addons'), id);
  if (existsSync(target)) throw new UserError(`${target} already exists. Pick another id, or delete that folder first.`);

  cpSync(starter.dir, target, { recursive: true, filter: source => !SKIP.has(source.split(/[\\/]/).pop()!) });
  const walk = (dir: string) => {
    for (const original of readdirSync(dir)) {
      // Files named after the starter take your id too.
      const name = original.replaceAll(starter.id, id);
      if (name !== original) renameSync(join(dir, original), join(dir, name));
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (TEXT.has(extname(name))) {
        const text = readFileSync(path, 'utf8');
        let next = text.replaceAll(starter.id, id).replaceAll(starter.label, label);
        // A copy of an official add-on is yours: your name, a fresh version.
        if (name === 'manifest.json') next = next.replace(/"author": "MnemoNexus"/, '"author": "Your name"').replace(/"version": "[^"]+"/, '"version": "0.1.0"');
        if (next !== text) writeFileSync(path, next);
      }
    }
  };
  walk(target);
  return target;
}

/**
 * Reading an add-on folder: its manifest, its entry file, its scenarios, and
 * bundling its code into the single IIFE script the sandbox runs.
 *
 *   addons/<id>/
 *     manifest.json      the manifest you write (the pack builder adds hashes)
 *     src/main.ts        the entry (or src/main.js, main.ts, main.js, addon.js)
 *     assets/…           files declared in manifest.assets
 *     scenarios/*.json   launches for the mock host and `mnx check`
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseScenario, type Scenario } from './core/scenario';

export const ENTRY_CANDIDATES = [
  'src/main.ts', 'src/main.tsx', 'src/main.js', 'src/main.jsx', 'src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx',
  'main.ts', 'main.js', 'addon.js',
];

export interface ScenarioReport { name: string; scenario?: Scenario; errors: string[]; warnings: string[] }

export interface LoadedAddon {
  dir: string;
  manifest: any;
  manifestError?: string;
  entry?: string;
  scenarios: ScenarioReport[];
}

export function findEntry(dir: string): string | undefined {
  return ENTRY_CANDIDATES.map(candidate => join(dir, candidate)).find(path => existsSync(path));
}

export function readManifest(dir: string): { manifest?: any; error?: string } {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) return { error: `There is no manifest.json in ${dir}.` };
  try {
    return { manifest: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { error: `manifest.json is not valid JSON: ${(error as Error).message}` };
  }
}

export function loadScenarios(dir: string, manifest: any): ScenarioReport[] {
  const folder = join(dir, 'scenarios');
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(file => file.endsWith('.json')).sort().map(file => {
    const name = file.replace(/\.json$/, '');
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(folder, file), 'utf8')); }
    catch (error) { return { name, errors: [`scenarios/${file} is not valid JSON: ${(error as Error).message}`], warnings: [] }; }
    const view = { id: manifest?.id ?? '', version: manifest?.version ?? '', surfaces: manifest?.surfaces ?? {},
      permissions: manifest?.permissions ?? [], knowledgeBinding: manifest?.knowledgeBinding, learning: manifest?.learning };
    return { name, ...parseScenario(name, raw, view) };
  });
}

export function loadAddon(dir: string): LoadedAddon {
  const absolute = resolve(dir);
  const { manifest, error } = readManifest(absolute);
  return {
    dir: absolute,
    manifest,
    manifestError: error,
    entry: findEntry(absolute),
    scenarios: manifest ? loadScenarios(absolute, manifest) : [],
  };
}

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SDK_DIR = join(KIT_ROOT, 'sdk');
const UI_DIR = join(KIT_ROOT, 'ui');

/** The kit's own packages an add-on may import, and where they live. */
const KIT_PACKAGES: Record<string, string> = {
  '@mnemonexus/addon-sdk': SDK_DIR,
  '@mnemonexus/addon-ui': UI_DIR,
};

/** `@mnemonexus/addon-ui/tailwind.css` → the file, through the package's export map. */
export function resolveKitImport(specifier: string): string | undefined {
  for (const [name, dir] of Object.entries(KIT_PACKAGES)) {
    if (specifier !== name && !specifier.startsWith(name + '/')) continue;
    const exports = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).exports as Record<string, string | { import: string }>;
    const subpath = '.' + specifier.slice(name.length);
    const target = exports[subpath];
    const file = typeof target === 'string' ? target : target?.import;
    if (!file) throw new Error(`${name} has no export "${subpath}".`);
    return join(dir, file);
  }
  return undefined;
}

/**
 * Resolve `@mnemonexus/addon-sdk` and `@mnemonexus/addon-ui` (and their
 * subpaths) straight to sdk/ and ui/, using their export maps. An add-on
 * folder is not a workspace package, so it must not depend on how the package
 * manager laid out node_modules (hoisted or isolated).
 */
export const kitAliasPlugin: import('bun').BunPlugin = {
  name: 'mnemonexus-kit-packages',
  setup(build) {
    build.onResolve({ filter: /^@mnemonexus\/addon-(sdk|ui)(\/.*)?$/ }, args => ({ path: resolveKitImport(args.path)! }));
  },
};
/** @deprecated The earlier name: it now resolves both kit packages. */
export const sdkAliasPlugin = kitAliasPlugin;

/** Tailwind's own directives, in either version's spelling. */
const TAILWIND_IMPORT = /@import\s+(["'])tailwindcss(\/[^"']*)?\1[^;]*;/;
const TAILWIND_V3 = /@tailwind\s+(base|components|utilities)\s*;/g;
export const usesTailwind = (css: string) => TAILWIND_IMPORT.test(css) || /@tailwind\s+(base|components|utilities)\s*;/.test(css);

/** Words in the add-on's code that could be Tailwind classes. Tailwind ignores those that aren't. */
function tailwindCandidates(dir: string): string[] {
  const candidates = new Set<string>();
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) { if (!['node_modules', 'dist', 'screenshots', '.mnx-dev'].includes(name)) walk(path); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs|html)$/.test(name)) continue;
      for (const word of readFileSync(path, 'utf8').match(/[^<>"'`\s,;{}]+/g) ?? []) candidates.add(word);
    }
  };
  const src = join(dir, 'src');
  walk(existsSync(src) ? src : dir);
  return [...candidates];
}

const TAILWIND_CONFIGS = ['tailwind.config.ts', 'tailwind.config.mts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs'];

/** The add-on's own Tailwind config, if it brings one (a project ported from elsewhere, say). */
export function tailwindConfig(addonDir: string): string | undefined {
  return TAILWIND_CONFIGS.map(name => join(addonDir, name)).find(path => existsSync(path));
}

/**
 * Compile Tailwind 4 with the MnemoNexus preset. Accept Tailwind 3 directives;
 * projects with their own config retain its palette and v3 compatibility rules.
 */
export async function compileTailwind(css: string, file: string, addonDir: string): Promise<string> {
  const { compile, optimize } = await import('@tailwindcss/node');
  const tailwindDir = dirname(dirname(createRequire(import.meta.url).resolve('tailwindcss')));
  const config = tailwindConfig(addonDir);
  let input = css;
  if (!TAILWIND_IMPORT.test(input)) input = `@import "tailwindcss";\n${input}`;
  input = input.replace(TAILWIND_V3, '');
  const additions: string[] = [];
  if (!input.includes('@mnemonexus/addon-ui/tailwind')) {
    additions.push(`@import "@mnemonexus/addon-ui/${config ? 'tailwind-tokens.css' : 'tailwind.css'}";`);
    if (config) additions.push('@import "@mnemonexus/addon-ui/tailwind-v3.css";');
  }
  if (config && !/@config\s/.test(input)) additions.push(`@config "${config.split('\\').join('/')}";`);
  if (additions.length) input = input.replace(TAILWIND_IMPORT, match => [match, ...additions].join('\n'));
  const compiler = await compile(input, {
    base: dirname(file),
    // Keep url() in imported stylesheets pointing at the right files.
    shouldRewriteUrls: true,
    onDependency() {},
    async customCssResolver(id) {
      if (id === 'tailwindcss') return join(tailwindDir, 'index.css');
      if (id.startsWith('tailwindcss/')) return join(tailwindDir, id.slice('tailwindcss/'.length));
      return resolveKitImport(id);
    },
  });
  const candidates = tailwindCandidates(addonDir);
  const output = optimize(compiler.build(candidates), { minify: true }).code;
  const fixed = fixVariableShorthand(output);
  return config ? withV3Opacity(fixed, candidates) : fixed;
}

/**
 * Tailwind 3 wrote `bg-[--brand]` for `bg-[var(--brand)]`. Tailwind 4 reads
 * it as the bare word `--brand`, which is not a value, so put the var() back.
 */
export function fixVariableShorthand(css: string): string {
  return css.replace(/([^{}]*\\\[--[^{}]*)\{([^{}]*)\}/g, (rule, selector: string, body: string) =>
    `${selector}{${body.replace(/(^|;)([\w-]+):(--[\w-]+)(?=;|$)/g, '$1$2:var($3)')}}`);
}

/** Tailwind 3's opacity utilities, and the colour declarations each one scales. */
const V3_OPACITY: { kind: string; property: RegExp }[] = [
  { kind: 'bg', property: /^background-color$/ },
  { kind: 'text', property: /^color$/ },
  { kind: 'border', property: /^border(-[a-z]+)*-color$/ },
  { kind: 'divide', property: /^border(-[a-z]+)*-color$/ },
  { kind: 'ring', property: /^--tw-ring-color$/ },
  { kind: 'placeholder', property: /^color$/ },
];

/**
 * Make colour utilities read Tailwind 3's opacity utilities (defined in
 * tailwind-v3.css): `bg-red-500 bg-opacity-50` is red at 50%. Only for the
 * kinds the add-on uses.
 */
export function withV3Opacity(css: string, candidates: string[]): string {
  const used = V3_OPACITY.filter(({ kind }) => candidates.some(word => new RegExp(`(^|:|!)${kind}-opacity-`).test(word)));
  if (!used.length) return css;
  return css.replace(/([^{}]*)\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    if (selector.trimStart().startsWith('@')) return rule;
    let changed = body;
    for (const { kind, property } of used) {
      // The class, after any variants: .bg-red-500, .hover\:bg-red-500, :where(.divide-gray-200>…)
      if (!new RegExp(`\\.(?:[\\w-]+\\\\:)*(?:\\\\!)?${kind}-`).test(selector)) continue;
      changed = changed.replace(/(^|;)([\w-]+):([^;]+)/g, (declaration, start: string, name: string, value: string) => {
        const important = value.endsWith('!important') ? '!important' : '';
        const colour = important ? value.slice(0, -important.length) : value;
        if (!property.test(name) || /^(inherit|initial|unset|revert|revert-layer)$/i.test(colour.trim())) return declaration;
        return `${start}${name}:color-mix(in oklab,${colour} var(--tw-${kind}-opacity),transparent)${important}`;
      });
    }
    return `${selector}{${changed}}`;
  });
}

/** Files that code or CSS may pull in, and their types. The sandbox only loads them as data: URLs. */
const INLINE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

/**
 * Turn `url(./file)` in a stylesheet into a data: URL, the only kind the
 * sandbox loads. Remote URLs are left for the static scan to report.
 */
export function inlineCssUrls(css: string, cssDir: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote, ref: string) => {
    if (/^(data:|blob:|https?:|\/\/|#)/i.test(ref)) return match;
    const path = resolve(cssDir, ref.split(/[?#]/)[0]);
    const type = INLINE_TYPES[path.slice(path.lastIndexOf('.')).toLowerCase()];
    if (!type || !existsSync(path)) return match;
    return `url("data:${type};base64,${readFileSync(path).toString('base64')}")`;
  });
}

/** Images and fonts the code imports (`import logo from './logo.svg'`) become data: URLs inside the script. */
export const inlineFilesPlugin: import('bun').BunPlugin = {
  name: 'mnemonexus-inline-files',
  setup(build) {
    const filter = new RegExp(`\\.(${Object.keys(INLINE_TYPES).map(extension => extension.slice(1)).join('|')})$`, 'i');
    build.onLoad({ filter }, args => {
      const type = INLINE_TYPES[args.path.slice(args.path.lastIndexOf('.')).toLowerCase()];
      return { loader: 'js', contents: `export default ${JSON.stringify(`data:${type};base64,${readFileSync(args.path).toString('base64')}`)};` };
    });
  },
};

/**
 * Inline imported CSS/Sass in the bundle, compile Tailwind and CSS modules,
 * and embed local url() assets as data URLs.
 */
export function cssPlugin(addonDir: string): import('bun').BunPlugin {
  return {
    name: 'mnemonexus-css',
    setup(build) {
      build.onLoad({ filter: /\.(css|scss|sass)$/ }, async args => {
        let css = /\.s[ac]ss$/.test(args.path) ? await compileSass(args.path, addonDir) : readFileSync(args.path, 'utf8');
        if (usesTailwind(css)) css = await compileTailwind(css, args.path, addonDir);
        css = inlineCssUrls(css, dirname(args.path));
        let classes: Record<string, string> | undefined;
        if (/\.module\.(css|scss|sass)$/.test(args.path)) ({ css, classes } = await cssModule(css, args.path, addonDir));
        // Guarded: a learning add-on's preparation job may run with no document.
        return {
          loader: 'js',
          contents: `if (typeof document !== 'undefined') { const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.appendChild(style); }`
            + (classes ? `\nexport default ${JSON.stringify(classes)};` : ''),
        };
      });
    },
  };
}

/** Compile Sass. Imports are looked up next to the file, then in the add-on's node_modules. */
export async function compileSass(file: string, addonDir: string): Promise<string> {
  const sass = await import('sass');
  const nodeModules = join(addonDir, 'node_modules');
  const result = sass.compile(file, {
    loadPaths: [nodeModules],
    style: 'expanded',
    // Older projects trip Sass's deprecation warnings by the hundred; they don't change the CSS.
    logger: sass.Logger.silent,
    importers: [{
      // webpack's "~package/file" means "from node_modules".
      findFileUrl: (url: string) => url.startsWith('~') ? pathToFileURL(join(nodeModules, url.slice(1))) : null,
    }],
  });
  return result.css;
}

/** A CSS module: unique class names, and the map from each name to its unique one. */
export async function cssModule(css: string, file: string, addonDir: string): Promise<{ css: string; classes: Record<string, string> }> {
  const { transform } = await import('lightningcss');
  // Named from the path inside the add-on, so the names are the same on every machine.
  const filename = relative(addonDir, file).split('\\').join('/');
  const result = transform({ filename, code: Buffer.from(css), cssModules: { pattern: '[local]_[hash]' } });
  const classes = Object.fromEntries(Object.entries(result.exports ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [
    name, [value.name, ...value.composes.filter(other => other.type !== 'dependency').map(other => other.name)].join(' '),
  ]));
  return { css: result.code.toString(), classes };
}

/**
 * The add-on's own package.json, when it has one (a project ported from
 * elsewhere usually does): its dependencies are bundled from its node_modules.
 */
export function addonPackage(dir: string): { dependencies: Record<string, string>; browser: Record<string, string | false> } | undefined {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return undefined;
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    return {
      dependencies: { ...(json.dependencies ?? {}), ...(json.peerDependencies ?? {}) },
      browser: json.browser && typeof json.browser === 'object' ? json.browser : {},
    };
  } catch { return undefined; }
}

/** Dependencies listed in the add-on's package.json that are not installed. */
export function missingDependencies(dir: string): string[] {
  const pkg = addonPackage(dir);
  if (!pkg) return [];
  return Object.keys(pkg.dependencies).filter(name => !existsSync(join(dir, 'node_modules', name, 'package.json')));
}

/**
 * Apply package.json browser replacements to modules and files, including
 * dependencies. Prefer installed npm polyfills to Bun built-ins; its assert
 * stand-in lacks a callable default export.
 */
export function browserFieldPlugin(dir: string): import('bun').BunPlugin {
  const entries = Object.entries(addonPackage(dir)?.browser ?? {});
  const isModuleName = (key: string) => /^(@[^/]+\/)?[^/.][^/]*$/.test(key);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const resolveTarget = (target: string) => target.startsWith('.') ? resolve(dir, target) : Bun.resolveSync(target, dir);
  return {
    name: 'mnemonexus-browser-field',
    setup(build) {
      // A CommonJS module with nothing in it: named imports from it are undefined.
      const empty = { contents: 'module.exports = {};', loader: 'js' as const };
      build.onLoad({ filter: /.*/, namespace: 'mnemonexus-empty' }, () => empty);

      // Module names: every import of that name, anywhere.
      const names = new Map(entries.filter(([key]) => isModuleName(key)));
      if (names.size) {
        build.onResolve({ filter: new RegExp(`^(${[...names.keys()].map(escape).join('|')})$`) }, args => {
          const target = names.get(args.path);
          if (target === false) return { path: args.path, namespace: 'mnemonexus-empty' };
          return typeof target === 'string' ? { path: resolveTarget(target) } : undefined;
        });
      }

      // Node's own modules: the add-on's installed npm package of that name, if any.
      const builtins = builtinModules.filter(name => /^[a-z_]+$/.test(name) && !names.has(name));
      const inside = (path: string) => path === dir || path.startsWith(dir + sep);
      build.onResolve({ filter: new RegExp(`^(${builtins.join('|')})$`) }, args => {
        let folder = args.importer && inside(args.importer) ? dirname(args.importer) : dir;
        for (;;) {
          const pkg = join(folder, 'node_modules', args.path);
          if (existsSync(join(pkg, 'package.json'))) {
            const json = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
            const main = typeof json.browser === 'string' ? json.browser : json.main ?? 'index.js';
            try { return { path: Bun.resolveSync(`./${main.replace(/^\.\//, '')}`, pkg) }; } catch { return undefined; }
          }
          if (folder === dir || !inside(dirname(folder))) return undefined;
          folder = dirname(folder);
        }
      });

      // Replace matched files with a re-export or empty module.
      // Normalize slashes and Windows path casing.
      const windows = process.platform === 'win32';
      const normal = (path: string) => { const slashed = path.split('\\').join('/'); return windows ? slashed.toLowerCase() : slashed; };
      const files = new Map<string, string | false>();
      for (const [key, target] of entries) {
        if (isModuleName(key)) continue;
        let file = key.startsWith('.') ? resolve(dir, key) : join(dir, 'node_modules', key);
        if (!key.startsWith('.') && !existsSync(file)) { try { file = Bun.resolveSync(key, dir); } catch { /* reported below */ } }
        if (!existsSync(file)) throw new Error(`package.json "browser": "${key}" is not a file. Name a module, or a file such as "./src/x.ts" or "some-lib/dist/x.js".`);
        files.set(normal(file), target);
        files.set(normal(realpathSync(file)), target);
      }
      if (files.size) {
        const paths = [...files.keys()].map(path => path.split('/').map(escape).join('[\\\\/]'));
        build.onLoad({ filter: new RegExp(`^(${paths.join('|')})$`, windows ? 'i' : '') }, args => {
          const target = files.get(normal(args.path));
          if (target === false || target === undefined) return empty;
          const path = JSON.stringify(resolveTarget(target));
          const hasDefault = /\bexport\s+default\b|\bas\s+default\b|module\.exports|\bexports\./.test(readFileSync(resolveTarget(target), 'utf8'));
          return { contents: `export * from ${path};${hasDefault ? ` export { default } from ${path};` : ''}`, loader: 'js' };
        });
      }
    },
  };
}

/** `map` is the source map, when asked for: `check` uses it to say which file a finding comes from. */
export interface BuildOutput { ok: boolean; code?: string; bytes?: number; map?: string; errors: string[] }

/**
 * Bundle the entry and everything it imports into one plain browser script
 * (an IIFE). The sandbox loads it as a classic script with no module loader
 * and no `require`, so nothing can stay external.
 */
export async function buildAddon(dir: string, { sourcemap = false }: { sourcemap?: boolean } = {}): Promise<BuildOutput> {
  const entry = findEntry(dir);
  if (!entry) {
    return { ok: false, errors: [`No entry file found. Create one of: ${ENTRY_CANDIDATES.join(', ')}.`] };
  }
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [entry],
      format: 'iife',
      target: 'browser',
      // Minify to fit the 8 MiB limit, but retain names used by library reflection.
      minify: process.env.MNX_NO_MINIFY ? false : { whitespace: true, syntax: true, identifiers: true, keepNames: true },
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [browserFieldPlugin(dir), kitAliasPlugin, cssPlugin(dir), inlineFilesPlugin],
      sourcemap: sourcemap ? 'external' : 'none',
      throw: false,
    });
  } catch (error) {
    return { ok: false, errors: [String((error as Error).message ?? error)] };
  }
  if (!result.success) {
    return { ok: false, errors: result.logs.map(log => String(log.message ?? log)) };
  }
  const output = result.outputs.find(file => file.kind === 'entry-point') ?? result.outputs[0];
  // With a source map, Bun ends the code with a debugId comment: drop it, so
  // the code is the same either way.
  const code = (await output.text()).replace(/\n*\/\/# debugId=\w+\s*$/, '\n');
  const map = sourcemap ? await result.outputs.find(file => file.kind === 'sourcemap')?.text() : undefined;
  return { ok: true, code, bytes: new TextEncoder().encode(code).length, map, errors: [] };
}

/** Bytes of each declared asset that exists on disk; missing ones are listed. */
export function readDeclaredAssets(dir: string, manifest: any): { assets: Map<string, Uint8Array>; missing: string[] } {
  const assets = new Map<string, Uint8Array>();
  const missing: string[] = [];
  for (const row of Array.isArray(manifest?.assets) ? manifest.assets : []) {
    const path = join(dir, String(row?.logicalPath ?? ''));
    if (typeof row?.logicalPath === 'string' && existsSync(path) && statSync(path).isFile()) {
      assets.set(row.logicalPath, new Uint8Array(readFileSync(path)));
    } else missing.push(String(row?.logicalPath));
  }
  return { assets, missing };
}

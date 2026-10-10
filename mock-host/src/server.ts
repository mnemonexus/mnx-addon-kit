/**
 * The mock host's local web server.
 *
 * It serves the control page, the add-on's freshly built code, its declared
 * assets, durable study storage, and (when configured) a proxy to a real
 * OpenAI-compatible model. With `watch`, it rebuilds on save and tells the page
 * to relaunch.
 */
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCanonicalPath } from '@mnemonexus/addon-sdk/validate';
import { buildAddon, loadAddon, readManifest } from './addon';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../..');
const REFERENCE = join(REPO_ROOT, 'reference');

/**
 * Theme v1 fonts: the host sends Lexend Deca (400, 500, 600) and IBM Plex Mono
 * (400) as data: @font-face rules at the top of `styles`, because the frame
 * can't load font files. Both are under the SIL Open Font License; the mock
 * takes them from the @fontsource packages (Latin subset).
 */
export function fontFaceRules(): string {
  const require = createRequire(import.meta.url);
  const file = (pkg: string, name: string) => readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), 'files', name)).toString('base64');
  const face = (family: string, weight: number, data: string) =>
    `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
  return [
    ...[400, 500, 600].map(weight => face('Lexend Deca', weight, file('@fontsource/lexend-deca', `lexend-deca-latin-${weight}-normal.woff2`))),
    face('IBM Plex Mono', 400, file('@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2')),
  ].join('\n');
}

export interface AiLiveConfig { baseUrl: string; model: string; apiKey?: string }

/**
 * A real model for `ai` mode "live": any OpenAI-compatible endpoint, set by
 * environment variables. Off unless MNX_AI_BASE_URL is set.
 */
export function aiLiveConfig(env = process.env): AiLiveConfig | undefined {
  if (!env.MNX_AI_BASE_URL) return undefined;
  return { baseUrl: env.MNX_AI_BASE_URL.replace(/\/+$/, ''), model: env.MNX_AI_MODEL ?? 'local-model', apiKey: env.MNX_AI_API_KEY };
}

export interface ServerOptions {
  addonDir: string;
  port?: number;
  /** Rebuild on save and push a reload to the page. */
  watch?: boolean;
  /** 'file' keeps study storage in <addon>/.mnx-dev/; 'memory' forgets it when the server stops. */
  durableStorage?: 'file' | 'memory';
  quiet?: boolean;
}

export interface MockHostServer { url: string; port: number; stop(): void }

async function buildUi(): Promise<string> {
  const result = await Bun.build({ entrypoints: [join(here, 'ui/main.ts')], target: 'browser', format: 'iife', minify: false });
  if (!result.success) throw new Error('The mock host page failed to build:\n' + result.logs.map(String).join('\n'));
  return result.outputs[0].text();
}

export async function startMockHost(options: ServerOptions): Promise<MockHostServer> {
  const addonDir = resolve(options.addonDir);
  const log = (...args: unknown[]) => { if (!options.quiet) console.log(...args); };
  const uiScript = await buildUi();
  const page = readFileSync(join(here, 'ui/index.html'), 'utf8');
  const styles = readFileSync(join(here, 'ui/host.css'), 'utf8');
  const fonts = fontFaceRules();
  const reference = {
    frame: readFileSync(join(REFERENCE, 'frame.html'), 'utf8'),
    frameNetwork: readFileSync(join(REFERENCE, 'frame-network.html'), 'utf8'),
    primitives: readFileSync(join(REFERENCE, 'primitives.css'), 'utf8'),
    fonts,
  };

  // Durable study storage: { [scope]: { [key]: value } }.
  const storageFile = join(addonDir, '.mnx-dev', 'study-storage.json');
  let durable: Record<string, Record<string, string>> = {};
  if (options.durableStorage !== 'memory' && existsSync(storageFile)) {
    try { durable = JSON.parse(readFileSync(storageFile, 'utf8')); } catch { durable = {}; }
  }
  const saveDurable = () => {
    if (options.durableStorage === 'memory') return;
    mkdirSync(dirname(storageFile), { recursive: true });
    writeFileSync(storageFile, JSON.stringify(durable, null, 2));
  };

  let build = await buildAddon(addonDir);
  let buildId = 1;
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const broadcast = (event: object) => {
    const chunk = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
    for (const controller of listeners) {
      try { controller.enqueue(chunk); } catch { listeners.delete(controller); }
    }
  };

  let watcher: FSWatcher | undefined;
  if (options.watch) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    watcher = watch(addonDir, { recursive: true }, (_event, file) => {
      const name = String(file ?? '');
      if (/(^|[\\/])(dist|\.mnx-dev|node_modules|screenshots)([\\/]|$)/.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        build = await buildAddon(addonDir);
        buildId++;
        log(build.ok ? `Rebuilt after a change to ${name}.` : `Build failed after a change to ${name}:\n${build.errors.join('\n')}`);
        broadcast({ type: 'reload', buildId, ok: build.ok });
      }, 150);
    });
  }

  // The UI gallery (ui/gallery) can be opened from any add-on's mock host, at
  // /gallery, to see every library component in the current theme.
  const galleryDir = join(REPO_ROOT, 'ui', 'gallery');
  let galleryBuild: Awaited<ReturnType<typeof buildAddon>> | undefined;
  const isGallery = (url: URL) => url.searchParams.get('addon') === 'gallery';

  const ai = aiLiveConfig();
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: '127.0.0.1',
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      switch (url.pathname) {
        case '/':
        case '/gallery':
          return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        case '/host.js':
          return new Response(uiScript, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
        case '/host.css':
          return new Response(`${fonts}\n${styles}`, { headers: { 'content-type': 'text/css; charset=utf-8' } });
        case '/api/addon': {
          const dir = isGallery(url) ? galleryDir : addonDir;
          const current = isGallery(url) ? (galleryBuild ??= await buildAddon(galleryDir)) : build;
          const addon = loadAddon(dir);
          return json({
            dir, buildId, manifest: addon.manifest ?? null, manifestError: addon.manifestError ?? null,
            build: { ok: current.ok, errors: current.errors, bytes: current.bytes ?? 0 }, code: current.code ?? '',
            scenarios: addon.scenarios, reference, aiLive: ai ? { model: ai.model, baseUrl: ai.baseUrl } : null,
          });
        }
        case '/api/asset': {
          // Only paths the manifest declared, read fresh from disk.
          const path = url.searchParams.get('path') ?? '';
          const { manifest } = readManifest(addonDir);
          const declared = Array.isArray(manifest?.assets) && manifest.assets.some((row: any) => row?.logicalPath === path);
          const file = join(addonDir, path);
          if (!declared || !isCanonicalPath(path, 'assets/') || !existsSync(file)) return new Response('Not found', { status: 404 });
          return new Response(readFileSync(file));
        }
        case '/api/source-media': {
          // A learning scenario's source images: files inside the add-on folder only.
          const path = url.searchParams.get('path') ?? '';
          const file = resolve(addonDir, path);
          if (!path || !file.startsWith(addonDir + (process.platform === 'win32' ? '\\' : '/')) || !existsSync(file) || !statSync(file).isFile()) {
            return new Response('Not found', { status: 404 });
          }
          if (request.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(statSync(file).size) } });
          return new Response(readFileSync(file));
        }
        case '/api/storage': {
          const scope = url.searchParams.get('scope') ?? '';
          if (request.method === 'GET') return json(durable[scope] ?? {});
          if (request.method === 'PUT') {
            const body = await request.json();
            durable[scope] = body && typeof body === 'object' ? body : {};
            if (!Object.keys(durable[scope]).length) delete durable[scope];
            saveDurable();
            return json({ ok: true });
          }
          if (request.method === 'DELETE') { durable = {}; saveDurable(); return json({ ok: true }); }
          return new Response('Method not allowed', { status: 405 });
        }
        case '/api/ai': {
          if (!ai) return json({ error: 'Live mode is off. Set MNX_AI_BASE_URL (and MNX_AI_MODEL, MNX_AI_API_KEY if needed).' }, 400);
          const { prompt } = await request.json() as { prompt: string };
          try {
            // One prompt, not separate chat roles: the host joins system and prompt itself.
            const response = await fetch(`${ai.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}) },
              body: JSON.stringify({ model: ai.model, messages: [{ role: 'user', content: prompt }] }),
            });
            if (!response.ok) return json({ error: `the endpoint answered ${response.status}` }, 502);
            const data = await response.json() as any;
            const text = data?.choices?.[0]?.message?.content;
            if (typeof text !== 'string') return json({ error: 'the endpoint returned no text' }, 502);
            return json({ text });
          } catch (error) {
            return json({ error: `could not reach the endpoint: ${(error as Error).message}` }, 502);
          }
        }
        case '/api/events': {
          let mine: ReadableStreamDefaultController<Uint8Array>;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) { mine = controller; listeners.add(controller); controller.enqueue(new TextEncoder().encode(': connected\n\n')); },
            cancel() { listeners.delete(mine); },
          });
          return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
        }
        default:
          return new Response('Not found', { status: 404 });
      }
    },
  });

  const url = `http://127.0.0.1:${server.port}/`;
  return {
    url,
    port: server.port!,
    stop() {
      watcher?.close();
      for (const controller of listeners) { try { controller.close(); } catch { /* already closed */ } }
      server.stop(true);
    },
  };
}

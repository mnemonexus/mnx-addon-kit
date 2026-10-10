#!/usr/bin/env bun
/**
 * mnx: the add-on kit's command-line tool.
 *
 *   bun run new <id> [--label "My Add-on"]
 *   bun run dev <id> [--port 4173]
 *   bun run check <id> | --all [--screenshots]
 *   bun run pack <id>
 *   bun run sign <pack> [--key <path>]        (preview)
 *   bun run verify <pack> [--pub <path>]      (preview)
 *   bun run keygen [--out keys/dev]           (preview)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startMockHost } from '@mnemonexus/mock-host';
import { checkPackIntegrity, generateSigningKeyPair, signPack, verifyPack } from '@mnemonexus/addon-sdk/sign';
import { checkAddon, installCommand, type AddonReport } from './check';
import { missingDependencies } from '@mnemonexus/mock-host/addon';
import { newAddon } from './new';
import { packAddon } from './pack';
import { PROMPT_FILE, estimateTokens, renderPrompt } from './prompt';
import { REPO_ROOT, UserError, allAddonDirs, resolveAddon, show } from './paths';

const HELP = `mnx: build MnemoNexus add-ons

  bun run new <id> [--label "My Add-on"]   copy the starter to addons/<id>
       --learning                          start from Process Builder, a learning add-on
  bun run dev <id> [--port 4173]           open the mock host, rebuild on save
  bun run check <id> | --all               manifest, build, static scan, headless run
       --screenshots                       also save screenshots: light and dark, square and round, lines and shadows
       --no-browser                        build and scan only (never in CI)
  bun run pack <id>                        write addons/<id>/dist/<id>-<version>.mnxpack
  bun run sign <pack> [--key <path>]       PREVIEW: write <pack>.sig.json
  bun run verify <pack> [--pub <path>]     PREVIEW: check a pack and its signature
  bun run keygen [--out keys/dev]          PREVIEW: make a throwaway key pair
`;

function parse(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && !['all', 'screenshots', 'no-browser', 'learning'].includes(name)) { flags[name] = next; i++; }
      else flags[name] = true;
    } else positional.push(arg);
  }
  return { positional, flags };
}

const PREVIEW = 'PREVIEW: the app does not check signatures yet (HOST_CONTRACT.md, proposed P2).';

/** A private key must never sit somewhere git would commit it. */
function assertNotCommittable(path: string) {
  const inside = !relative(REPO_ROOT, path).startsWith('..') && !isAbsolute(relative(REPO_ROOT, path));
  if (!inside) return;
  const ignored = spawnSync('git', ['check-ignore', '-q', path], { cwd: REPO_ROOT }).status === 0;
  if (!ignored) throw new UserError(`${show(path)} is inside the repository and not ignored by git. Keep keys outside the repo, or under keys/ or as *.key.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parse(rest);
  switch (command) {
    case 'new': {
      const id = positional[0];
      if (!id) throw new UserError('Usage: bun run new <id> [--label "My Add-on"] [--learning]');
      const learning = !!flags.learning;
      const dir = newAddon(id, { label: typeof flags.label === 'string' ? flags.label : undefined, learning });
      console.log(`Created ${show(dir)} from ${learning ? 'addons/process-builder (a learning add-on)' : 'templates/experience'}.\n\nNext:\n  bun run dev ${id}\n  bun run check ${id}\n  bun run pack ${id}`);
      return;
    }
    case 'dev': {
      const id = positional[0];
      if (!id) throw new UserError('Usage: bun run dev <id> [--port 4173]');
      const dir = resolveAddon(id);
      const port = typeof flags.port === 'string' ? Number(flags.port) : 4173;
      const server = await startMockHost({ addonDir: dir, port, watch: true });
      console.log(`Mock host for ${show(dir)}:\n\n  ${server.url}\n\nEdit and save: the page rebuilds and relaunches. Ctrl+C to stop.`);
      await new Promise(() => undefined);
      return;
    }
    case 'check': {
      const dirs = flags.all ? allAddonDirs() : positional.length ? positional.map(resolveAddon) : [];
      if (!dirs.length) throw new UserError(flags.all ? 'No add-ons found under addons/, examples/ or templates/.' : 'Usage: bun run check <id> | --all');
      const noBrowser = !!flags['no-browser'];
      if (noBrowser && process.env.CI) throw new UserError('--no-browser is not allowed in CI: CI must run every add-on in a browser.');
      const options = { noBrowser, screenshots: !!flags.screenshots } as Parameters<typeof checkAddon>[1] & {};
      // --all skips a ported add-on whose own dependencies aren't installed,
      // except in CI, which must check everything. Named, it fails.
      const uninstalled = flags.all && !process.env.CI ? dirs.filter(dir => missingDependencies(dir).length) : [];
      const reports: AddonReport[] = [];
      for (const dir of dirs) {
        if (!uninstalled.includes(dir)) reports.push(await checkAddon(dir, options));
      }

      console.log('\nSummary');
      for (const report of reports) {
        const verdict = !report.ok ? '✗' : report.notRun ? '-' : '✓';
        const note = report.notRun ? `  built and scanned, NOT RUN${report.ok ? '' : ' (and failed)'}` : '';
        console.log(`  ${verdict} ${report.id.padEnd(24)} ${show(report.dir)}${note}`);
      }
      for (const dir of uninstalled) {
        console.log(`  - ${basename(dir).padEnd(24)} ${show(dir)}  SKIPPED: its own dependencies are not installed. Run: ${installCommand(dir)}`);
      }
      const failed = reports.filter(report => !report.ok).length;
      const notRun = reports.filter(report => report.notRun).length;
      const passed = reports.filter(report => report.ok && !report.notRun).length;
      console.log(`${passed} passed, ${failed} failed, ${notRun} not run${uninstalled.length ? `, ${uninstalled.length} skipped` : ''}`);
      if (notRun && !noBrowser) {
        console.log(`\nThe headless run did not happen: ${options.unavailable}\nA check that has not run the add-on is not a pass. Fix the browser, or pass --no-browser to accept build and scan only.`);
      } else if (notRun) {
        console.log('\n--no-browser: the add-ons were built and scanned, not run. This is not a full check.');
      }
      process.exitCode = failed || (notRun && !noBrowser) ? 1 : 0;
      return;
    }
    case 'pack': {
      const id = positional[0];
      if (!id) throw new UserError('Usage: bun run pack <id>');
      const result = await packAddon(resolveAddon(id));
      console.log(`Wrote ${show(result.path)} (${(result.bytes / 1024).toFixed(1)} KiB, ${result.files} file(s) + pack.json)\ncontentHash ${result.contentHash}\n\nInstall it in the app: Add-ons → Install from file.`);
      return;
    }
    case 'sign': {
      const pack = positional[0];
      const keyPath = typeof flags.key === 'string' ? flags.key : process.env.MNX_SIGNING_KEY;
      if (!pack) throw new UserError('Usage: bun run sign <pack> [--key <path>]   (or set MNX_SIGNING_KEY to the key path)');
      if (!keyPath) throw new UserError('No key. Pass --key <path> or set MNX_SIGNING_KEY to the path of a PEM private key.');
      const key = resolve(keyPath);
      if (!existsSync(key)) throw new UserError(`No key file at ${keyPath}.`);
      assertNotCommittable(key);
      const signature = await signPack(new Uint8Array(readFileSync(pack)), readFileSync(key, 'utf8'));
      const out = `${pack}.sig.json`;
      writeFileSync(out, JSON.stringify(signature, null, 2) + '\n');
      console.log(`${PREVIEW}\n\nWrote ${out} (key ${signature.keyId}).`);
      return;
    }
    case 'verify': {
      const pack = positional[0];
      if (!pack) throw new UserError('Usage: bun run verify <pack> [--pub <path>] [--sig <path>]');
      const bytes = new Uint8Array(readFileSync(pack));
      const pubPath = typeof flags.pub === 'string' ? flags.pub : process.env.MNX_SIGNING_PUBKEY;
      const sigPath = typeof flags.sig === 'string' ? flags.sig : `${pack}.sig.json`;
      console.log(PREVIEW + '\n');
      if (!pubPath || !existsSync(sigPath)) {
        const integrity = await checkPackIntegrity(bytes);
        console.log(integrity.ok ? '✓ Pack integrity: every file is declared and every hash matches.' : `✗ Pack integrity:\n  ${integrity.problems.join('\n  ')}`);
        console.log(!existsSync(sigPath) ? `No signature at ${sigPath}.` : 'No public key given (--pub or MNX_SIGNING_PUBKEY), so the signature was not checked.');
        process.exitCode = integrity.ok ? 0 : 1;
        return;
      }
      const result = await verifyPack(bytes, JSON.parse(readFileSync(sigPath, 'utf8')), readFileSync(pubPath, 'utf8'));
      console.log(result.ok ? `✓ ${pack}: valid signature, pack intact.` : `✗ ${pack}:\n  ${result.problems.join('\n  ')}`);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case 'keygen': {
      const base = resolve(typeof flags.out === 'string' ? flags.out : 'keys/dev');
      const privatePath = `${base}.key`;
      const publicPath = `${base}.pub.pem`;
      if (existsSync(privatePath)) throw new UserError(`${privatePath} already exists.`);
      assertNotCommittable(privatePath);
      const keys = await generateSigningKeyPair();
      const { mkdirSync } = await import('node:fs');
      mkdirSync(dirname(privatePath), { recursive: true });
      writeFileSync(privatePath, keys.privateKeyPem, { mode: 0o600 });
      writeFileSync(publicPath, keys.publicKeyPem);
      console.log(`${PREVIEW}\n\nWrote ${show(privatePath)} (private, keep it secret) and ${show(publicPath)}.\nKey id ${keys.keyId}. This is a throwaway key for trying the tools, not the MnemoNexus key.`);
      return;
    }
    case 'prompt': {
      const text = renderPrompt();
      writeFileSync(PROMPT_FILE, text);
      console.log(`Wrote PROMPT.md (about ${estimateTokens(text).toLocaleString('en')} tokens).`);
      return;
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return;
    default:
      throw new UserError(`Unknown command "${command}".\n\n${HELP}`);
  }
}

main().catch(error => {
  if (error instanceof UserError) console.error(`\n${error.message}`);
  else console.error(error);
  process.exitCode = 1;
});

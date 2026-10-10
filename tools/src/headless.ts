/** Run scenario drive scripts against the mock host. The browser runner uses
 * a separate Node process because Playwright can hang under Bun on Windows. */
import { join } from 'node:path';
import { startMockHost } from '@mnemonexus/mock-host';
import type { Scenario } from '@mnemonexus/mock-host/core';

export interface ScenarioOutcome {
  name: string;
  surface: string;
  ok: boolean;
  summary: string;
  problems: string[];
  screenshots: string[];
}

export type HeadlessResult = { ran: true; outcomes: ScenarioOutcome[] } | { ran: false; reason: string };

const RUNNER = join(import.meta.dir, 'headless-runner.mjs');

/**
 * Which program runs the browser. Node when it is on the PATH; otherwise Bun,
 * except on Windows, where that hangs. MNX_HEADLESS_RUNTIME=node|bun forces one.
 */
export function headlessRuntime(env = process.env, platform = process.platform, which = Bun.which):
  { command: string } | { reason: string } {
  const forced = env.MNX_HEADLESS_RUNTIME;
  if (forced === 'bun') return { command: process.execPath };
  const node = which('node');
  if (node) return { command: node };
  if (forced === 'node' || platform === 'win32') {
    return { reason: 'Node.js was not found. The headless run needs Node.js 18 or later (on Windows, Playwright hangs under Bun). Install it from nodejs.org.' };
  }
  return { command: process.execPath };
}

export async function runHeadless(addonDir: string, scenarios: Scenario[], options: { screenshots?: string } = {}): Promise<HeadlessResult> {
  const runtime = headlessRuntime();
  if ('reason' in runtime) return { ran: false, reason: runtime.reason };
  const server = await startMockHost({ addonDir, durableStorage: 'memory', quiet: true });
  try {
    const child = Bun.spawn([runtime.command, RUNNER], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: process.env });
    child.stdin.write(JSON.stringify({
      url: server.url,
      scenarios: scenarios.map(({ name, surface, kind, drive }) => ({ name, surface: kind === 'addon-job' ? 'preparation' : surface, kind, drive })),
      screenshots: options.screenshots,
    }));
    child.stdin.end();
    // A hung browser must not hang `check`: allow the launch plus time per scenario.
    const limit = 90_000 + scenarios.length * 90_000;
    const timer = setTimeout(() => child.kill(), limit);
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    const outcomes: ScenarioOutcome[] = [];
    let done = false;
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      let message: any;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'unavailable') return { ran: false, reason: message.reason };
      if (message.type === 'outcome') { const { type, ...outcome } = message; outcomes.push(outcome); }
      if (message.type === 'done') done = true;
    }
    if (!done) {
      const why = child.signalCode ? `it was stopped after ${Math.round(limit / 1000)} s` : `it exited with code ${child.exitCode}`;
      const detail = stderr.trim().split('\n').slice(-5).join('\n');
      return { ran: false, reason: `The headless runner did not finish: ${why}.${detail ? `\n${detail}` : ''}` };
    }
    return { ran: true, outcomes };
  } finally {
    server.stop();
  }
}

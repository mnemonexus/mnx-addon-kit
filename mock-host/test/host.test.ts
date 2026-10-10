import { describe, expect, it } from 'bun:test';
import { HostRun, type HostEvent } from '../src/core/host';

function setup() {
  const sent: any[] = [];
  const events: HostEvent[] = [];
  const frame = { postMessage: (message: unknown) => { sent.push(message); } };
  const run = new HostRun({
    frame, runId: 'run-1',
    init: { code: 'x', props: { kind: 'experience' }, styles: 'css', tokens: { '--a': '1' } },
    bridge: async payload => (payload as any)?.channel === 'storage' ? { ok: true, value: null } : { ok: false, error: 'That request was not understood.' },
    onEvent: event => events.push(event),
  });
  const from = (data: unknown, source: unknown = frame) => run.handle({ source, data });
  return { run, sent, events, from, frame };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('host lifecycle (section 3)', () => {
  it('answers boot with init, once', () => {
    const { sent, from, events } = setup();
    from({ kind: 'boot', protocolVersion: 1 });
    from({ kind: 'boot', protocolVersion: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'init', protocolVersion: 1, runId: 'run-1', code: 'x', styles: 'css', tokens: { '--a': '1' } });
    expect(events.some(e => e.type === 'dropped' && /repeat boot/.test(e.reason))).toBe(true);
  });
  it('ignores other sources, other protocol versions and other runs', () => {
    const { run, sent, from } = setup();
    from({ kind: 'boot', protocolVersion: 1 }, {});
    expect(sent).toHaveLength(0);
    from({ kind: 'boot', protocolVersion: 2 });
    expect(sent).toHaveLength(0);
    from({ kind: 'boot', protocolVersion: 1 });
    from({ kind: 'ready', protocolVersion: 1, runId: 'other' });
    expect(run.state).toBe('running');
    from({ kind: 'ready', protocolVersion: 1, runId: 'run-1' });
    expect(run.state).toBe('ready');
  });
  it('treats any error as a failed run', () => {
    const { run, from, events } = setup();
    from({ kind: 'boot', protocolVersion: 1 });
    from({ kind: 'error', protocolVersion: 1, runId: 'run-1', message: 'boom' });
    expect(run.state).toBe('failed');
    expect(events).toContainEqual({ type: 'error', message: 'boom' });
  });
  it('counts only the first complete of a mount', () => {
    const { from, events } = setup();
    from({ kind: 'boot', protocolVersion: 1 });
    from({ kind: 'complete', protocolVersion: 1, runId: 'run-1', result: { n: 1 } });
    from({ kind: 'complete', protocolVersion: 1, runId: 'run-1', result: { n: 2 } });
    expect(events.filter(e => e.type === 'complete')).toEqual([{ type: 'complete', result: { n: 1 } }]);
    expect(events.some(e => e.type === 'dropped' && /first complete/.test(e.reason))).toBe(true);
  });
  it('keeps error final when ready arrives after it', () => {
    const { run, from } = setup();
    from({ kind: 'boot', protocolVersion: 1 });
    from({ kind: 'error', protocolVersion: 1, runId: 'run-1', message: 'boom' });
    from({ kind: 'ready', protocolVersion: 1, runId: 'run-1' });
    expect(run.state).toBe('failed');
  });
  it('reports complete and exit', () => {
    const a = setup();
    a.from({ kind: 'boot', protocolVersion: 1 });
    a.from({ kind: 'complete', protocolVersion: 1, runId: 'run-1', result: { completed: true } });
    expect(a.run.state).toBe('completed');
    expect(a.events).toContainEqual({ type: 'complete', result: { completed: true } });
    const b = setup();
    b.from({ kind: 'boot', protocolVersion: 1 });
    b.from({ kind: 'exit', protocolVersion: 1, runId: 'run-1' });
    expect(b.run.state).toBe('exited');
  });
  it('answers bridge requests with the request id and run id', async () => {
    const { sent, from } = setup();
    from({ kind: 'boot', protocolVersion: 1 });
    from({ kind: 'bridge-request', protocolVersion: 1, runId: 'run-1', requestId: 'r0', payload: { channel: 'storage', op: 'get', key: 'k' } });
    from({ kind: 'bridge-request', protocolVersion: 1, runId: 'run-1', requestId: 'r1', payload: { channel: 'nope' } });
    await tick();
    expect(sent[1]).toEqual({ kind: 'bridge-response', protocolVersion: 1, runId: 'run-1', requestId: 'r0', ok: true, value: null });
    expect(sent[2]).toEqual({ kind: 'bridge-response', protocolVersion: 1, runId: 'run-1', requestId: 'r1', ok: false, error: 'That request was not understood.' });
  });
  it('posts dispose and then ignores the frame', () => {
    const { run, sent, from } = setup();
    from({ kind: 'boot', protocolVersion: 1 });
    run.dispose();
    expect(sent.at(-1)).toMatchObject({ kind: 'dispose', protocolVersion: 1 });
    from({ kind: 'complete', protocolVersion: 1, runId: 'run-1', result: {} });
    expect(run.state).toBe('disposed');
  });
});

describe('theme v1', () => {
  it('sends a live theme message with the run id, only once the run has started', () => {
    const { run, sent, from } = setup();
    run.theme({ version: 1 }, { '--a': '2' });
    expect(sent).toHaveLength(0);
    from({ kind: 'boot', protocolVersion: 1 });
    run.theme({ version: 1, scheme: 'dark' }, { '--a': '2' });
    expect(sent.at(-1)).toEqual({ kind: 'theme', protocolVersion: 1, runId: 'run-1', theme: { version: 1, scheme: 'dark' }, tokens: { '--a': '2' } });
  });
});

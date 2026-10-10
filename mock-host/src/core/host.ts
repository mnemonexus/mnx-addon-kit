/** Protocol-v1 run state and message dispatch (contract section 3).
 * Accept only the mounted frame, matching protocol and run ID. The DOM adapter
 * supplies the frame window and transport; bridge.ts validates request payloads. */
import type { BridgeOutcome } from './bridge';

export const PROTOCOL_VERSION = 1;

export type RunState = 'booting' | 'running' | 'ready' | 'completed' | 'exited' | 'failed' | 'disposed';

export type HostEvent =
  | { type: 'in'; message: Record<string, unknown> }
  | { type: 'out'; message: Record<string, unknown> }
  | { type: 'dropped'; reason: string; message?: unknown }
  | { type: 'state'; state: RunState }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'complete'; result: unknown }
  | { type: 'exit' }
  | { type: 'bridge'; payload: unknown; outcome: BridgeOutcome; ms: number };

export interface FrameWindow {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

export interface HostRunOptions {
  frame: FrameWindow;
  runId: string;
  /** `theme` is theme v1 (section 11); `tokens` the primitives.css set taken from it. */
  init: { code: string; props: unknown; styles: string; tokens: Record<string, string>; theme?: unknown };
  bridge(payload: unknown): Promise<BridgeOutcome>;
  onEvent(event: HostEvent): void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export class HostRun {
  readonly runId: string;
  state: RunState = 'booting';
  private readonly options: HostRunOptions;
  private initialised = false;
  private completed = false;

  constructor(options: HostRunOptions) {
    this.options = options;
    this.runId = options.runId;
  }

  private emit(event: HostEvent) { this.options.onEvent(event); }
  private setState(state: RunState) {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
  }

  private post(message: Record<string, unknown>, transfer?: Transferable[]) {
    if (this.state === 'disposed' && message.kind !== 'dispose') return;
    const full = { ...message, protocolVersion: PROTOCOL_VERSION };
    this.emit({ type: 'out', message: full });
    // The frame has an opaque origin, so '*' is the only target that reaches it.
    this.options.frame.postMessage(full, '*', transfer ?? []);
  }

  /** Feed every `message` event on the host window through here. */
  handle(event: { source: unknown; data: unknown }) {
    if (event.source !== this.options.frame) return; // not our frame: ignore silently
    const message = event.data;
    if (!isObject(message) || message.protocolVersion !== PROTOCOL_VERSION || typeof message.kind !== 'string') {
      this.emit({ type: 'dropped', reason: 'not a protocol 1 message', message });
      return;
    }
    if (this.state === 'disposed') {
      this.emit({ type: 'dropped', reason: 'the run was disposed', message });
      return;
    }
    if (message.kind === 'boot') {
      if (this.initialised) {
        this.emit({ type: 'dropped', reason: 'repeat boot for a run that has started', message });
        return;
      }
      this.emit({ type: 'in', message });
      this.initialised = true;
      this.setState('running');
      this.post({ kind: 'init', runId: this.runId, ...this.options.init });
      return;
    }
    if (message.runId !== this.runId) {
      this.emit({ type: 'dropped', reason: `runId ${JSON.stringify(message.runId)} is not this run`, message });
      return;
    }
    this.emit({ type: 'in', message });
    switch (message.kind) {
      case 'ready':
        // error is final: a ready after it does not bring the run back.
        if (this.state === 'running') this.setState('ready');
        this.emit({ type: 'ready' });
        return;
      case 'error': {
        // The host treats any error as a failed run.
        const text = typeof message.message === 'string' ? message.message : String(message.message);
        this.emit({ type: 'error', message: text });
        this.setState('failed');
        return;
      }
      case 'complete':
        // Only the first complete of a mount counts.
        if (this.completed) {
          this.emit({ type: 'dropped', reason: 'only the first complete of a mount counts', message });
          return;
        }
        this.completed = true;
        this.emit({ type: 'complete', result: message.result });
        if (this.state !== 'failed') this.setState('completed');
        return;
      case 'exit':
        this.emit({ type: 'exit' });
        if (this.state !== 'failed') this.setState('exited');
        return;
      case 'bridge-request':
        void this.serve(message);
        return;
      case 'select-concept':
        return; // index views only; logged above
      default:
        this.emit({ type: 'dropped', reason: `unknown kind "${message.kind}"`, message });
    }
  }

  private async serve(message: Record<string, unknown>) {
    const requestId = message.requestId;
    const started = Date.now();
    const outcome = await this.options.bridge(message.payload);
    this.emit({ type: 'bridge', payload: message.payload, outcome, ms: Date.now() - started });
    if (this.state === 'disposed') return; // the frame already rejected it
    if (outcome.ok) {
      this.post({ kind: 'bridge-response', runId: this.runId, requestId, ok: true, value: outcome.value }, outcome.transfer);
    } else {
      this.post({ kind: 'bridge-response', runId: this.runId, requestId, ok: false, error: outcome.error });
    }
  }

  /** Mid-run props swap: the host sends it whenever the props object changes. */
  update(props: unknown) {
    this.post({ kind: 'update', runId: this.runId, props });
  }

  /** Theme v1: the look changed while the add-on is open. Nothing is remounted. */
  theme(theme: unknown, tokens: Record<string, string>) {
    if (!this.initialised) return; // the next init carries it
    this.post({ kind: 'theme', runId: this.runId, theme, tokens });
  }

  dispose() {
    if (this.state === 'disposed') return;
    this.post({ kind: 'dispose', runId: this.runId });
    this.setState('disposed');
  }
}

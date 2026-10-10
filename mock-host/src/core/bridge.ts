/** Validate bridge requests in host order: shape, permission, contribution,
 * call ceiling, action. MOCK_WORDING identifies scenario-specific refusals. */
import { isCanonicalPath } from '@mnemonexus/addon-sdk/validate';

export const CONTRACT_MESSAGES = {
  notUnderstood: 'That request was not understood.',
  undeclaredAsset: (extensionId: string, path: string) => `"${extensionId}" did not declare "${path}".`,
  badPath: (path: string) => `"${path}" is not a valid pack path.`,
  noResidentFiles: 'This add-on has no resident files.',
  notResident: (path: string) => `"${path}" is not resident. The add-on may need reinstalling.`,
  noGeneratePermission: 'This add-on did not request permission to generate.',
  modelCallsOff: 'Model calls are turned off for this add-on in its settings.',
  aiCeiling: 'This add-on has used its model-call allowance for this session.',
  modelFailed: 'The model call failed.',
  invalidJson: 'The model did not return valid JSON.',
  noStoragePermission: 'This add-on did not request permission to store anything.',
  storageValueLimit: 'That value is too large to store.',
  storageKeyLimit: 'This add-on has used all of its storage keys.',
  noNetworkPermission: 'This add-on did not request network access.',
  noKnowledgePermission: 'This add-on did not request knowledge access.',
  notThisActivity: 'This source image is not part of this activity.',
  notContributed: 'This add-on did not contribute that data source.',
  externalCeiling: 'This add-on has used its data-call allowance for this session.',
  pickMissing: (pick: string) => `The response had no "${pick}".`,
} as const;

/** Refusals that are the mock's own wording: a scenario left something out. */
export const MOCK_WORDING = {
  noCannedData: (apiId: string, opId: string) => `No canned data for "${apiId}" / "${opId}" in this scenario. Add it under "externalApi".`,
} as const;

/** True when a refusal message is the mock's own wording rather than the app's. */
export function isMockWording(message: string): boolean {
  return /^No canned data for ".*" in this scenario\./.test(message);
}

export const LIMITS = {
  aiCalls: 400,
  externalCalls: 120,
  storageKeys: 512,
  storageValueChars: 524_288,
  paramsEntries: 16,
  paramKeyChars: 64,
  paramValueChars: 2000,
  apiIdChars: 128,
} as const;

export type BridgePayload =
  | { channel: 'asset'; path: string }
  | { channel: 'source-asset'; id: string }
  | { channel: 'ai'; prompt: string; system?: string; json?: boolean }
  | { channel: 'storage'; op: 'get' | 'set' | 'delete' | 'keys'; key?: string; value?: string }
  | { channel: 'external-api'; apiId: string; opId: string; params?: Record<string, string | number> };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Payload shapes the host accepts. Anything else: "That request was not understood." */
export function parseBridgePayload(payload: unknown): BridgePayload | null {
  if (!isObject(payload)) return null;
  switch (payload.channel) {
    case 'asset':
      return nonEmpty(payload.path) ? { channel: 'asset', path: payload.path } : null;
    case 'source-asset':
      return typeof payload.id === 'string' && payload.id.length >= 1 && payload.id.length <= 128 ? { channel: 'source-asset', id: payload.id } : null;
    case 'ai': {
      if (!nonEmpty(payload.prompt)) return null;
      if (payload.system !== undefined && typeof payload.system !== 'string') return null;
      if (payload.json !== undefined && typeof payload.json !== 'boolean') return null;
      return { channel: 'ai', prompt: payload.prompt, system: payload.system as string | undefined, json: payload.json as boolean | undefined };
    }
    case 'storage': {
      const op = payload.op;
      if (op !== 'get' && op !== 'set' && op !== 'delete' && op !== 'keys') return null;
      if (op !== 'keys' && !nonEmpty(payload.key)) return null;
      if (op === 'set' && typeof payload.value !== 'string') return null;
      return { channel: 'storage', op, key: payload.key as string | undefined, value: payload.value as string | undefined };
    }
    case 'external-api': {
      const { apiId, opId, params } = payload;
      const id = (value: unknown) => typeof value === 'string' && value.length >= 1 && value.length <= LIMITS.apiIdChars;
      if (!id(apiId) || !id(opId)) return null;
      if (params !== undefined) {
        if (!isObject(params)) return null;
        const entries = Object.entries(params);
        if (entries.length > LIMITS.paramsEntries) return null;
        for (const [key, value] of entries) {
          if (key.length < 1 || key.length > LIMITS.paramKeyChars) return null;
          if (typeof value === 'number') continue;
          if (typeof value !== 'string' || value.length > LIMITS.paramValueChars) return null;
        }
      }
      return { channel: 'external-api', apiId: apiId as string, opId: opId as string, params: params as Record<string, string | number> | undefined };
    }
    default:
      return null;
  }
}

/** Key/value storage for one scope. The mock has an in-memory and a durable kind. */
export interface StorageStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function memoryStore(map = new Map<string, string>()): StorageStore & { map: Map<string, string> } {
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key)! : null; },
    async set(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    async keys() { return [...map.keys()]; },
  };
}

/** Per-add-on counters that last for the life of the page, like the app's. */
export interface Ceilings { ai: number; externalApi: number }

/**
 * A refusal with a note for the log. The add-on sees only `message`, exactly
 * as the app would send it; the note says why the mock refused.
 */
export class Refusal extends Error {
  constructor(message: string, readonly note?: string) { super(message); }
}

export interface BridgeDeps {
  extensionId: string;
  permissions: readonly string[];
  declaredAssets: readonly string[];
  /** Declared data source ids (`dataSources[].id`). */
  dataSourceIds: readonly string[];
  /** Assets to treat as evicted, or 'all' for a pack with no resident files. */
  missingAssets?: readonly string[] | 'all';
  readAsset(path: string): Promise<ArrayBuffer>;
  storage: StorageStore;
  /** Settings v1 "Model calls": false when the user turned them off for this add-on. Read at call time. */
  modelCallsOn?(): boolean;
  /** The current source's readable images (at most eight, each at most 8 MiB), by opaque id. */
  sourceMedia?: readonly { id: string; read(): Promise<ArrayBuffer> }[];
  /** Returns the model's raw text, or throws (Refusal for a message + note). */
  generateText(fullPrompt: string): Promise<string>;
  /** Returns canned data, or throws (Refusal for a message + note). */
  callExternalApi(apiId: string, opId: string, params?: Record<string, string | number>): Promise<unknown>;
  ceilings: Ceilings;
}

export type BridgeOutcome =
  | { ok: true; value: unknown; transfer?: Transferable[] }
  | { ok: false; error: string; note?: string };

/** The `system` text goes in front of the prompt, separated by a blank line. */
export function joinPrompt(prompt: string, system?: string): string {
  return system ? `${system}\n\n${prompt}` : prompt;
}

/**
 * With json:true: only when the trimmed reply starts with ```, strip that
 * opening fence, an optional `json` (any case) and the whitespace after it,
 * plus a closing ```. Then JSON.parse.
 */
export function parseModelJson(text: string): unknown {
  let body = text.trim();
  if (body.startsWith('```')) {
    body = body.slice(3).replace(/^json/i, '').replace(/^\s+/, '');
    if (body.endsWith('```')) body = body.slice(0, -3);
  }
  return JSON.parse(body);
}

/**
 * A data source op's `pick`: a dot path into the parsed JSON response. Each
 * segment is an object key, or a whole-number index when the current value is
 * an array. Without a pick, the whole response. A missing segment, or a path
 * that runs into null or a plain value, fails with the app's message.
 */
export function applyPick(response: unknown, pick?: string): unknown {
  if (pick === undefined) return response;
  let current: unknown = response;
  for (const segment of pick.split('.')) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment) || Number(segment) >= current.length) throw new Refusal(CONTRACT_MESSAGES.pickMissing(pick));
      current = current[Number(segment)];
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, segment)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      throw new Refusal(CONTRACT_MESSAGES.pickMissing(pick));
    }
  }
  return current;
}

const refuse = (error: string, note?: string): BridgeOutcome => note ? { ok: false, error, note } : { ok: false, error };

export async function handleBridgeRequest(raw: unknown, deps: BridgeDeps): Promise<BridgeOutcome> {
  const payload = parseBridgePayload(raw);
  if (!payload) return refuse(CONTRACT_MESSAGES.notUnderstood);
  const can = (permission: string) => deps.permissions.includes(permission);
  try {
    switch (payload.channel) {
      case 'asset': {
        if (!isCanonicalPath(payload.path, '')) return refuse(CONTRACT_MESSAGES.badPath(payload.path));
        if (!deps.declaredAssets.includes(payload.path)) return refuse(CONTRACT_MESSAGES.undeclaredAsset(deps.extensionId, payload.path));
        if (deps.missingAssets === 'all') return refuse(CONTRACT_MESSAGES.noResidentFiles, 'The scenario sets "missingAssets": "all".');
        if (deps.missingAssets?.includes(payload.path)) return refuse(CONTRACT_MESSAGES.notResident(payload.path), 'The scenario lists this asset in "missingAssets".');
        const buffer = await deps.readAsset(payload.path);
        return { ok: true, value: buffer, transfer: [buffer] };
      }
      case 'source-asset': {
        if (!can('knowledge:read')) return refuse(CONTRACT_MESSAGES.noKnowledgePermission);
        // Only ids advertised for this frame: a preparation job's source, or the
        // activity launched from one of its offers. Everywhere else, none.
        const media = deps.sourceMedia?.find(row => row.id === payload.id);
        if (!media) return refuse(CONTRACT_MESSAGES.notThisActivity);
        // The host copies the bytes before transferring them, keeping its own copy.
        const buffer = (await media.read()).slice(0);
        return { ok: true, value: buffer, transfer: [buffer] };
      }
      case 'ai': {
        if (!can('ai:generate')) return refuse(CONTRACT_MESSAGES.noGeneratePermission);
        // Settings v1: after the permission, before the ceiling, so it doesn't count.
        if (deps.modelCallsOn && !deps.modelCallsOn()) return refuse(CONTRACT_MESSAGES.modelCallsOff, 'Model calls are Off in the Settings panel.');
        if (deps.ceilings.ai >= LIMITS.aiCalls) return refuse(CONTRACT_MESSAGES.aiCeiling);
        // Counted before it runs, so a failed call still counts.
        deps.ceilings.ai++;
        const text = await deps.generateText(joinPrompt(payload.prompt, payload.system));
        if (!payload.json) return { ok: true, value: text };
        try { return { ok: true, value: parseModelJson(text) }; }
        catch { return refuse(CONTRACT_MESSAGES.invalidJson); }
      }
      case 'storage': {
        if (!can('storage:local')) return refuse(CONTRACT_MESSAGES.noStoragePermission);
        const store = deps.storage;
        if (payload.op === 'keys') return { ok: true, value: await store.keys() };
        if (payload.op === 'get') return { ok: true, value: await store.get(payload.key!) };
        if (payload.op === 'delete') { await store.delete(payload.key!); return { ok: true, value: true }; }
        if (payload.value!.length > LIMITS.storageValueChars) return refuse(CONTRACT_MESSAGES.storageValueLimit);
        if ((await store.get(payload.key!)) === null && (await store.keys()).length >= LIMITS.storageKeys) {
          return refuse(CONTRACT_MESSAGES.storageKeyLimit);
        }
        await store.set(payload.key!, payload.value!);
        return { ok: true, value: true };
      }
      case 'external-api': {
        if (!can('network')) return refuse(CONTRACT_MESSAGES.noNetworkPermission);
        if (!deps.dataSourceIds.includes(payload.apiId)) return refuse(CONTRACT_MESSAGES.notContributed);
        if (deps.ceilings.externalApi >= LIMITS.externalCalls) return refuse(CONTRACT_MESSAGES.externalCeiling);
        deps.ceilings.externalApi++;
        return { ok: true, value: await deps.callExternalApi(payload.apiId, payload.opId, payload.params) };
      }
    }
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.message, error.note);
    return refuse(error instanceof Error ? error.message : String(error));
  }
}

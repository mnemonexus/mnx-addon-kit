import { describe, expect, it } from 'bun:test';
import {
  CONTRACT_MESSAGES, LIMITS, Refusal, applyPick, handleBridgeRequest, memoryStore, parseBridgePayload, parseModelJson, type BridgeDeps,
} from '../src/core/bridge';

function deps(patch: Partial<BridgeDeps> = {}): BridgeDeps {
  return {
    extensionId: 'demo',
    permissions: ['storage:local', 'ai:generate', 'network'],
    declaredAssets: ['assets/a.bin'],
    dataSourceIds: ['a'],
    readAsset: async () => new Uint8Array([1, 2, 3]).buffer,
    storage: memoryStore(),
    generateText: async prompt => `echo:${prompt}`,
    callExternalApi: async (apiId, opId) => ({ apiId, opId }),
    ceilings: { ai: 0, externalApi: 0 },
    ...patch,
  };
}

describe('payload validation (section 5)', () => {
  const refused = [
    null, 'asset', {}, { channel: 'camera' },
    { channel: 'asset' }, { channel: 'asset', path: '' },
    { channel: 'ai', prompt: '' }, { channel: 'ai', prompt: 'x', system: 3 }, { channel: 'ai', prompt: 'x', json: 'yes' },
    { channel: 'storage', op: 'list' }, { channel: 'storage', op: 'get' }, { channel: 'storage', op: 'set', key: 'k' },
    { channel: 'storage', op: 'set', key: 'k', value: 3 },
    { channel: 'external-api', apiId: '', opId: 'x' }, { channel: 'external-api', apiId: 'a'.repeat(129), opId: 'x' },
    { channel: 'external-api', apiId: 'a', opId: 'b', params: [] },
    { channel: 'external-api', apiId: 'a', opId: 'b', params: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 1])) },
    { channel: 'external-api', apiId: 'a', opId: 'b', params: { ['k'.repeat(65)]: 1 } },
    { channel: 'external-api', apiId: 'a', opId: 'b', params: { k: 'v'.repeat(2001) } },
    { channel: 'external-api', apiId: 'a', opId: 'b', params: { k: true } },
  ];
  for (const payload of refused) {
    it(`refuses ${JSON.stringify(payload)?.slice(0, 80)}`, async () => {
      expect(parseBridgePayload(payload)).toBeNull();
      expect(await handleBridgeRequest(payload, deps())).toEqual({ ok: false, error: CONTRACT_MESSAGES.notUnderstood });
    });
  }
  it('accepts the documented shapes, including undefined optionals from the frame', () => {
    expect(parseBridgePayload({ channel: 'ai', prompt: 'x', system: undefined, json: false })).not.toBeNull();
    expect(parseBridgePayload({ channel: 'storage', op: 'keys' })).not.toBeNull();
    expect(parseBridgePayload({ channel: 'external-api', apiId: 'a', opId: 'b', params: undefined })).not.toBeNull();
    expect(parseBridgePayload({ channel: 'external-api', apiId: 'a', opId: 'b', params: { q: 'x', n: 2 } })).not.toBeNull();
  });
});

describe('asset', () => {
  it('serves declared assets and transfers the buffer', async () => {
    const outcome = await handleBridgeRequest({ channel: 'asset', path: 'assets/a.bin' }, deps());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.transfer?.[0]).toBe(outcome.value as ArrayBuffer);
  });
  it('refuses bad and undeclared paths with the app\'s wording', async () => {
    expect(await handleBridgeRequest({ channel: 'asset', path: 'assets/../x.bin' }, deps()))
      .toEqual({ ok: false, error: '"assets/../x.bin" is not a valid pack path.' });
    expect(await handleBridgeRequest({ channel: 'asset', path: 'assets/other.bin' }, deps()))
      .toEqual({ ok: false, error: '"demo" did not declare "assets/other.bin".' });
  });
  it('refuses every asset of a pack with no resident files', async () => {
    expect((await handleBridgeRequest({ channel: 'asset', path: 'assets/a.bin' }, deps({ missingAssets: 'all' }))).error)
      .toBe('This add-on has no resident files.');
  });
  it('uses the contract wording for an evicted asset', async () => {
    expect((await handleBridgeRequest({ channel: 'asset', path: 'assets/a.bin' }, deps({ missingAssets: ['assets/a.bin'] }))).error)
      .toBe('"assets/a.bin" is not resident. The add-on may need reinstalling.');
  });
});

describe('ai', () => {
  it('needs ai:generate, with the contract wording', async () => {
    expect(await handleBridgeRequest({ channel: 'ai', prompt: 'x' }, deps({ permissions: [] })))
      .toEqual({ ok: false, error: 'This add-on did not request permission to generate.' });
  });
  it('puts system in front of the prompt with a blank line', async () => {
    expect(await handleBridgeRequest({ channel: 'ai', prompt: 'P', system: 'S' }, deps())).toEqual({ ok: true, value: 'echo:S\n\nP' });
  });
  it('parses JSON, stripping a fence, and refuses bad JSON with the contract wording', async () => {
    const reply = (text: string) => deps({ generateText: async () => text });
    expect(await handleBridgeRequest({ channel: 'ai', prompt: 'x', json: true }, reply('```json\n{"a":1}\n```'))).toEqual({ ok: true, value: { a: 1 } });
    expect(await handleBridgeRequest({ channel: 'ai', prompt: 'x', json: true }, reply('[1,2]'))).toEqual({ ok: true, value: [1, 2] });
    expect(await handleBridgeRequest({ channel: 'ai', prompt: 'x', json: true }, reply('sure! {"a":1}')))
      .toEqual({ ok: false, error: 'The model did not return valid JSON.' });
    expect(parseModelJson('```\n{"b":2}\n```')).toEqual({ b: 2 });
    expect(parseModelJson('  ```JSON {"c":3}```  ')).toEqual({ c: 3 });
    // Only when the trimmed reply starts with a fence.
    expect(() => parseModelJson('here: ```json\n{"d":4}\n```')).toThrow();
  });
  it('stops after 400 calls, with the app\'s wording', async () => {
    const d = deps();
    d.ceilings.ai = LIMITS.aiCalls - 1;
    expect((await handleBridgeRequest({ channel: 'ai', prompt: 'x' }, d)).ok).toBe(true);
    expect(await handleBridgeRequest({ channel: 'ai', prompt: 'x' }, d))
      .toEqual({ ok: false, error: 'This add-on has used its model-call allowance for this session.' });
  });
  it('counts a failed model call, but not one refused for shape or permission', async () => {
    const d = deps({ generateText: async () => { throw new Refusal(CONTRACT_MESSAGES.modelFailed, 'why'); } });
    expect(await handleBridgeRequest({ channel: 'ai', prompt: 'x' }, d)).toEqual({ ok: false, error: 'The model call failed.', note: 'why' });
    expect(d.ceilings.ai).toBe(1);
    await handleBridgeRequest({ channel: 'ai', prompt: '' }, d);
    await handleBridgeRequest({ channel: 'ai', prompt: 'x' }, { ...d, permissions: [] });
    expect(d.ceilings.ai).toBe(1);
  });
});

describe('storage', () => {
  it('needs storage:local, checked before the limits', async () => {
    expect(await handleBridgeRequest({ channel: 'storage', op: 'set', key: 'k', value: 'x'.repeat(524_289) }, deps({ permissions: [] })))
      .toEqual({ ok: false, error: 'This add-on did not request permission to store anything.' });
  });
  it('get, set, delete and keys resolve the documented values', async () => {
    const d = deps();
    expect(await handleBridgeRequest({ channel: 'storage', op: 'get', key: 'k' }, d)).toEqual({ ok: true, value: null });
    expect(await handleBridgeRequest({ channel: 'storage', op: 'set', key: 'k', value: 'v' }, d)).toEqual({ ok: true, value: true });
    expect(await handleBridgeRequest({ channel: 'storage', op: 'get', key: 'k' }, d)).toEqual({ ok: true, value: 'v' });
    expect(await handleBridgeRequest({ channel: 'storage', op: 'keys' }, d)).toEqual({ ok: true, value: ['k'] });
    expect(await handleBridgeRequest({ channel: 'storage', op: 'delete', key: 'k' }, d)).toEqual({ ok: true, value: true });
  });
  it('holds at most 512 keys and values of at most 524,288 characters', async () => {
    const d = deps();
    expect((await handleBridgeRequest({ channel: 'storage', op: 'set', key: 'k', value: 'x'.repeat(524_289) }, d)).error).toBe('That value is too large to store.');
    expect((await handleBridgeRequest({ channel: 'storage', op: 'set', key: 'k', value: 'x'.repeat(524_288) }, d)).ok).toBe(true);
    for (let i = 1; i < 512; i++) await d.storage.set(`k${i}`, '');
    expect((await handleBridgeRequest({ channel: 'storage', op: 'set', key: 'one-more', value: '' }, d)).error).toBe('This add-on has used all of its storage keys.');
    expect((await handleBridgeRequest({ channel: 'storage', op: 'set', key: 'k', value: 'overwrite' }, d)).ok).toBe(true);
  });
});

describe('external-api', () => {
  it('needs network, then a contributed source, then stops after 120 calls', async () => {
    expect((await handleBridgeRequest({ channel: 'external-api', apiId: 'a', opId: 'b' }, deps({ permissions: [] }))).error)
      .toBe('This add-on did not request network access.');
    const d = deps();
    expect((await handleBridgeRequest({ channel: 'external-api', apiId: 'other', opId: 'b' }, d)).error)
      .toBe('This add-on did not contribute that data source.');
    expect(d.ceilings.externalApi).toBe(0);
    d.ceilings.externalApi = LIMITS.externalCalls - 1;
    expect(await handleBridgeRequest({ channel: 'external-api', apiId: 'a', opId: 'b' }, d)).toEqual({ ok: true, value: { apiId: 'a', opId: 'b' } });
    expect((await handleBridgeRequest({ channel: 'external-api', apiId: 'a', opId: 'b' }, d)).error)
      .toBe('This add-on has used its data-call allowance for this session.');
  });
  it('applies pick: object keys and array indexes in a dot path', () => {
    const response = { docs: [{ title: 'Origin of Species', tags: ['biology'] }], numFound: 0 };
    expect(applyPick(response)).toBe(response);
    expect(applyPick(response, 'docs.0.title')).toBe('Origin of Species');
    expect(applyPick(response, 'docs.0.tags.0')).toBe('biology');
    expect(applyPick(response, 'numFound')).toBe(0);
    expect(applyPick({ a: null }, 'a')).toBeNull();
  });
  it('fails a pick that is missing or runs into null or a plain value, with the app\'s message', () => {
    const response = { docs: [{ title: 'T' }], none: null };
    for (const pick of ['missing', 'docs.1', 'docs.x', 'docs.0.title.length', 'none.x', 'docs.-1']) {
      expect(() => applyPick(response, pick)).toThrow(`The response had no "${pick}".`);
    }
  });
  it('passes on the data layer\'s own message', async () => {
    const d = deps({ callExternalApi: async () => { throw new Refusal('Parameter "q" is required.'); } });
    expect((await handleBridgeRequest({ channel: 'external-api', apiId: 'a', opId: 'b' }, d)).error).toBe('Parameter "q" is required.');
  });
});

describe('source-asset (source-media-v1)', () => {
  const media = [{ id: 'img-1', read: async () => new Uint8Array([9, 8, 7]).buffer }];
  it('validates the id: 1 to 128 characters', async () => {
    for (const id of ['', 'x'.repeat(129), 3]) {
      expect((await handleBridgeRequest({ channel: 'source-asset', id }, deps({ permissions: ['knowledge:read'], sourceMedia: media }))).error)
        .toBe('That request was not understood.');
    }
  });
  it('refuses in the app\'s order and wording: shape, then knowledge:read, then the advertised ids', async () => {
    expect((await handleBridgeRequest({ channel: 'source-asset', id: '' }, deps({ sourceMedia: media }))).error).toBe('That request was not understood.');
    expect((await handleBridgeRequest({ channel: 'source-asset', id: 'other' }, deps({ sourceMedia: media }))).error)
      .toBe('This add-on did not request knowledge access.');
    expect((await handleBridgeRequest({ channel: 'source-asset', id: 'other' }, deps({ permissions: ['knowledge:read'], sourceMedia: media }))).error)
      .toBe('This source image is not part of this activity.');
    // Outside a preparation job and its activity, no id is advertised.
    expect((await handleBridgeRequest({ channel: 'source-asset', id: 'img-1' }, deps({ permissions: ['knowledge:read'] }))).error)
      .toBe('This source image is not part of this activity.');
  });
  it('returns a copy of the bytes, transferred', async () => {
    const outcome = await handleBridgeRequest({ channel: 'source-asset', id: 'img-1' }, deps({ permissions: ['knowledge:read'], sourceMedia: media }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect([...new Uint8Array(outcome.value as ArrayBuffer)]).toEqual([9, 8, 7]);
      expect(outcome.transfer?.[0]).toBe(outcome.value as ArrayBuffer);
    }
  });
});

describe('Model calls Off (settings-v1)', () => {
  it('refuses after the permission check and before the ceiling, with the app\'s wording, without counting', async () => {
    const d = deps({ modelCallsOn: () => false });
    expect(await handleBridgeRequest({ channel: 'ai', prompt: 'x' }, d))
      .toEqual({ ok: false, error: 'Model calls are turned off for this add-on in its settings.', note: 'Model calls are Off in the Settings panel.' });
    expect(d.ceilings.ai).toBe(0);
    expect((await handleBridgeRequest({ channel: 'ai', prompt: 'x' }, { ...d, permissions: [] })).error).toBe('This add-on did not request permission to generate.');
    d.ceilings.ai = LIMITS.aiCalls;
    expect((await handleBridgeRequest({ channel: 'ai', prompt: 'x' }, d)).error).toBe('Model calls are turned off for this add-on in its settings.');
  });
});

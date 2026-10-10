import { describe, expect, it } from 'bun:test';
import { MemoryStorage, installNodeGlobals, installStorageShims } from '../src/shims.mjs';

describe('storage shims', () => {
  it('replaces storage that throws, like the sandbox\'s', () => {
    const target = {};
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(target, name, { configurable: true, get() { throw new Error('SecurityError'); } });
    }
    expect(installStorageShims(target)).toEqual(['localStorage', 'sessionStorage']);
    target.localStorage.setItem('a', 1);
    expect(target.localStorage.getItem('a')).toBe('1');
    expect(target.sessionStorage.getItem('a')).toBeNull();
  });

  it('leaves working storage alone', () => {
    const real = new MemoryStorage();
    const target = { localStorage: real, sessionStorage: real };
    expect(installStorageShims(target)).toEqual([]);
    expect(target.localStorage).toBe(real);
  });

  it('behaves like Storage', () => {
    const storage = new MemoryStorage();
    storage.setItem('x', 'one');
    storage.setItem('y', 'two');
    expect([storage.length, storage.key(1), storage.key(5)]).toEqual([2, 'y', null]);
    storage.removeItem('x');
    expect(storage.getItem('x')).toBeNull();
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it('adds the Node globals older libraries expect, only where missing', async () => {
    const target = {};
    expect(installNodeGlobals(target)).toEqual(['global', 'process']);
    expect(target.global).toBe(target);
    expect([target.process.env.NODE_ENV, target.process.browser]).toEqual(['production', true]);
    const ran = await new Promise(done => target.process.nextTick(done, 'ticked'));
    expect(ran).toBe('ticked');
    const process = { env: {} };
    expect(installNodeGlobals({ global: 1, process })).toEqual([]);
  });
});

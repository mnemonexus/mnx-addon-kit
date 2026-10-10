/**
 * Optional browser shims for ported projects; import before other dependencies.
 * Storage is in-memory and ends with the frame; use mnx.storage for persistence.
 * Also supplies process/global where absent, preserving existing implementations.
 */

/** The Storage methods, kept in a Map. */
export class MemoryStorage {
  #items = new Map();
  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.get(String(key)) ?? null; }
  setItem(key, value) { this.#items.set(String(key), String(value)); }
  removeItem(key) { this.#items.delete(String(key)); }
  clear() { this.#items.clear(); }
}

/** Puts a MemoryStorage wherever reading the real one throws. Returns the names it replaced. */
export function installStorageShims(target = globalThis) {
  const replaced = [];
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      if (target[name]) continue;
    } catch { /* blocked: replace it */ }
    Object.defineProperty(target, name, { value: new MemoryStorage(), configurable: true, enumerable: true, writable: true });
    replaced.push(name);
  }
  return replaced;
}

/** Adds `process` and `global` where they are missing. Returns the names it added. */
export function installNodeGlobals(target = globalThis) {
  const added = [];
  if (target.global === undefined) {
    target.global = target;
    added.push('global');
  }
  if (target.process === undefined) {
    target.process = {
      env: { NODE_ENV: 'production' }, browser: true, platform: 'browser', title: 'browser', version: '', versions: {}, argv: [],
      cwd: () => '/', nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)),
      on() { return this; }, once() { return this; }, off() { return this; }, emit: () => false, listeners: () => [],
    };
    added.push('process');
  }
  return added;
}

installStorageShims();
installNodeGlobals();

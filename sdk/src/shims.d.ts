/** In-memory `localStorage` and `sessionStorage`, installed on import where the real ones throw. */
export declare class MemoryStorage implements Storage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  [name: string]: any;
}
export declare function installStorageShims(target?: typeof globalThis): string[];
/** `process` (the small browser version) and `global`, installed on import where missing. */
export declare function installNodeGlobals(target?: typeof globalThis): string[];

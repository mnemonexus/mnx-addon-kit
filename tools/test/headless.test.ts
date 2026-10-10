import { describe, expect, it } from 'bun:test';
import { headlessRuntime } from '../src/headless';

const found = () => '/usr/bin/node';
const missing = () => null;

describe('which program runs the browser', () => {
  it('uses Node when it is installed', () => expect(headlessRuntime({}, 'linux', found)).toEqual({ command: '/usr/bin/node' }));
  it('falls back to Bun off Windows', () => expect(headlessRuntime({}, 'darwin', missing)).toEqual({ command: process.execPath }));
  it('never falls back to Bun on Windows, where Playwright hangs', () => {
    expect('reason' in headlessRuntime({}, 'win32', missing)).toBe(true);
  });
  it('can be forced', () => {
    expect(headlessRuntime({ MNX_HEADLESS_RUNTIME: 'bun' }, 'linux', found)).toEqual({ command: process.execPath });
    expect('reason' in headlessRuntime({ MNX_HEADLESS_RUNTIME: 'node' }, 'linux', missing)).toBe(true);
  });
});

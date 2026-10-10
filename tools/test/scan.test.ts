import { describe, expect, it } from 'bun:test';
import { scanCode, scanCss, scanTailwindColours } from '../src/scan';

const rules = (code: string, network = false) => scanCode(code, { network }).map(f => `${f.level}:${f.rule}`);

describe('static scan', () => {
  it('flags eval and new Function', () => {
    expect(rules('eval("1")')).toContain('error:no-eval');
    expect(rules('const f = new Function("return 1")')).toContain('error:no-eval');
    expect(rules('obj.eval(1); medieval(2)')).toEqual([]);
    // Minifying drops the "new".
    expect(rules('const f = Function("return 1")')).toContain('error:no-eval');
    expect(rules('isFunction(x); a.Function(1)')).toEqual([]);
  });
  it('flags compiling WebAssembly', () => {
    expect(rules('WebAssembly.instantiate(bytes)')).toContain('error:no-wasm');
    expect(rules('await WebAssembly.compileStreaming(r)')).toContain('error:no-wasm');
    expect(rules('new WebAssembly.Module(b)')).toContain('error:no-wasm');
    expect(rules('typeof WebAssembly === "object"; x === "[object WebAssembly.Module]"')).toEqual([]);
  });
  it('flags browser storage', () => {
    expect(rules('localStorage.setItem("a","b")')).toContain('error:no-browser-storage');
    expect(rules('window.sessionStorage')).toContain('error:no-browser-storage');
    expect(rules('indexedDB.open("x")')).toContain('error:no-browser-storage');
  });
  it('flags reaching outside the frame', () => {
    expect(rules('window.parent.postMessage({}, "*")')).toContain('error:no-parent-access');
    expect(rules('window.top.location')).toContain('error:no-parent-access');
    expect(rules('parent.postMessage(1)')).toContain('error:no-parent-access');
    expect(rules('window.opener')).toContain('error:no-parent-access');
    expect(rules('opener.focus()')).toContain('error:no-parent-access');
    expect(rules('this.state.opener(file); const o = { opener: 1 }')).toEqual([]);
    expect(rules('el.style.top = "1px"; node.parent.children')).toEqual([]);
  });
  it('flags network APIs only without the network permission', () => {
    for (const code of ['fetch("/x")', 'new XMLHttpRequest()', 'new WebSocket("wss://x")', 'new EventSource("/e")']) {
      expect(rules(code)).toContain('error:no-network');
      expect(rules(code, true)).toEqual([]);
    }
    expect(rules('api.fetch(1); prefetch(2)')).toEqual([]);
  });
  it('flags remote URLs in CSS', () => {
    expect(rules('s.textContent = "a { background: url(https://x.org/a.png) }"')).toContain('error:no-remote-css');
    expect(rules('s.textContent = "@import url(\'//fonts.example.com/a.css\');"')).toContain('error:no-remote-css');
    expect(rules('s.textContent = "a { background: url(data:image/png;base64,AAA) }"')).toEqual([]);
    expect(scanCss('@font-face { src: url("https://x.org/f.woff2") }', 'assets/a.css')).toHaveLength(1);
  });
  it('warns on innerHTML from non-literal strings', () => {
    expect(rules('el.innerHTML = "<b>fixed</b>";')).toEqual([]);
    expect(rules("el.innerHTML = '';")).toEqual([]);
    expect(rules('el.innerHTML = `<b>fixed</b>`;')).toEqual([]);
    expect(rules("el.innerHTML = '<div>' + \"<p>\" + `</p></div>`;")).toEqual([]);
    expect(rules('el.innerHTML = "<b>" + name + "</b>";')).toEqual(['warning:html-from-strings']);
    expect(rules('el.innerHTML = `<b>${name}</b>`;')).toEqual(['warning:html-from-strings']);
    expect(rules('el.innerHTML = text;')).toEqual(['warning:html-from-strings']);
    expect(rules('el.insertAdjacentHTML("beforeend", x)')).toEqual(['warning:html-from-strings']);
    expect(rules('if (el.innerHTML === x) {}')).toEqual([]);
  });
});

describe('Tailwind colours outside the preset', () => {
  const scan = (text: string) => scanTailwindColours([{ file: 'src/main.ts', text }]);
  it('points out Tailwind palette classes, which do nothing with the preset', () => {
    const [finding] = scan('el.className = "p-4 bg-white text-gray-500 hover:bg-blue-600/50 dark:border-slate-200";');
    expect(finding.level).toBe('warning');
    expect(finding.snippet).toBe('bg-white text-gray-500 hover:bg-blue-600/50 dark:border-slate-200');
    expect(finding.message).toContain('bg-mnx-surface');
  });
  it('says they still work, but stay fixed, when the add-on brings its own tailwind.config', () => {
    const [finding] = scanTailwindColours([{ file: 'src/App.tsx', text: '<div className="bg-white">' }], { keepsPalette: true });
    expect(finding.message).toContain("won't follow dark mode");
  });
  it('leaves the mnx colours and other utilities alone', () => {
    expect(scan('"bg-mnx-surface text-mnx-text border-mnx shadow-mnx text-sm text-center rounded-lg"')).toEqual([]);
    expect(scan('const background = "white"; const grey = text.gray;')).toEqual([]);
  });
});

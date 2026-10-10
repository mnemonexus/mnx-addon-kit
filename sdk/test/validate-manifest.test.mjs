import { describe, expect, it } from 'bun:test';
import { validateManifest } from '../src/validate-manifest.mjs';

// A valid experience. Each test changes one thing and expects one rule to fire.
const base = () => ({
  schemaVersion: 'mnxpack_manifest_v1', id: 'test-addon', version: '0.1.0', kind: 'experience',
  label: 'Test', description: 'A test add-on.', icon: 'fa-solid fa-flask', author: 'Test',
  knowledgeBinding: { mode: 'none' }, surfaces: {}, permissions: [], engines: { mnxSdk: '1.0.0' },
  entry: { logicalPath: 'code/main.cjs' }, assets: [],
});
const studyTask = () => ({ id: 'task-one', label: 'Task one', schema: 'demo-v1', matchAny: ['photosynthesis'], maxSeconds: 300 });
const leaf = (extra = {}) => ({ kind: 'always', whenTrue: 'Always offered.', whenFalse: 'Never offered.', ...extra });
const consumes = (compatRule = leaf()) => ({ knowledgeBinding: { mode: 'consumes', compatRule }, permissions: ['knowledge:read'] });
const source = (patch = {}) => ({
  id: 'open-library', name: 'Open Library', description: 'Book search.', category: 'books', auth: 'none',
  baseUrl: 'https://openlibrary.org', rateLimitPerMinute: 30,
  ops: [{ id: 'search', label: 'Search', cacheTtlMs: 60000, request: { method: 'GET', path: '/search.json', query: { q: '{q}' } } }],
  ...patch,
});
const op = (patch = {}, request = {}) => source({ ops: [{ id: 'search', label: 'Search', cacheTtlMs: 60000, ...patch,
  request: { method: 'GET', path: '/search.json', ...request } }] });
const automation = (patch = {}) => ({
  downloadUrl: 'https://example.edu/flow.mnxautomation.json', platform: 'Moodle', summary: ['Imports deadlines.'],
  domains: ['example.edu'], beforeUse: 'Sign in to Moodle first.', ...patch,
});
const produced = () => [{ key: 'k1', frameId: 'f1', statement: 'S', conceptTitle: 'C', descriptorType: 'definition', unlockedBy: 'stage-1' }];

function check(patch, stage) {
  const manifest = { ...base(), ...(typeof patch === 'function' ? patch(base()) : patch) };
  return validateManifest(manifest, { stage });
}
// `pass` is a manifest patch that must be accepted; `fail` one that must be refused
// with an error whose path starts with `path`.
function rule(name, { pass, fail, path }) {
  describe(name, () => {
    if (pass) it('accepts the valid form', () => {
      const report = check(pass);
      expect(report.errors).toEqual([]);
      expect(report.ok).toBe(true);
    });
    for (const [i, bad] of (fail === undefined ? [] : Array.isArray(fail) ? fail : [fail]).entries()) {
      it(`refuses the invalid form${Array.isArray(fail) ? ` #${i + 1}` : ''}`, () => {
        const report = check(bad);
        expect(report.ok).toBe(false);
        expect(report.errors.some(error => error.path.startsWith(path))).toBe(true);
      });
    }
  });
}

describe('strict schema', () => {
  it('accepts the base manifest', () => expect(check({}).ok).toBe(true));
  it('refuses a non-object', () => expect(validateManifest([]).ok).toBe(false));
  rule('unknown top-level keys are refused', { pass: { tagline: 'Short' }, fail: { colour: 'red' }, path: 'colour' });
  for (const key of ['schemaVersion', 'id', 'version', 'kind', 'label', 'description', 'icon', 'author',
    'knowledgeBinding', 'surfaces', 'permissions', 'engines', 'entry', 'assets']) {
    it(`requires ${key}`, () => {
      const manifest = base();
      delete manifest[key];
      const report = validateManifest(manifest);
      expect(report.ok).toBe(false);
      expect(report.errors.some(error => error.path === key)).toBe(true);
    });
  }
  rule('contentHash is left to the builder', { fail: { contentHash: 'a'.repeat(64) }, path: 'contentHash' });
});

rule('schemaVersion', { pass: { schemaVersion: 'mnxpack_manifest_v1' }, fail: { schemaVersion: 'v2' }, path: 'schemaVersion' });
rule('id is lowercase kebab-case, 1-64', {
  pass: { id: 'a1-b2' },
  fail: [{ id: 'My_Addon' }, { id: '' }, { id: 'a'.repeat(65) }, { id: 'double--hyphen' }, { id: '-lead' }], path: 'id',
});
rule('version is semver', {
  pass: { version: '1.2.3-beta.1' }, fail: [{ version: '1.2' }, { version: 'v1.2.3' }, { version: '01.2.3' }], path: 'version',
});
rule('kind', { pass: { kind: 'experience' }, fail: { kind: 'widget' }, path: 'kind' });
rule('label 1-80', { pass: { label: 'x'.repeat(80) }, fail: [{ label: '' }, { label: 'x'.repeat(81) }], path: 'label' });
rule('description 1-500', { pass: { description: 'x'.repeat(500) }, fail: [{ description: '' }, { description: 'x'.repeat(501) }], path: 'description' });
rule('tagline at most 120', { pass: { tagline: 'x'.repeat(120) }, fail: { tagline: 'x'.repeat(121) }, path: 'tagline' });
rule('icon 1-80', { pass: { icon: 'fa-solid fa-dna' }, fail: [{ icon: '' }, { icon: 'fa-' + 'x'.repeat(80) }], path: 'icon' });
rule('author 1-120', { pass: { author: 'x'.repeat(120) }, fail: [{ author: '' }, { author: 'x'.repeat(121) }], path: 'author' });
rule('packId is kebab-case, at most 64', {
  pass: { packId: '1st-bio-pack' }, fail: [{ packId: 3 }, { packId: 'Bio Pack' }, { packId: 'a'.repeat(65) }], path: 'packId',
});
rule('subjects: up to 16 strings of at most 64', {
  pass: { subjects: Array(16).fill('biology') },
  fail: [{ subjects: Array(17).fill('biology') }, { subjects: ['x'.repeat(65)] }, { subjects: 'biology' }, { subjects: [''] }], path: 'subjects',
});
rule('permissions: up to 16 known permissions', {
  pass: { permissions: ['storage:local', 'ai:generate'] },
  fail: [{ permissions: ['camera'] }, { permissions: 'storage:local' }, { permissions: Array(17).fill('storage:local') }], path: 'permissions',
});

describe('knowledgeBinding', () => {
  rule('mode is known', { pass: { knowledgeBinding: { mode: 'produces' } }, fail: { knowledgeBinding: { mode: 'reads' } }, path: 'knowledgeBinding' });
  rule('consumes needs a compatRule', { pass: consumes(), fail: { ...consumes(), knowledgeBinding: { mode: 'consumes' } }, path: 'knowledgeBinding.compatRule' });
  rule('none takes no other fields', { fail: { knowledgeBinding: { mode: 'none', compatRule: leaf() } }, path: 'knowledgeBinding.compatRule' });
});

describe('compatRule', () => {
  rule('every node has whenTrue and whenFalse of 1-240', {
    pass: consumes(leaf({ whenTrue: 'x'.repeat(240) })),
    fail: [consumes({ kind: 'always', whenFalse: 'No.' }), consumes(leaf({ whenFalse: '' })), consumes(leaf({ whenTrue: 'x'.repeat(241) }))],
    path: 'knowledgeBinding.compatRule',
  });
  rule('leaf kinds are known', { pass: consumes(leaf({ kind: 'hasConcept' })), fail: consumes(leaf({ kind: 'isHard' })), path: 'knowledgeBinding.compatRule.kind' });
  rule('minTextLength takes a whole-number value', {
    pass: consumes(leaf({ kind: 'minTextLength', value: 20 })), fail: consumes(leaf({ kind: 'minTextLength', value: 'long' })), path: 'knowledgeBinding.compatRule.value',
  });
  rule('minStructuredItems takes a whole-number value', {
    pass: consumes(leaf({ kind: 'minStructuredItems', value: 3 })), fail: consumes(leaf({ kind: 'minStructuredItems' })), path: 'knowledgeBinding.compatRule.value',
  });
  rule('hasMedia takes a boolean value', {
    pass: consumes(leaf({ kind: 'hasMedia', value: false })), fail: consumes(leaf({ kind: 'hasMedia', value: 'no' })), path: 'knowledgeBinding.compatRule.value',
  });
  for (const kind of ['descriptorTypeIn', 'descriptorStructureIn', 'conceptKindIn', 'practiceModeIn', 'tagIn', 'disciplineIn']) {
    rule(`${kind} takes 1-64 values`, {
      pass: consumes(leaf({ kind, values: ['sequence'] })),
      fail: [consumes(leaf({ kind, values: [] })), consumes(leaf({ kind, values: Array(65).fill('x') })), consumes(leaf({ kind }))],
      path: 'knowledgeBinding.compatRule.values',
    });
  }
  rule('allOf and anyOf take 1-16 rules', {
    pass: consumes(leaf({ kind: 'anyOf', rules: Array(16).fill(leaf()) })),
    fail: [consumes(leaf({ kind: 'allOf', rules: Array(17).fill(leaf()) })), consumes(leaf({ kind: 'anyOf', rules: [] }))],
    path: 'knowledgeBinding.compatRule.rules',
  });
  rule('not takes one rule', { pass: consumes(leaf({ kind: 'not', rule: leaf() })), fail: consumes(leaf({ kind: 'not' })), path: 'knowledgeBinding.compatRule.rule' });
  rule('leaves take no extra fields', { fail: consumes(leaf({ kind: 'always', value: 1 })), path: 'knowledgeBinding.compatRule.value' });
  rule('children are checked too', { fail: consumes(leaf({ kind: 'allOf', rules: [leaf({ kind: 'nope' })] })), path: 'knowledgeBinding.compatRule.rules[0]' });
  const nest = depth => depth === 1 ? leaf() : leaf({ kind: 'not', rule: nest(depth - 1) });
  rule('at most 10 levels deep', { pass: consumes(nest(10)), fail: consumes(nest(11)), path: 'knowledgeBinding.compatRule' });
});

describe('surfaces', () => {
  rule('unknown surfaces are refused', { pass: { surfaces: {} }, fail: { surfaces: { standalone: {} } }, path: 'surfaces.standalone' });
  rule('study: version 1 with 1-32 tasks', {
    pass: { surfaces: { study: { version: 1, tasks: Array.from({ length: 32 }, (_, i) => ({ ...studyTask(), id: `task-${i}` })) } } },
    fail: [
      { surfaces: { study: { version: 2, tasks: [studyTask()] } } },
      { surfaces: { study: { version: 1, tasks: [] } } },
      { surfaces: { study: { version: 1, tasks: Array.from({ length: 33 }, (_, i) => ({ ...studyTask(), id: `task-${i}` })) } } },
    ],
    path: 'surfaces.study',
  });
  const task = patch => ({ surfaces: { study: { version: 1, tasks: [{ ...studyTask(), ...patch }] } } });
  rule('study task ids are kebab-case', { pass: task({ id: 'sn2-backside' }), fail: task({ id: 'SN2 Backside' }), path: 'surfaces.study.tasks[0].id' });
  rule('study task ids are unique', {
    fail: { surfaces: { study: { version: 1, tasks: [studyTask(), studyTask()] } } }, path: 'surfaces.study.tasks[1].id',
  });
  rule('study task label 1-120', { pass: task({ label: 'x'.repeat(120) }), fail: [task({ label: '' }), task({ label: 'x'.repeat(121) })], path: 'surfaces.study.tasks[0].label' });
  rule('study task schema 1-120', { pass: task({ schema: 'x'.repeat(120) }), fail: [task({ schema: '' }), task({ schema: 'x'.repeat(121) })], path: 'surfaces.study.tasks[0].schema' });
  rule('study matchAny: 1-16 phrases of 2-100', {
    pass: task({ matchAny: Array(16).fill('ab') }),
    fail: [task({ matchAny: [] }), task({ matchAny: Array(17).fill('ab') }), task({ matchAny: ['a'] }), task({ matchAny: ['x'.repeat(101)] })],
    path: 'surfaces.study.tasks[0].matchAny',
  });
  rule('study maxSeconds 1-1800', { pass: task({ maxSeconds: 1800 }), fail: [task({ maxSeconds: 0 }), task({ maxSeconds: 1801 })], path: 'surfaces.study.tasks[0].maxSeconds' });
  rule('study tasks take no extra fields', { fail: task({ difficulty: 'hard' }), path: 'surfaces.study.tasks[0].difficulty' });

  const recall = (patch = {}, permissions = ['schedule:recall']) => ({ surfaces: { recall: { maxSeconds: 60, producesGrade: true, ...patch } }, permissions });
  rule('recall maxSeconds 1-300', { pass: recall({ maxSeconds: 300 }), fail: [recall({ maxSeconds: 0 }), recall({ maxSeconds: 301 })], path: 'surfaces.recall.maxSeconds' });
  rule('recall producesGrade is true', { fail: recall({ producesGrade: false }), path: 'surfaces.recall.producesGrade' });
  rule('recall needs schedule:recall', { pass: recall(), fail: recall({}, []), path: 'permissions' });

  const transferal = (patch = {}, binding = consumes()) => ({ ...binding, surfaces: { transferal: { category: 'application', minItems: 2, maxItems: 8, ...patch } } });
  rule('transferal category', { pass: transferal({ category: 'discovery' }), fail: transferal({ category: 'fun' }), path: 'surfaces.transferal.category' });
  rule('transferal minItems 1-500', { pass: transferal({ minItems: 500, maxItems: 500 }), fail: [transferal({ minItems: 0 }), transferal({ minItems: 501, maxItems: 600 })], path: 'surfaces.transferal.minItems' });
  rule('transferal maxItems >= minItems', { fail: transferal({ minItems: 5, maxItems: 4 }), path: 'surfaces.transferal.maxItems' });
  rule('transferal maxItems at most 500', { pass: transferal({ maxItems: 500 }), fail: transferal({ maxItems: 501 }), path: 'surfaces.transferal.maxItems' });
  rule('transferal needs consumes or transforms', {
    pass: transferal({}, { knowledgeBinding: { mode: 'transforms', compatRule: leaf() }, permissions: ['knowledge:read'] }),
    fail: transferal({}, { knowledgeBinding: { mode: 'none' }, permissions: [] }), path: 'knowledgeBinding.mode',
  });

  const calendar = (patch = {}, permissions = ['schedule:calendar']) => ({ surfaces: { calendar: { defaultMinutes: 15, recurrable: true, ...patch } }, permissions });
  rule('calendar defaultMinutes 1-1440', { pass: calendar({ defaultMinutes: 1440 }), fail: [calendar({ defaultMinutes: 0 }), calendar({ defaultMinutes: 1441 })], path: 'surfaces.calendar.defaultMinutes' });
  rule('calendar recurrable is boolean', { fail: calendar({ recurrable: 'yes' }), path: 'surfaces.calendar.recurrable' });
  rule('every number is a whole number', {
    fail: [recall({ maxSeconds: 1.5 }), transferal({ minItems: 1.5 }), calendar({ defaultMinutes: 2.5 }), task({ maxSeconds: 10.5 })], path: 'surfaces',
  });
  rule('calendar needs schedule:calendar', { pass: calendar(), fail: calendar({}, []), path: 'permissions' });

  rule('only experiences declare surfaces', {
    pass: { kind: 'index-view' },
    fail: [{ kind: 'index-view', ...calendar() }, { kind: 'recall-face', ...recall() }, { kind: 'knowledge-set', surfaces: { study: { version: 1, tasks: [studyTask()] } } }],
    path: 'surfaces',
  });
});

describe('permissions match what the manifest does', () => {
  rule('consumes needs knowledge:read', { pass: consumes(), fail: { ...consumes(), permissions: [] }, path: 'permissions' });
  rule('transforms needs knowledge:read', {
    pass: { knowledgeBinding: { mode: 'transforms', compatRule: leaf() }, permissions: ['knowledge:read'] },
    fail: { knowledgeBinding: { mode: 'transforms', compatRule: leaf() }, permissions: [] }, path: 'permissions',
  });
  rule('knowledge:read without consumes/transforms is an error', { fail: { permissions: ['knowledge:read'] }, path: 'permissions' });
  rule('producedKnowledge needs knowledge:unlock-authored', {
    pass: { knowledgeBinding: { mode: 'produces' }, producedKnowledge: produced(), permissions: ['knowledge:unlock-authored'] },
    fail: { knowledgeBinding: { mode: 'produces' }, producedKnowledge: produced(), permissions: [] }, path: 'permissions',
  });
  rule('knowledge:unlock-authored without a table is an error', {
    fail: { knowledgeBinding: { mode: 'produces' }, permissions: ['knowledge:unlock-authored'] }, path: 'permissions',
  });
  rule('producedKnowledge needs produces or transforms', {
    fail: { producedKnowledge: produced(), permissions: ['knowledge:unlock-authored'] }, path: 'knowledgeBinding.mode',
  });
  rule('knowledge:propose needs produces or transforms', {
    pass: { knowledgeBinding: { mode: 'produces' }, permissions: ['knowledge:propose'] },
    fail: { permissions: ['knowledge:propose'] }, path: 'knowledgeBinding.mode',
  });
  rule('dataSources needs network', {
    pass: { dataSources: [source()], permissions: ['network'] }, fail: { dataSources: [source()] }, path: 'permissions',
  });
  rule('engines.three needs render:3d', {
    pass: { engines: { mnxSdk: '1.0.0', three: '0.170.0' }, permissions: ['render:3d'] },
    fail: { engines: { mnxSdk: '1.0.0', three: '0.170.0' } }, path: 'permissions',
  });
});

describe('other fields', () => {
  rule('producedKnowledge: up to 256 complete rows', {
    fail: [
      { knowledgeBinding: { mode: 'produces' }, permissions: ['knowledge:unlock-authored'], producedKnowledge: Array(257).fill(produced()[0]) },
      { knowledgeBinding: { mode: 'produces' }, permissions: ['knowledge:unlock-authored'], producedKnowledge: [{ key: 'k' }] },
    ],
    path: 'producedKnowledge',
  });
  const pk = patch => ({ knowledgeBinding: { mode: 'produces' }, permissions: ['knowledge:unlock-authored'], producedKnowledge: [{ ...produced()[0], ...patch }] });
  rule('producedKnowledge field lengths', {
    pass: pk({ key: 'k'.repeat(64), frameId: 'f'.repeat(64), statement: 's'.repeat(2000), conceptTitle: 'c'.repeat(240), descriptorType: 'd'.repeat(64), unlockedBy: 'u'.repeat(64), tags: Array(16).fill('t'.repeat(64)) }),
    fail: [pk({ key: 'k'.repeat(65) }), pk({ frameId: '' }), pk({ statement: 's'.repeat(2001) }), pk({ conceptTitle: 'c'.repeat(241) }),
      pk({ descriptorType: 'd'.repeat(65) }), pk({ unlockedBy: 'u'.repeat(65) }), pk({ tags: Array(17).fill('t') }), pk({ tags: [''] })],
    path: 'producedKnowledge[0]',
  });
  rule('producedKnowledge: blank statement or unlockedBy is an error', { fail: [pk({ statement: '   ' }), pk({ unlockedBy: ' ' })], path: 'producedKnowledge[0]' });
  rule('producedKnowledge: a repeated key is an error', {
    fail: { knowledgeBinding: { mode: 'produces' }, permissions: ['knowledge:unlock-authored'], producedKnowledge: [produced()[0], produced()[0]] },
    path: 'producedKnowledge[1].key',
  });
  const ds = (...sources) => ({ dataSources: sources, permissions: ['network'] });
  rule('dataSources: up to 6 with unique ids', {
    pass: ds(source(), source({ id: 'second' })),
    fail: [ds(...Array.from({ length: 7 }, (_, i) => source({ id: `s${i}` }))), ds(source(), source())], path: 'dataSources',
  });
  rule('dataSources: source fields', {
    pass: ds(source({ docsUrl: 'https://openlibrary.org/developers', testParams: { q: 'darwin' } })),
    fail: [ds(source({ id: 'Open Library' })), ds(source({ name: '' })), ds(source({ description: 'x'.repeat(501) })), ds(source({ category: 'games' })),
      ds(source({ docsUrl: 'not a url' })), ds(source({ baseUrl: 'http://openlibrary.org' })), ds(source({ rateLimitPerMinute: 31 })),
      ds(source({ rateLimitPerMinute: 1.5 })), ds(source({ testParams: { q: '' } })), ds(source({ ops: [] })), ds(source({ extra: 1 }))],
    path: 'dataSources[0]',
  });
  rule('dataSources: auth needs its key fields', {
    pass: [ds(source({ auth: 'addon-shared', sharedKey: 'abc' })), ds(source({ auth: 'user', keySignupUrl: 'https://openlibrary.org/keys' }))][0],
    fail: [ds(source({ auth: 'addon-shared' })), ds(source({ auth: 'user' })), ds(source({ auth: 'secret' }))], path: 'dataSources[0]',
  });
  rule('dataSources: operations', {
    pass: ds(op({ pick: 'docs' }, { method: 'POST', body: '{"q":"{q}"}', headers: { accept: 'application/json' } })),
    fail: [ds(op({ id: 'Search' })), ds(op({ label: '' })), ds(op({ cacheTtlMs: 0 })), ds(op({ cacheTtlMs: 2_592_000_001 })),
      ds(op({ pick: 'x'.repeat(201) })), ds(op({}, { method: 'PUT' })), ds(op({}, { path: 'search' })), ds(op({}, { method: 'POST' })),
      ds(op({}, { body: '{}' })), ds(op({}, { query: { q: '' } })), ds(source({ ops: [source().ops[0], source().ops[0]] }))],
    path: 'dataSources[0]',
  });
  rule('presentation.fit', { pass: { presentation: { fit: 'canvas' } }, fail: { presentation: { fit: 'cover' } }, path: 'presentation.fit' });
  rule('engines.mnxSdk major equals the protocol', {
    pass: { engines: { mnxSdk: '^1.0.0' } },
    fail: [{ engines: { mnxSdk: '2.0.0' } }, { engines: { mnxSdk: '^2' } }, { engines: { mnxSdk: 'latest' } }, { engines: {} },
      { engines: { mnxSdk: '1.0.0', react: '18' } }, { engines: { mnxSdk: '1.' + '0'.repeat(63) } }],
    path: 'engines',
  });
  for (const range of ['1.0.0', '1.4.0', '^1.0.0', '~1.2.3', '>=1.2', '>= 1', '1']) {
    it(`engines.mnxSdk accepts "${range}"`, () => expect(check({ engines: { mnxSdk: range } }).ok).toBe(true));
  }
  rule('engines.three is 1-64 characters', {
    pass: { engines: { mnxSdk: '1.0.0', three: '0.170.0' }, permissions: ['render:3d'] },
    fail: { engines: { mnxSdk: '1.0.0', three: '' }, permissions: ['render:3d'] }, path: 'engines.three',
  });
  rule('entry.logicalPath is a canonical code/ path', {
    pass: { entry: { logicalPath: 'code/main.cjs' } },
    fail: [{ entry: { logicalPath: 'main.cjs' } }, { entry: { logicalPath: 'code/../x.cjs' } }, { entry: { logicalPath: 'code//x.cjs' } },
      { entry: { logicalPath: 'code/a%20b.cjs' } }, { entry: { logicalPath: 'code\\x.cjs' } }, { entry: { logicalPath: 'code/' + 'x'.repeat(256) } }],
    path: 'entry',
  });
  rule('assets: canonical, unique, under assets/', {
    pass: { assets: [{ logicalPath: 'assets/a.png', mimeType: 'image/png' }, { logicalPath: 'assets/b/c.json' }] },
    fail: [{ assets: [{ logicalPath: 'img/a.png' }] }, { assets: [{ logicalPath: 'assets/a.png' }, { logicalPath: 'assets/a.png' }] },
      { assets: [{ logicalPath: 'assets/./a.png' }] }, { assets: Array.from({ length: 4097 }, (_, i) => ({ logicalPath: `assets/${i}` })) }],
    path: 'assets',
  });
  rule('cover.src must be a declared asset', {
    pass: { assets: [{ logicalPath: 'assets/cover.png' }], cover: { src: 'assets/cover.png', tone: 'warm' } },
    fail: { cover: { src: 'assets/cover.png' } }, path: 'cover.src',
  });
  rule('cover.pattern and cover.tone are at most 64', {
    pass: { cover: { pattern: 'p'.repeat(64), tone: 't'.repeat(64) } }, fail: [{ cover: { pattern: 'p'.repeat(65) } }, { cover: { tone: 3 } }], path: 'cover',
  });
  rule('tagline may be empty', { pass: { tagline: '' } });
  rule('repeated permissions are allowed', { pass: { permissions: ['storage:local', 'storage:local'] } });
});

describe('automation-template packs are data only', () => {
  const template = { kind: 'automation-template', automationTemplate: automation() };
  const at = patch => ({ kind: 'automation-template', automationTemplate: automation(patch) });
  rule('descriptor fields', {
    pass: at({ downloadUrl: '/addons/automation/moodle-deadlines.mnxautomation.json', institution: 'Example University' }),
    fail: [at({ downloadUrl: 'http://example.edu/f.json' }), at({ downloadUrl: 'https://user:pw@example.edu/f.json' }),
      at({ downloadUrl: '/addons/automation/Bad_Name.mnxautomation.json' }), at({ downloadUrl: 'https://x.edu/' + 'a'.repeat(2048) }),
      at({ platform: '' }), at({ institution: 'i'.repeat(121) }), at({ summary: [] }), at({ summary: Array(13).fill('s') }),
      at({ summary: ['s'.repeat(181)] }), at({ domains: Array(25).fill('a.b') }), at({ domains: ['Example.EDU'] }),
      at({ beforeUse: '' }), at({ extra: true })],
    path: 'automationTemplate',
  });
  rule('valid', { pass: template });
  rule('no permissions', { fail: { ...template, permissions: ['storage:local'] }, path: 'permissions' });
  rule('no surfaces', { fail: { ...template, surfaces: { study: { version: 1, tasks: [studyTask()] } } }, path: 'surfaces' });
  rule('binding none', { fail: { ...template, knowledgeBinding: { mode: 'produces' } }, path: 'knowledgeBinding.mode' });
  rule('needs a descriptor', { fail: { kind: 'automation-template' }, path: 'automationTemplate' });
  rule('only that kind has a descriptor', { fail: { automationTemplate: automation() }, path: 'automationTemplate' });
});

describe('built manifests', () => {
  const built = {
    entry: { logicalPath: 'code/main.cjs', sizeBytes: 10, contentHash: 'a'.repeat(64) },
    assets: [{ logicalPath: 'assets/a.json', sizeBytes: 2, contentHash: 'b'.repeat(64), mimeType: null }],
    contentHash: 'c'.repeat(64),
  };
  it('accepts sizes and hashes from the builder', () => expect(check(built, 'built').errors).toEqual([]));
  it('refuses a built manifest without a contentHash', () => expect(check({ ...built, contentHash: undefined }, 'built').ok).toBe(false));
  it('refuses builder fields in a source manifest', () => expect(check({ entry: built.entry }).ok).toBe(false));
});

describe('learning contribution (addon-learning-v1)', () => {
  const learning = (patch = {}) => ({
    version: 1,
    schemas: { 'sequence-v1': { type: 'object', required: ['steps'], properties: { steps: { type: 'array', items: { type: 'string' }, minItems: 2 } } } },
    activities: [{ id: 'order-steps', label: 'Order steps', payloadSchema: 'sequence-v1', maxSeconds: 300, surfaces: ['study'] }],
    ...patch,
  });
  const withLearning = (patch = {}, extra = {}) => ({ learning: learning(patch), permissions: ['knowledge:read'], ...extra });
  rule('a valid contribution with knowledge:read and binding none', { pass: withLearning() });
  rule('needs knowledge:read', { fail: withLearning({}, { permissions: [] }), path: 'permissions' });
  rule('knowledge:read is allowed with learning and no consumes binding', { pass: withLearning() });
  rule('only experiences', { fail: withLearning({}, { kind: 'index-view' }), path: 'learning' });
  rule('version 1', { fail: withLearning({ version: 2 }), path: 'learning.version' });
  rule('only known fields', { fail: withLearning({ extra: true }), path: 'learning.extra' });
  rule('at most 16 schemas', {
    fail: withLearning({ schemas: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`s-${i}`, { type: 'string' }])) }), path: 'learning.schemas',
  });
  rule('schema keywords are the documented subset', {
    fail: withLearning({ schemas: { 'sequence-v1': { type: 'string', pattern: 'x' } } }), path: 'learning.schemas.sequence-v1.pattern',
  });
  rule('arrays declare their items', {
    fail: withLearning({ schemas: { 'sequence-v1': { type: 'array' } } }), path: 'learning.schemas.sequence-v1.items',
  });
  rule('activity ids are unique', {
    fail: withLearning({ activities: [learning().activities[0], learning().activities[0]] }), path: 'learning.activities[1].id',
  });
  rule('activities refer to a registered schema', {
    fail: withLearning({ activities: [{ ...learning().activities[0], payloadSchema: 'missing-v1' }] }), path: 'learning.activities[0].payloadSchema',
  });
  rule('activity maxSeconds 1-1800', {
    fail: withLearning({ activities: [{ ...learning().activities[0], maxSeconds: 1801 }] }), path: 'learning.activities[0].maxSeconds',
  });
  rule('activity surfaces are study and/or recall', {
    pass: withLearning({ activities: [{ ...learning().activities[0], surfaces: ['study', 'recall'] }] }),
    fail: withLearning({ activities: [{ ...learning().activities[0], surfaces: ['calendar'] }] }), path: 'learning.activities[0].surfaces',
  });
});

describe('settings (settings-v1)', () => {
  const toggle = { id: 'showHints', label: 'Show hints', type: 'toggle', default: true };
  const choice = { id: 'difficulty', label: 'Difficulty', type: 'choice', options: [{ value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }], default: 'easy' };
  const number = { id: 'rounds', label: 'Rounds', type: 'number', min: 1, max: 10, step: 1, unit: 'rounds', default: 3 };
  const textField = { id: 'greeting', label: 'Greeting', type: 'text', default: 'Hello', maxLength: 40, placeholder: 'Say hi' };
  const settings = (...fields) => ({ settings: fields });
  rule('all four types', { pass: settings(toggle, choice, number, textField, { id: 'notes', label: 'Notes', type: 'text' }) });
  rule('a list of at most 24 fields', {
    fail: [{ settings: toggle }, settings(...Array.from({ length: 25 }, (_, i) => ({ ...toggle, id: `t${i}` })))], path: 'settings',
  });
  rule('id format and uniqueness', {
    fail: [settings({ ...toggle, id: 'Show' }), settings({ ...toggle, id: '1st' }), settings({ ...toggle, id: 'a'.repeat(65) }), settings(toggle, toggle)],
    path: 'settings[',
  });
  rule('label 1-80 and description 1-240', {
    pass: settings({ ...toggle, description: 'd'.repeat(240) }),
    fail: [settings({ ...toggle, label: '' }), settings({ ...toggle, label: 'l'.repeat(81) }), settings({ ...toggle, description: '' })], path: 'settings[0]',
  });
  rule('type is known (no secret type)', { fail: settings({ ...toggle, type: 'secret' }), path: 'settings[0].type' });
  rule('fields are checked strictly by type', { fail: settings({ ...toggle, options: [] }), path: 'settings[0].options' });
  rule('toggle default is boolean', { fail: settings({ ...toggle, default: 'yes' }), path: 'settings[0].default' });
  rule('choice: 2-12 unique options and a default among them', {
    fail: [settings({ ...choice, options: [choice.options[0]] }), settings({ ...choice, options: Array.from({ length: 13 }, (_, i) => ({ value: `v${i}`, label: 'L' })) }),
      settings({ ...choice, options: [choice.options[0], choice.options[0]] }), settings({ ...choice, default: 'medium' }),
      settings({ ...choice, options: [{ value: '', label: 'Empty' }, choice.options[1]] })],
    path: 'settings[0]',
  });
  rule('number: finite bounds, max > min, step > 0, unit 1-16, default in range', {
    pass: settings({ ...number, min: -1.5, max: 2.5, default: 0, step: 0.5 }),
    fail: [settings({ ...number, max: 1 }), settings({ ...number, min: Infinity }), settings({ ...number, step: 0 }), settings({ ...number, unit: 'u'.repeat(17) }),
      settings({ ...number, default: 11 }), settings({ ...number, default: '3' })],
    path: 'settings[0]',
  });
  rule('text: default ≤ maxLength (500 without one), maxLength 1-2000, placeholder 1-120', {
    pass: settings({ id: 'notes', label: 'Notes', type: 'text', default: 'x'.repeat(500) }),
    fail: [settings({ ...textField, default: 'x'.repeat(41) }), settings({ id: 'notes', label: 'Notes', type: 'text', default: 'x'.repeat(501) }),
      settings({ ...textField, maxLength: 2001 }), settings({ ...textField, maxLength: 1.5 }), settings({ ...textField, placeholder: '' })],
    path: 'settings[0]',
  });
});

/** Validate the manifest schema, then permission and binding rules.
 * See HOST_CONTRACT.md section 7 for accepted fields and constraints. */

import { validateLearningContribution } from './learning.mjs';

export const MANIFEST_SCHEMA_VERSION = 'mnxpack_manifest_v1';
export const HOST_PROTOCOL_VERSION = 1;

export const PACK_KINDS = Object.freeze(['experience', 'recall-face', 'index-view', 'knowledge-set', 'automation-template']);
export const PERMISSIONS = Object.freeze(['knowledge:read', 'knowledge:unlock-authored', 'knowledge:propose',
  'ai:generate', 'schedule:recall', 'schedule:calendar', 'network', 'multiplayer', 'render:3d', 'storage:local']);
export const BINDING_MODES = Object.freeze(['none', 'produces', 'consumes', 'transforms']);
export const SURFACE_NAMES = Object.freeze(['study', 'recall', 'transferal', 'calendar']);
export const TRANSFERAL_CATEGORIES = Object.freeze(['application', 'integration', 'multiplayer', 'discovery']);
export const COMPAT_LIST_LEAVES = Object.freeze(['descriptorTypeIn', 'descriptorStructureIn', 'conceptKindIn',
  'practiceModeIn', 'tagIn', 'disciplineIn']);
export const COMPAT_LEAVES = Object.freeze(['always', 'hasConcept', 'minTextLength', 'minStructuredItems', 'hasMedia',
  ...COMPAT_LIST_LEAVES]);
export const COMPAT_COMBINATORS = Object.freeze(['allOf', 'anyOf', 'not']);

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const HASH = /^[a-f0-9]{64}$/;

const TOP_KEYS = ['schemaVersion', 'id', 'version', 'kind', 'label', 'description', 'tagline', 'icon', 'author',
  'packId', 'subjects', 'knowledgeBinding', 'surfaces', 'permissions', 'producedKnowledge', 'dataSources',
  'presentation', 'engines', 'entry', 'assets', 'cover', 'automationTemplate', 'learning', 'settings', 'contentHash'];
export const SETTING_TYPES = Object.freeze(['toggle', 'choice', 'number', 'text']);
const REQUIRED_TOP = ['schemaVersion', 'id', 'version', 'kind', 'label', 'description', 'icon', 'author',
  'knowledgeBinding', 'surfaces', 'permissions', 'engines', 'entry', 'assets'];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isInteger(value);

/** True for a canonical path inside `prefix` (contract section 1). */
export function isCanonicalPath(path, prefix) {
  return typeof path === 'string' && path.length <= 256 && path.startsWith(prefix) &&
    !/[\\%\u0000-\u001f\u007f]/.test(path) &&
    path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/**
 * Check a manifest. `stage` is `'source'` for the manifest you write (the
 * builder has not added sizes and hashes yet) or `'built'` for a `pack.json`
 * read out of a `.mnxpack`.
 *
 * Returns `{ ok, errors, warnings }`. Each problem is `{ path, message }`.
 */
export function validateManifest(manifest, { stage = 'source' } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });

  const text = (value, path, min, max, label = path) => {
    if (typeof value !== 'string') return fail(path, `${label} must be text.`), false;
    if (value.length < min) return fail(path, min === 1 ? `${label} must not be empty.` : `${label} must be at least ${min} characters.`), false;
    if (value.length > max) return fail(path, `${label} must be at most ${max} characters (it has ${value.length}).`), false;
    return true;
  };
  const unknownKeys = (object, allowed, path) => {
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) fail(path ? `${path}.${key}` : key, `"${key}" is not a field the app knows${path ? ` in ${path}` : ''}. The app refuses unknown fields.`);
    }
  };
  const integer = (value, path, min, max) => {
    if (!isInt(value)) return fail(path, `${path} must be a whole number.`), false;
    if (value < min || (max !== undefined && value > max)) {
      return fail(path, max === undefined ? `${path} must be at least ${min}.` : `${path} must be between ${min} and ${max}.`), false;
    }
    return true;
  };

  // Schema validation.
  if (!isObject(manifest)) {
    fail('', 'The manifest must be a JSON object.');
    return { ok: false, errors, warnings };
  }
  unknownKeys(manifest, TOP_KEYS, '');
  for (const key of REQUIRED_TOP) {
    if (!(key in manifest)) fail(key, `The manifest is missing "${key}".`);
  }
  if (stage === 'source' && 'contentHash' in manifest) {
    fail('contentHash', 'Leave out contentHash. The pack builder computes it.');
  }
  if (stage === 'built' && !(typeof manifest.contentHash === 'string' && HASH.test(manifest.contentHash))) {
    fail('contentHash', 'A built manifest needs a contentHash (64 lowercase hex characters).');
  }

  if ('schemaVersion' in manifest && manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail('schemaVersion', `schemaVersion must be "${MANIFEST_SCHEMA_VERSION}".`);
  }
  if ('id' in manifest && text(manifest.id, 'id', 1, 64) && !KEBAB.test(manifest.id)) {
    fail('id', 'id must be lowercase kebab-case, like "my-addon": letters a-z, digits, single hyphens between words.');
  }
  if ('version' in manifest && (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version))) {
    fail('version', 'version must be a semantic version, like "1.2.3" or "1.2.3-beta.1".');
  }
  const kind = manifest.kind;
  if ('kind' in manifest && !PACK_KINDS.includes(kind)) {
    fail('kind', `kind must be one of: ${PACK_KINDS.join(', ')}.`);
  }
  if ('label' in manifest) text(manifest.label, 'label', 1, 80);
  if ('description' in manifest) text(manifest.description, 'description', 1, 500);
  if ('tagline' in manifest) text(manifest.tagline, 'tagline', 0, 120);
  if ('icon' in manifest && text(manifest.icon, 'icon', 1, 80) && !/\bfa-/.test(manifest.icon)) {
    warn('icon', 'icon should be a Font Awesome class, like "fa-solid fa-flask".');
  }
  if ('author' in manifest) text(manifest.author, 'author', 1, 120);
  if ('packId' in manifest && text(manifest.packId, 'packId', 1, 64) && !KEBAB.test(manifest.packId)) {
    fail('packId', 'packId must be lowercase kebab-case, like "biology-pack".');
  }
  if ('subjects' in manifest) {
    if (!Array.isArray(manifest.subjects)) fail('subjects', 'subjects must be a list of text.');
    else {
      if (manifest.subjects.length > 16) fail('subjects', `subjects can hold at most 16 entries (it has ${manifest.subjects.length}).`);
      manifest.subjects.forEach((subject, i) => text(subject, `subjects[${i}]`, 1, 64));
    }
  }

  // Permissions.
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if ('permissions' in manifest) {
    if (!Array.isArray(manifest.permissions)) fail('permissions', 'permissions must be a list.');
    else {
      if (manifest.permissions.length > 16) fail('permissions', 'permissions can hold at most 16 entries.');
      manifest.permissions.forEach((permission, i) => {
        if (!PERMISSIONS.includes(permission)) fail(`permissions[${i}]`, `"${permission}" is not a permission. Use one of: ${PERMISSIONS.join(', ')}.`);
      });
    }
  }
  const has = permission => permissions.includes(permission);

  // Knowledge binding.
  const binding = manifest.knowledgeBinding;
  const mode = isObject(binding) ? binding.mode : undefined;
  if ('knowledgeBinding' in manifest) {
    if (!isObject(binding)) fail('knowledgeBinding', 'knowledgeBinding must be an object, like {"mode": "none"}.');
    else if (!BINDING_MODES.includes(binding.mode)) {
      fail('knowledgeBinding.mode', `knowledgeBinding.mode must be one of: ${BINDING_MODES.join(', ')}.`);
    } else if (binding.mode === 'consumes' || binding.mode === 'transforms') {
      unknownKeys(binding, ['mode', 'compatRule'], 'knowledgeBinding');
      if (!('compatRule' in binding)) fail('knowledgeBinding.compatRule', `The "${binding.mode}" binding needs a compatRule that picks the knowledge items.`);
      else validateCompatRule(binding.compatRule, 'knowledgeBinding.compatRule', 1, fail, text);
    } else {
      unknownKeys(binding, ['mode'], 'knowledgeBinding');
    }
  }

  // Surfaces.
  const surfaces = manifest.surfaces;
  if ('surfaces' in manifest) {
    if (!isObject(surfaces)) fail('surfaces', 'surfaces must be an object. Use {} for none.');
    else {
      unknownKeys(surfaces, SURFACE_NAMES, 'surfaces');
      if (kind !== 'experience') {
        for (const name of SURFACE_NAMES) {
          if (name in surfaces) fail(`surfaces.${name}`, `Only an experience can declare the ${name} surface (this pack is a ${kind}).`);
        }
      }
      if ('study' in surfaces) validateStudy(surfaces.study, fail, text, integer, unknownKeys);
      if ('recall' in surfaces) {
        const recall = surfaces.recall;
        if (!isObject(recall)) fail('surfaces.recall', 'surfaces.recall must be an object.');
        else {
          unknownKeys(recall, ['maxSeconds', 'producesGrade'], 'surfaces.recall');
          integer(recall.maxSeconds, 'surfaces.recall.maxSeconds', 1, 300);
          if (recall.producesGrade !== true) fail('surfaces.recall.producesGrade', 'surfaces.recall.producesGrade must be true. A recall run always returns a quality grade.');
        }
        if (!has('schedule:recall')) fail('permissions', 'The recall surface needs the "schedule:recall" permission.');
      }
      if ('transferal' in surfaces) {
        const transferal = surfaces.transferal;
        if (!isObject(transferal)) fail('surfaces.transferal', 'surfaces.transferal must be an object.');
        else {
          unknownKeys(transferal, ['category', 'minItems', 'maxItems'], 'surfaces.transferal');
          if (!TRANSFERAL_CATEGORIES.includes(transferal.category)) {
            fail('surfaces.transferal.category', `surfaces.transferal.category must be one of: ${TRANSFERAL_CATEGORIES.join(', ')}.`);
          }
          const minOk = integer(transferal.minItems, 'surfaces.transferal.minItems', 1, 500);
          if (integer(transferal.maxItems, 'surfaces.transferal.maxItems', 1, 500) && minOk && transferal.maxItems < transferal.minItems) {
            fail('surfaces.transferal.maxItems', 'surfaces.transferal.maxItems must be at least minItems.');
          }
        }
        if (mode !== 'consumes' && mode !== 'transforms') {
          fail('knowledgeBinding.mode', 'The transferal surface needs the knowledge binding "consumes" or "transforms".');
        }
      }
      if ('calendar' in surfaces) {
        const calendar = surfaces.calendar;
        if (!isObject(calendar)) fail('surfaces.calendar', 'surfaces.calendar must be an object.');
        else {
          unknownKeys(calendar, ['defaultMinutes', 'recurrable'], 'surfaces.calendar');
          integer(calendar.defaultMinutes, 'surfaces.calendar.defaultMinutes', 1, 1440);
          if (typeof calendar.recurrable !== 'boolean') fail('surfaces.calendar.recurrable', 'surfaces.calendar.recurrable must be true or false.');
        }
        if (!has('schedule:calendar')) fail('permissions', 'The calendar surface needs the "schedule:calendar" permission.');
      }
    }
  }

  // Produced knowledge.
  const produced = manifest.producedKnowledge;
  if ('producedKnowledge' in manifest) {
    if (!Array.isArray(produced)) fail('producedKnowledge', 'producedKnowledge must be a list.');
    else {
      if (produced.length > 256) fail('producedKnowledge', `producedKnowledge can hold at most 256 entries (it has ${produced.length}).`);
      const keys = new Set();
      const LIMITS = { key: 64, frameId: 64, statement: 2000, conceptTitle: 240, descriptorType: 64, unlockedBy: 64 };
      produced.forEach((row, i) => {
        const path = `producedKnowledge[${i}]`;
        if (!isObject(row)) return fail(path, `${path} must be an object.`);
        unknownKeys(row, ['key', 'frameId', 'statement', 'conceptTitle', 'descriptorType', 'tags', 'unlockedBy'], path);
        for (const [field, max] of Object.entries(LIMITS)) {
          if (!(field in row)) fail(`${path}.${field}`, `${path} is missing "${field}".`);
          else if (text(row[field], `${path}.${field}`, 1, max) && (field === 'statement' || field === 'unlockedBy') && !row[field].trim()) {
            fail(`${path}.${field}`, `${path}.${field} must not be blank.`);
          }
        }
        if ('tags' in row) {
          if (!Array.isArray(row.tags) || row.tags.length > 16) fail(`${path}.tags`, `${path}.tags must be a list of up to 16 tags.`);
          else row.tags.forEach((tag, j) => text(tag, `${path}.tags[${j}]`, 1, 64));
        }
        if (typeof row.key === 'string') {
          if (keys.has(row.key)) fail(`${path}.key`, `The key "${row.key}" is used twice. Each producedKnowledge key must be unique.`);
          keys.add(row.key);
        }
      });
    }
  }

  // Data sources.
  if ('dataSources' in manifest) validateDataSources(manifest.dataSources, fail, text, integer, unknownKeys);

  if ('presentation' in manifest) {
    const presentation = manifest.presentation;
    if (!isObject(presentation)) fail('presentation', 'presentation must be an object, like {"fit": "content"}.');
    else {
      unknownKeys(presentation, ['fit'], 'presentation');
      if ('fit' in presentation && !['content', 'canvas'].includes(presentation.fit)) {
        fail('presentation.fit', 'presentation.fit must be "content" or "canvas".');
      }
    }
  }

  // Engines.
  const engines = manifest.engines;
  if ('engines' in manifest) {
    if (!isObject(engines)) fail('engines', 'engines must be an object, like {"mnxSdk": "1.0.0"}.');
    else {
      unknownKeys(engines, ['mnxSdk', 'three'], 'engines');
      if (text(engines.mnxSdk, 'engines.mnxSdk', 1, 64)) {
        // The host strips any leading ^ ~ > = < and spaces, then reads the
        // first number as the major. So "1.0.0", "^1.0.0" and ">=1.2" all work.
        const major = /^\d+/.exec(engines.mnxSdk.replace(/^[\^~>=<\s]+/, ''));
        if (!major || Number(major[0]) !== HOST_PROTOCOL_VERSION) {
          fail('engines.mnxSdk', `engines.mnxSdk must have major version ${HOST_PROTOCOL_VERSION}, to match the host's protocol (for example "1.0.0" or "^1.0.0").`);
        }
      }
      if ('three' in engines) text(engines.three, 'engines.three', 1, 64);
    }
  }

  // Entry and assets.
  if ('entry' in manifest) {
    const entry = manifest.entry;
    if (!isObject(entry)) fail('entry', 'entry must be an object, like {"logicalPath": "code/main.cjs"}.');
    else {
      unknownKeys(entry, stage === 'built' ? ['logicalPath', 'sizeBytes', 'contentHash'] : ['logicalPath'], 'entry');
      if (!isCanonicalPath(entry.logicalPath, 'code/')) {
        fail('entry.logicalPath', 'entry.logicalPath must be a clean path under code/, like "code/main.cjs" (no "..", ".", "\\", "%" or empty parts; at most 256 characters).');
      }
      if (stage === 'built') {
        if (!(isInt(entry.sizeBytes) && entry.sizeBytes >= 1 && entry.sizeBytes <= 8 * 1024 * 1024)) fail('entry.sizeBytes', 'entry.sizeBytes must be 1 byte to 8 MiB.');
        if (!(typeof entry.contentHash === 'string' && HASH.test(entry.contentHash))) fail('entry.contentHash', 'entry.contentHash must be a SHA-256 hex digest.');
      }
    }
  }
  const declared = new Set();
  if ('assets' in manifest) {
    const assets = manifest.assets;
    if (!Array.isArray(assets)) fail('assets', 'assets must be a list. Use [] for none.');
    else {
      if (assets.length > 4096) fail('assets', `A pack can declare at most 4096 assets (this one has ${assets.length}).`);
      assets.forEach((asset, i) => {
        const path = `assets[${i}]`;
        if (!isObject(asset)) return fail(path, `${path} must be an object, like {"logicalPath": "assets/picture.png"}.`);
        unknownKeys(asset, stage === 'built' ? ['logicalPath', 'mimeType', 'sizeBytes', 'contentHash'] : ['logicalPath', 'mimeType'], path);
        if (!isCanonicalPath(asset.logicalPath, 'assets/')) {
          fail(`${path}.logicalPath`, `${path}.logicalPath must be a clean path under assets/ (no "..", ".", "\\", "%" or empty parts; at most 256 characters).`);
        } else if (declared.has(asset.logicalPath)) {
          fail(`${path}.logicalPath`, `The asset "${asset.logicalPath}" is declared twice.`);
        } else declared.add(asset.logicalPath);
        if ('mimeType' in asset && asset.mimeType !== null && typeof asset.mimeType !== 'string') {
          fail(`${path}.mimeType`, `${path}.mimeType must be text, like "image/png".`);
        }
        if (stage === 'built') {
          if (!(isInt(asset.sizeBytes) && asset.sizeBytes >= 0)) fail(`${path}.sizeBytes`, `${path}.sizeBytes must be a whole number.`);
          if (!(typeof asset.contentHash === 'string' && HASH.test(asset.contentHash))) fail(`${path}.contentHash`, `${path}.contentHash must be a SHA-256 hex digest.`);
        }
      });
    }
  }
  if ('cover' in manifest) {
    const cover = manifest.cover;
    if (!isObject(cover)) fail('cover', 'cover must be an object.');
    else {
      unknownKeys(cover, ['pattern', 'tone', 'src'], 'cover');
      for (const field of ['pattern', 'tone']) if (field in cover) text(cover[field], `cover.${field}`, 0, 64);
      if ('src' in cover && typeof cover.src !== 'string') fail('cover.src', 'cover.src must be text.');
      if (typeof cover.src === 'string' && !declared.has(cover.src)) {
        fail('cover.src', `cover.src "${cover.src}" must be one of the declared assets.`);
      }
    }
  }

  // Learning contribution (addon-learning-v1, section 9).
  const hasLearning = 'learning' in manifest;
  if (hasLearning) {
    try {
      validateLearningContribution(manifest.learning);
    } catch (error) {
      // The learning module reports "path: message"; keep the path.
      const text = String(error?.message ?? error);
      const at = text.indexOf(': ');
      fail(at > 0 ? text.slice(0, at) : 'learning', at > 0 ? text.slice(at + 2) : text);
    }
    if (kind !== 'experience') fail('learning', `Only an experience can have a learning contribution (this pack is a ${kind}).`);
    if (!has('knowledge:read')) fail('permissions', 'A learning contribution needs the "knowledge:read" permission.');
  }

  // Settings v1 (section 12).
  if ('settings' in manifest) validateSettings(manifest.settings, fail, text, unknownKeys);

  // Permission and binding rules.
  const consumesOrTransforms = mode === 'consumes' || mode === 'transforms';
  if (consumesOrTransforms && !has('knowledge:read')) {
    fail('permissions', `The "${mode}" binding needs the "knowledge:read" permission.`);
  }
  if (has('knowledge:read') && !consumesOrTransforms && !hasLearning) {
    fail('permissions', '"knowledge:read" is only allowed with the "consumes" or "transforms" binding, or a learning contribution. Remove it, or change the binding.');
  }
  const hasProduced = Array.isArray(produced) && produced.length > 0;
  if (hasProduced && !has('knowledge:unlock-authored')) {
    fail('permissions', 'producedKnowledge needs the "knowledge:unlock-authored" permission.');
  }
  if (has('knowledge:unlock-authored') && !hasProduced) {
    fail('permissions', '"knowledge:unlock-authored" needs a producedKnowledge table. Add one, or remove the permission.');
  }
  if ((hasProduced || has('knowledge:propose')) && mode !== 'produces' && mode !== 'transforms') {
    fail('knowledgeBinding.mode', `${hasProduced ? 'producedKnowledge' : 'The "knowledge:propose" permission'} needs the knowledge binding "produces" or "transforms".`);
  }
  if (Array.isArray(manifest.dataSources) && manifest.dataSources.length > 0 && !has('network')) {
    fail('permissions', 'dataSources needs the "network" permission.');
  }
  if (isObject(engines) && 'three' in engines && !has('render:3d')) {
    fail('permissions', 'engines.three needs the "render:3d" permission.');
  }

  // automation-template packs are data only.
  if (kind === 'automation-template') {
    if (permissions.length) fail('permissions', 'An automation-template pack is data only: it cannot request permissions.');
    if (isObject(surfaces) && Object.keys(surfaces).length) fail('surfaces', 'An automation-template pack is data only: surfaces must be {}.');
    if (mode !== undefined && mode !== 'none') fail('knowledgeBinding.mode', 'An automation-template pack must use the binding {"mode": "none"}.');
    if (!('automationTemplate' in manifest)) fail('automationTemplate', 'An automation-template pack needs an automationTemplate descriptor.');
    else validateAutomationTemplate(manifest.automationTemplate, fail, text, unknownKeys);
  } else if ('automationTemplate' in manifest) {
    fail('automationTemplate', 'Only an automation-template pack can have an automationTemplate descriptor.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

const SETTING_ID = /^[a-z][a-zA-Z0-9-]*$/;

function validateSettings(settings, fail, text, unknownKeys) {
  if (!Array.isArray(settings)) return fail('settings', 'settings must be a list of fields.');
  if (settings.length > 24) fail('settings', `An add-on can declare at most 24 settings (this one has ${settings.length}).`);
  const ids = new Set();
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  settings.forEach((field, i) => {
    const path = `settings[${i}]`;
    if (!field || typeof field !== 'object' || Array.isArray(field)) return fail(path, `${path} must be an object.`);
    if (text(field.id, `${path}.id`, 1, 64)) {
      if (!SETTING_ID.test(field.id)) fail(`${path}.id`, `Setting id "${field.id}" must start with a lowercase letter, then letters, digits or hyphens, like "showHints".`);
      if (ids.has(field.id)) fail(`${path}.id`, `Setting id "${field.id}" is used twice.`);
      ids.add(field.id);
    }
    text(field.label, `${path}.label`, 1, 80);
    if ('description' in field) text(field.description, `${path}.description`, 1, 240);
    const common = ['id', 'label', 'description', 'type'];
    switch (field.type) {
      case 'toggle':
        unknownKeys(field, [...common, 'default'], path);
        if (typeof field.default !== 'boolean') fail(`${path}.default`, 'A toggle needs a default of true or false.');
        break;
      case 'choice': {
        unknownKeys(field, [...common, 'options', 'default'], path);
        if (!Array.isArray(field.options) || field.options.length < 2 || field.options.length > 12) {
          fail(`${path}.options`, 'A choice needs 2 to 12 options.');
          break;
        }
        const values = new Set();
        field.options.forEach((option, j) => {
          const at = `${path}.options[${j}]`;
          if (!option || typeof option !== 'object' || Array.isArray(option)) return fail(at, `${at} must be {"value": "...", "label": "..."}.`);
          unknownKeys(option, ['value', 'label'], at);
          if (text(option.value, `${at}.value`, 1, 64)) {
            if (values.has(option.value)) fail(`${at}.value`, `The option value "${option.value}" is used twice.`);
            values.add(option.value);
          }
          text(option.label, `${at}.label`, 1, 80);
        });
        if (!values.has(field.default)) fail(`${path}.default`, 'The default must be one of the option values.');
        break;
      }
      case 'number': {
        unknownKeys(field, [...common, 'min', 'max', 'step', 'unit', 'default'], path);
        const bounds = finite(field.min) && finite(field.max);
        if (!bounds) fail(path, 'A number setting needs finite "min" and "max".');
        else if (!(field.max > field.min)) fail(`${path}.max`, '"max" must be greater than "min".');
        if ('step' in field && !(finite(field.step) && field.step > 0)) fail(`${path}.step`, '"step" must be a number greater than 0.');
        if ('unit' in field) text(field.unit, `${path}.unit`, 1, 16);
        if (!finite(field.default)) fail(`${path}.default`, 'A number setting needs a finite default.');
        else if (bounds && (field.default < field.min || field.default > field.max)) fail(`${path}.default`, 'The default must be between "min" and "max".');
        break;
      }
      case 'text': {
        unknownKeys(field, [...common, 'default', 'maxLength', 'placeholder'], path);
        if ('maxLength' in field && !(Number.isInteger(field.maxLength) && field.maxLength >= 1 && field.maxLength <= 2000)) {
          fail(`${path}.maxLength`, '"maxLength" must be a whole number from 1 to 2000.');
        }
        if ('placeholder' in field) text(field.placeholder, `${path}.placeholder`, 1, 120);
        if ('default' in field && text(field.default, `${path}.default`, 0, 2000)) {
          const limit = Number.isInteger(field.maxLength) ? field.maxLength : 500;
          if (field.default.length > limit) fail(`${path}.default`, `The default is longer than maxLength (${limit}).`);
        }
        break;
      }
      default:
        fail(`${path}.type`, `${path}.type must be one of: ${SETTING_TYPES.join(', ')}. (There is no secret type: put keys in a data source with auth "user".)`);
    }
  });
}

const DATA_SOURCE_CATEGORIES = ['reference', 'language', 'papers', 'books', 'science', 'world-data', 'news', 'health', 'environment'];

function isUrl(value, { https = false } = {}) {
  try {
    const url = new URL(value);
    return https ? url.protocol === 'https:' : true;
  } catch { return false; }
}

/** A {string: text} map whose values are 1 to `max` characters. */
function textMap(value, path, max, fail, text) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, `${path} must be an object of text values.`);
  for (const [key, entry] of Object.entries(value)) text(entry, `${path}.${key}`, 1, max);
}

function validateDataSources(sources, fail, text, integer, unknownKeys) {
  if (!Array.isArray(sources)) return fail('dataSources', 'dataSources must be a list.');
  if (sources.length > 6) fail('dataSources', `dataSources can hold at most 6 entries (it has ${sources.length}).`);
  const ids = new Set();
  sources.forEach((source, i) => {
    const path = `dataSources[${i}]`;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return fail(path, `${path} must be an object.`);
    unknownKeys(source, ['id', 'name', 'description', 'category', 'docsUrl', 'keySignupUrl', 'sharedKey', 'auth', 'baseUrl',
      'rateLimitPerMinute', 'testParams', 'ops'], path);
    if (text(source.id, `${path}.id`, 1, 64)) {
      if (!KEBAB.test(source.id)) fail(`${path}.id`, `${path}.id must be kebab-case, like "open-library".`);
      if (ids.has(source.id)) fail(`${path}.id`, `The data source id "${source.id}" is used twice.`);
      ids.add(source.id);
    }
    text(source.name, `${path}.name`, 1, 120);
    text(source.description, `${path}.description`, 1, 500);
    if (!DATA_SOURCE_CATEGORIES.includes(source.category)) fail(`${path}.category`, `${path}.category must be one of: ${DATA_SOURCE_CATEGORIES.join(', ')}.`);
    for (const field of ['docsUrl', 'keySignupUrl']) {
      if (field in source && text(source[field], `${path}.${field}`, 1, 512) && !isUrl(source[field])) fail(`${path}.${field}`, `${path}.${field} must be a URL.`);
    }
    if ('sharedKey' in source) text(source.sharedKey, `${path}.sharedKey`, 1, 512);
    if (!['none', 'user', 'addon-shared'].includes(source.auth)) fail(`${path}.auth`, `${path}.auth must be "none", "user" or "addon-shared".`);
    if (source.auth === 'addon-shared' && !('sharedKey' in source)) fail(`${path}.sharedKey`, 'auth "addon-shared" needs a sharedKey.');
    if (source.auth === 'user' && !('keySignupUrl' in source)) fail(`${path}.keySignupUrl`, 'auth "user" needs a keySignupUrl, so users know where to get a key.');
    if (text(source.baseUrl, `${path}.baseUrl`, 1, 512) && !isUrl(source.baseUrl, { https: true })) fail(`${path}.baseUrl`, `${path}.baseUrl must be an https:// URL.`);
    integer(source.rateLimitPerMinute, `${path}.rateLimitPerMinute`, 1, 30);
    if ('testParams' in source) textMap(source.testParams, `${path}.testParams`, 256, fail, text);
    if (!Array.isArray(source.ops) || source.ops.length < 1 || source.ops.length > 6) return fail(`${path}.ops`, `${path}.ops must be a list of 1 to 6 operations.`);
    const opIds = new Set();
    source.ops.forEach((op, j) => {
      const opPath = `${path}.ops[${j}]`;
      if (!op || typeof op !== 'object' || Array.isArray(op)) return fail(opPath, `${opPath} must be an object.`);
      unknownKeys(op, ['id', 'label', 'cacheTtlMs', 'pick', 'request'], opPath);
      if (text(op.id, `${opPath}.id`, 1, 64)) {
        if (!KEBAB.test(op.id)) fail(`${opPath}.id`, `${opPath}.id must be kebab-case, like "search".`);
        if (opIds.has(op.id)) fail(`${opPath}.id`, `The operation id "${op.id}" is used twice in this data source.`);
        opIds.add(op.id);
      }
      text(op.label, `${opPath}.label`, 1, 120);
      integer(op.cacheTtlMs, `${opPath}.cacheTtlMs`, 1, 2_592_000_000);
      if ('pick' in op) text(op.pick, `${opPath}.pick`, 1, 200);
      const request = op.request;
      const reqPath = `${opPath}.request`;
      if (!request || typeof request !== 'object' || Array.isArray(request)) return fail(reqPath, `${reqPath} must be an object.`);
      unknownKeys(request, ['method', 'path', 'query', 'headers', 'body'], reqPath);
      if (request.method !== 'GET' && request.method !== 'POST') fail(`${reqPath}.method`, `${reqPath}.method must be "GET" or "POST".`);
      if (text(request.path, `${reqPath}.path`, 1, 512) && !request.path.startsWith('/')) fail(`${reqPath}.path`, `${reqPath}.path must start with "/".`);
      if ('query' in request) textMap(request.query, `${reqPath}.query`, 512, fail, text);
      if ('headers' in request) textMap(request.headers, `${reqPath}.headers`, 512, fail, text);
      if ('body' in request) text(request.body, `${reqPath}.body`, 1, 8192);
      if (request.method === 'POST' && !('body' in request)) fail(`${reqPath}.body`, 'A POST request needs a body.');
      if (request.method !== 'POST' && 'body' in request) fail(`${reqPath}.body`, 'Only a POST request may have a body.');
    });
  });
}

function validateAutomationTemplate(template, fail, text, unknownKeys) {
  const base = 'automationTemplate';
  if (!template || typeof template !== 'object' || Array.isArray(template)) return fail(base, `${base} must be an object.`);
  unknownKeys(template, ['downloadUrl', 'platform', 'institution', 'summary', 'domains', 'beforeUse'], base);
  if (text(template.downloadUrl, `${base}.downloadUrl`, 1, 2048)) {
    let ok = /^\/addons\/automation\/[a-z0-9]+(?:-[a-z0-9]+)*\.mnxautomation\.json$/.test(template.downloadUrl);
    if (!ok) {
      try {
        const url = new URL(template.downloadUrl);
        ok = url.protocol === 'https:' && !url.username && !url.password;
      } catch { ok = false; }
    }
    if (!ok) fail(`${base}.downloadUrl`, `${base}.downloadUrl must be an https:// URL without a username or password, or /addons/automation/<name>.mnxautomation.json.`);
  }
  text(template.platform, `${base}.platform`, 1, 80);
  if ('institution' in template) text(template.institution, `${base}.institution`, 0, 120);
  if (!Array.isArray(template.summary) || template.summary.length < 1 || template.summary.length > 12) {
    fail(`${base}.summary`, `${base}.summary must be a list of 1 to 12 lines.`);
  } else template.summary.forEach((line, i) => text(line, `${base}.summary[${i}]`, 1, 180));
  if (!Array.isArray(template.domains) || template.domains.length > 24) {
    fail(`${base}.domains`, `${base}.domains must be a list of at most 24 domains.`);
  } else template.domains.forEach((domain, i) => {
    if (typeof domain !== 'string' || !/^[a-z0-9.-]+$/.test(domain)) fail(`${base}.domains[${i}]`, `${base}.domains[${i}] must be a domain like "example.edu" (a-z, 0-9, "." and "-").`);
  });
  text(template.beforeUse, `${base}.beforeUse`, 1, 500);
}

function validateStudy(study, fail, text, integer, unknownKeys) {
  const base = 'surfaces.study';
  if (!study || typeof study !== 'object' || Array.isArray(study)) return fail(base, `${base} must be an object.`);
  unknownKeys(study, ['version', 'tasks'], base);
  if (study.version !== 1) fail(`${base}.version`, `${base}.version must be 1.`);
  if (!Array.isArray(study.tasks)) return fail(`${base}.tasks`, `${base}.tasks must be a list of 1 to 32 tasks.`);
  if (study.tasks.length < 1 || study.tasks.length > 32) {
    fail(`${base}.tasks`, `${base}.tasks must hold 1 to 32 tasks (it has ${study.tasks.length}).`);
  }
  const ids = new Set();
  study.tasks.forEach((task, i) => {
    const path = `${base}.tasks[${i}]`;
    if (!task || typeof task !== 'object' || Array.isArray(task)) return fail(path, `${path} must be an object.`);
    unknownKeys(task, ['id', 'label', 'schema', 'matchAny', 'maxSeconds'], path);
    if (text(task.id, `${path}.id`, 1, Infinity)) {
      if (!KEBAB.test(task.id)) fail(`${path}.id`, `Task id "${task.id}" must be kebab-case, like "sn2-backside".`);
      if (ids.has(task.id)) fail(`${path}.id`, `Task id "${task.id}" is used twice. Task ids must be unique.`);
      ids.add(task.id);
    }
    text(task.label, `${path}.label`, 1, 120);
    text(task.schema, `${path}.schema`, 1, 120);
    if (!Array.isArray(task.matchAny) || task.matchAny.length < 1 || task.matchAny.length > 16) {
      fail(`${path}.matchAny`, `${path}.matchAny must be a list of 1 to 16 phrases.`);
    } else {
      task.matchAny.forEach((phrase, j) => text(phrase, `${path}.matchAny[${j}]`, 2, 100));
    }
    integer(task.maxSeconds, `${path}.maxSeconds`, 1, 1800);
  });
}

function validateCompatRule(rule, path, depth, fail, text) {
  if (depth > 10) return fail(path, 'The compatRule tree is more than 10 levels deep.');
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return fail(path, `${path} must be an object.`);
  const kind = rule.kind;
  const allowed = { kind: 1, whenTrue: 1, whenFalse: 1 };
  text(rule.whenTrue, `${path}.whenTrue`, 1, 240, `${path}.whenTrue (the reason shown when the rule matches)`);
  text(rule.whenFalse, `${path}.whenFalse`, 1, 240, `${path}.whenFalse (the reason shown when it does not)`);
  if (!COMPAT_LEAVES.includes(kind) && !COMPAT_COMBINATORS.includes(kind)) {
    return fail(`${path}.kind`, `${path}.kind must be one of: ${[...COMPAT_LEAVES, ...COMPAT_COMBINATORS].join(', ')}.`);
  }
  if (kind === 'minTextLength' || kind === 'minStructuredItems') {
    allowed.value = 1;
    if (!(Number.isInteger(rule.value) && rule.value >= 0)) fail(`${path}.value`, `${path}.value must be a whole number.`);
  } else if (kind === 'hasMedia') {
    allowed.value = 1;
    if (typeof rule.value !== 'boolean') fail(`${path}.value`, `${path}.value must be true or false.`);
  } else if (COMPAT_LIST_LEAVES.includes(kind)) {
    allowed.values = 1;
    if (!Array.isArray(rule.values) || rule.values.length < 1 || rule.values.length > 64) {
      fail(`${path}.values`, `${path}.values must be a list of 1 to 64 strings.`);
    } else rule.values.forEach((value, i) => { if (typeof value !== 'string') fail(`${path}.values[${i}]`, `${path}.values[${i}] must be text.`); });
  } else if (kind === 'allOf' || kind === 'anyOf') {
    allowed.rules = 1;
    if (!Array.isArray(rule.rules) || rule.rules.length < 1 || rule.rules.length > 16) {
      fail(`${path}.rules`, `${path}.rules must be a list of 1 to 16 rules.`);
    } else rule.rules.forEach((child, i) => validateCompatRule(child, `${path}.rules[${i}]`, depth + 1, fail, text));
  } else if (kind === 'not') {
    allowed.rule = 1;
    if (!('rule' in rule)) fail(`${path}.rule`, `${path} needs a "rule" to negate.`);
    else validateCompatRule(rule.rule, `${path}.rule`, depth + 1, fail, text);
  }
  for (const key of Object.keys(rule)) {
    if (!(key in allowed)) fail(`${path}.${key}`, `"${key}" is not a field of a ${kind} rule.`);
  }
}

/** One line per problem, for printing. */
export function formatManifestProblems({ errors, warnings }) {
  return [
    ...errors.map(problem => `error   ${problem.path || '(manifest)'}: ${problem.message}`),
    ...warnings.map(problem => `warning ${problem.path || '(manifest)'}: ${problem.message}`),
  ].join('\n');
}

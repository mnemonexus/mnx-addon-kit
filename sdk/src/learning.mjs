import { getExperienceHost } from './index.mjs';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);
const KEYWORDS = new Set(['type', 'properties', 'required', 'items', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'additionalProperties']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function fail(path, message) { throw new Error(`${path}: ${message}`); }
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'use a JSON object.');
}
function keys(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'this field is not supported. Check its spelling.');
}
function string(value, path, max = 2048) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(path, `use a non-empty string of at most ${max} characters.`);
}
function id(value, path) { string(value, path, 64); if (!ID.test(value)) fail(path, 'use lowercase words separated by hyphens.'); }
function number(value, path, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path, `use ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`);
}
function array(value, path, max = 128) { if (!Array.isArray(value) || value.length > max) fail(path, `use an array with at most ${max} entries.`); }
function json(value, path, depth = 0, seen = new Set()) {
  if (depth > 24) fail(path, 'the data is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(path, 'use a finite number.'); return; }
  if (!value || typeof value !== 'object' || seen.has(value)) fail(path, 'use JSON data without functions, undefined values or cycles.');
  if (!Array.isArray(value)) object(value, path);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) json(child, `${path}.${key}`, depth + 1, seen);
  seen.delete(value);
}
function copy(value, path) {
  json(value, path);
  const encoded = JSON.stringify(value);
  if (encoded.length > 262144) fail(path, 'keep this data below 256 KiB.');
  return JSON.parse(encoded);
}

function checkSchema(schema, path, depth = 0, budget = { count: 0 }) {
  if (depth > 12 || ++budget.count > 512) fail(path, 'keep schemas small: at most 12 levels and 512 definitions.');
  object(schema, path);
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) fail(`${path}.${key}`, 'unsupported schema keyword. Use the documented JSON Schema subset.');
  if (!TYPES.has(schema.type)) fail(`${path}.type`, 'choose object, array, string, number, integer or boolean.');
  if (schema.enum !== undefined) {
    array(schema.enum, `${path}.enum`, 128);
    if (!schema.enum.length) fail(`${path}.enum`, 'include at least one allowed value.');
    schema.enum.forEach((value, index) => json(value, `${path}.enum[${index}]`));
  }
  for (const key of ['minimum', 'maximum']) if (schema[key] !== undefined) {
    if (!['number', 'integer'].includes(schema.type)) fail(`${path}.${key}`, 'this keyword requires a number or integer schema.');
    number(schema[key], `${path}.${key}`, -Number.MAX_VALUE, Number.MAX_VALUE);
  }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (schema[key] !== undefined) {
    if (schema.type !== (key.endsWith('Length') ? 'string' : 'array')) fail(`${path}.${key}`, 'this keyword does not match the schema type.');
    number(schema[key], `${path}.${key}`, 0, 262144, true);
  }
  for (const [lower, upper] of [['minimum', 'maximum'], ['minLength', 'maxLength'], ['minItems', 'maxItems']]) {
    if (schema[lower] !== undefined && schema[upper] !== undefined && schema[lower] > schema[upper]) fail(path, `${lower} cannot exceed ${upper}.`);
  }
  if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) {
    if (schema.type !== 'object') fail(path, 'properties, required and additionalProperties require type object.');
    const props = schema.properties ?? {};
    object(props, `${path}.properties`);
    if (Object.keys(props).length > 128) fail(`${path}.properties`, 'declare at most 128 properties.');
    for (const [key, child] of Object.entries(props)) {
      string(key, `${path}.properties key`, 128);
      checkSchema(child, `${path}.properties.${key}`, depth + 1, budget);
    }
    if (schema.required !== undefined) {
      array(schema.required, `${path}.required`);
      for (const key of schema.required) if (typeof key !== 'string' || !own(props, key)) fail(`${path}.required`, 'each required field must be declared in properties.');
      if (new Set(schema.required).size !== schema.required.length) fail(`${path}.required`, 'list each field once.');
    }
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) fail(`${path}.additionalProperties`, 'only false is supported. Omit it to allow extra JSON fields.');
  }
  if (schema.items !== undefined) {
    if (schema.type !== 'array') fail(`${path}.items`, 'items requires type array.');
    checkSchema(schema.items, `${path}.items`, depth + 1, budget);
  }
  if (schema.type === 'array' && !schema.items) fail(`${path}.items`, 'declare the schema for each array entry.');
}

function checkPayload(value, schema, path) {
  const valid = schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : schema.type === 'array' ? Array.isArray(value)
    : schema.type === 'integer' ? Number.isInteger(value)
    : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : typeof value === schema.type;
  if (!valid) fail(path, `expected ${schema.type}.`);
  if (schema.enum && !schema.enum.some(entry => JSON.stringify(entry) === JSON.stringify(value))) fail(path, 'choose one of the values listed in enum.');
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) if (!own(value, key)) fail(`${path}.${key}`, 'this required field is missing.');
    for (const [key, child] of Object.entries(value)) {
      if (own(schema.properties ?? {}, key)) checkPayload(child, schema.properties[key], `${path}.${key}`);
      else if (schema.additionalProperties === false) fail(`${path}.${key}`, 'this field is not declared by the payload schema.');
    }
  } else if (schema.type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail(path, 'the number of entries is outside the schema limits.');
    value.forEach((child, index) => checkPayload(child, schema.items, `${path}[${index}]`));
  } else if (schema.type === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) fail(path, 'the text length is outside the schema limits.');
  } else if (['number', 'integer'].includes(schema.type)) {
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail(path, 'the number is outside the schema limits.');
  }
}

/** Validate the public contribution at both packing and installation. */
export function validateLearningContribution(value) {
  const contribution = copy(value, 'learning');
  keys(contribution, ['version', 'schemas', 'activities'], 'learning');
  if (contribution.version !== 1) fail('learning.version', 'this host supports version 1.');
  object(contribution.schemas, 'learning.schemas');
  if (Object.keys(contribution.schemas).length > 16) fail('learning.schemas', 'register at most 16 schemas.');
  for (const [schemaId, schema] of Object.entries(contribution.schemas)) { id(schemaId, 'learning schema ID'); checkSchema(schema, `learning.schemas.${schemaId}`); }
  array(contribution.activities, 'learning.activities', 32);
  const ids = new Set();
  for (const [index, activity] of contribution.activities.entries()) {
    const path = `learning.activities[${index}]`;
    keys(activity, ['id', 'label', 'payloadSchema', 'maxSeconds', 'surfaces'], path);
    id(activity.id, `${path}.id`); string(activity.label, `${path}.label`, 120);
    if (ids.has(activity.id)) fail(`${path}.id`, 'each activity ID must be unique.');
    ids.add(activity.id);
    id(activity.payloadSchema, `${path}.payloadSchema`);
    if (!own(contribution.schemas, activity.payloadSchema)) fail(`${path}.payloadSchema`, 'register this schema in learning.schemas first.');
    number(activity.maxSeconds, `${path}.maxSeconds`, 1, 1800, true);
    array(activity.surfaces, `${path}.surfaces`, 2);
    if (!activity.surfaces.length || activity.surfaces.some(surface => !['study', 'recall'].includes(surface)) || new Set(activity.surfaces).size !== activity.surfaces.length) fail(`${path}.surfaces`, 'list study, recall or both, without duplicates.');
  }
  return contribution;
}

function references(value, allowed, path) {
  array(value, path);
  for (const ref of value) { string(ref, path); if (!allowed.has(ref)) fail(path, `reference "${ref}" was not supplied in this source context.`); }
  if (new Set(value).size !== value.length) fail(path, 'list each reference once.');
}

/** Refuse fabricated references, undeclared activities and malformed payloads. */
export function validatePreparation(value, contributionValue, source) {
  const contribution = validateLearningContribution(contributionValue);
  const preparation = copy(value, 'preparation');
  keys(preparation, ['attachments', 'offers'], 'preparation');
  array(preparation.attachments, 'preparation.attachments'); array(preparation.offers, 'preparation.offers', 64);
  if (!source || !Array.isArray(source.sourceRefs) || !Array.isArray(source.knowledge)) fail('source', 'supply the host source context.');
  const sourceRefs = new Set(source.sourceRefs);
  const knowledgeRefs = new Set(source.knowledge.flatMap(item => [item.lineageId, item.itemId, item.conceptId]).filter(ref => typeof ref === 'string' && ref));
  for (const [kind, entries] of [['attachments', preparation.attachments], ['offers', preparation.offers]]) {
    const ids = new Set();
    for (const [index, entry] of entries.entries()) {
      const path = `preparation.${kind}[${index}]`;
      keys(entry, kind === 'attachments' ? ['id', 'schemaId', 'payload', 'sourceRefs', 'knowledgeRefs'] : ['id', 'activityId', 'label', 'payload', 'sourceRefs', 'knowledgeRefs', 'prerequisiteIds', 'estimatedSeconds', 'contentKind'], path);
      id(entry.id, `${path}.id`);
      if (ids.has(entry.id)) fail(`${path}.id`, 'use a unique ID within this preparation.');
      ids.add(entry.id);
      references(entry.sourceRefs, sourceRefs, `${path}.sourceRefs`); references(entry.knowledgeRefs, knowledgeRefs, `${path}.knowledgeRefs`);
      if (!entry.sourceRefs.length && !entry.knowledgeRefs.length) fail(path, 'link this contribution to at least one supplied source or knowledge item.');
      let schemaId;
      if (kind === 'attachments') { id(entry.schemaId, `${path}.schemaId`); schemaId = entry.schemaId; }
      else {
        id(entry.activityId, `${path}.activityId`);
        const declaration = contribution.activities.find(activity => activity.id === entry.activityId);
        if (!declaration) fail(`${path}.activityId`, 'declare this activity in learning.activities first.');
        schemaId = declaration.payloadSchema;
        string(entry.label, `${path}.label`, 120);
        number(entry.estimatedSeconds, `${path}.estimatedSeconds`, 1, declaration.maxSeconds, true);
        references(entry.prerequisiteIds, knowledgeRefs, `${path}.prerequisiteIds`);
        if (!['source-task', 'concept-example'].includes(entry.contentKind)) fail(`${path}.contentKind`, 'choose source-task or concept-example.');
        if (entry.contentKind === 'source-task' && !entry.sourceRefs.length) fail(`${path}.sourceRefs`, 'a source-task must link to its supplied source.');
      }
      if (!own(contribution.schemas, schemaId)) fail(`${path}.schemaId`, 'register this schema in learning.schemas first.');
      if (!own(entry, 'payload')) fail(`${path}.payload`, 'include the task data.');
      checkPayload(entry.payload, contribution.schemas[schemaId], `${path}.payload`);
    }
  }
  return preparation;
}

/** One entry point for preparation jobs, specific tasks and standalone use. */
export async function defineAddon(options, scope = globalThis) {
  const host = scope.mnx;
  if (host?.props?.kind === 'addon-job') {
    if (host.protocolVersion !== 1 || !host.capabilities?.includes('addon-learning-v1') || typeof host.complete !== 'function' || typeof host.props.extensionId !== 'string' || !Array.isArray(host.props.permissions) || !Array.isArray(host.props.attachments) || !host.props.source) fail('host', 'launch this preparation through a compatible addon-learning-v1 host.');
    const contribution = validateLearningContribution(options.learning);
    const attachments = options.extract ? await options.extract(host.props.source, host) : host.props.attachments;
    const checkedAttachments = validatePreparation({ attachments, offers: [] }, contribution, host.props.source).attachments;
    const offers = options.offerActivities ? await options.offerActivities({ source: host.props.source, attachments: checkedAttachments }, host) : [];
    const preparation = validatePreparation({ attachments: checkedAttachments, offers }, contribution, host.props.source);
    host.complete({ completed: true, elapsedSeconds: 0, learningPreparation: preparation });
    return preparation;
  }
  const experience = getExperienceHost(scope);
  if (experience.props.learningActivity) {
    if (!experience.capabilities?.includes('addon-learning-v1')) fail('host', 'this activity needs the addon-learning-v1 capability.');
    const { offer, source } = experience.props.learningActivity;
    validatePreparation({ attachments: [], offers: [offer] }, options.learning, source);
    const declared = options.learning.activities.find(activity => activity.id === offer.activityId);
    if (!declared.surfaces.includes(experience.props.surface)) fail('host.surface', 'the selected activity does not support this surface.');
    if (typeof options.renderActivity !== 'function') fail('renderActivity', 'add a function that displays the selected task.');
    return options.renderActivity(experience);
  }
  if (typeof options.renderStandalone === 'function') return options.renderStandalone(experience);
  fail('renderStandalone', 'add a standalone view or launch a specific learning activity.');
}

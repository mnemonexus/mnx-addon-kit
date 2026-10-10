/**
 * Resolve settings-v1 values from user settings and declared defaults.
 * Each declared field is present; text is capped at maxLength (default 500).
 * An add-on without settings receives {}.
 */
export function resolveSettings(declared, values = {}) {
  const result = {};
  for (const field of Array.isArray(declared) ? declared : []) {
    const value = values && Object.prototype.hasOwnProperty.call(values, field.id) ? values[field.id] : undefined;
    result[field.id] = resolveOne(field, value);
  }
  return result;
}

function resolveOne(field, value) {
  switch (field.type) {
    case 'toggle':
      return typeof value === 'boolean' ? value : field.default;
    case 'choice':
      return field.options.some(option => option.value === value) ? value : field.default;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max ? value : field.default;
    case 'text': {
      const limit = Number.isInteger(field.maxLength) ? field.maxLength : 500;
      const text = typeof value === 'string' ? value : field.default ?? '';
      return text.slice(0, limit);
    }
    default:
      return value;
  }
}

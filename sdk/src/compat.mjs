/** Evaluate compatRule for one knowledge item, returning { pass, reason }.
 * The host applies the same rule on every launch surface (contract section 7). */

const MAX_DEPTH = 10;
// The six "…In" leaves match when ANY of the item's values is in `values`.
// practiceModeIn and tagIn read the item's lists; the others read one field.
const IN_FIELDS = {
  descriptorTypeIn: 'descriptorType', descriptorStructureIn: 'descriptorStructure', conceptKindIn: 'conceptKind',
  disciplineIn: 'discipline', practiceModeIn: 'practiceModes', tagIn: 'tags',
};

function verdict(rule, pass) {
  return { pass, reason: String(pass ? rule?.whenTrue ?? '' : rule?.whenFalse ?? '') };
}

export function evaluateCompatRule(rule, item, depth = 1) {
  // Nesting deeper than 10, or an unknown kind, makes the item incompatible.
  if (depth > MAX_DEPTH || !rule || typeof rule !== 'object') return verdict(rule, false);
  switch (rule.kind) {
    case 'always': return verdict(rule, true);
    case 'hasConcept': return verdict(rule, typeof item.conceptId === 'string' && item.conceptId.length > 0);
    case 'minTextLength': return verdict(rule, String(item.text ?? '').trim().length >= rule.value);
    case 'minStructuredItems': return verdict(rule, (item.structuredItems ?? []).length >= rule.value);
    case 'hasMedia': return verdict(rule, item.hasMedia === rule.value);
    case 'descriptorTypeIn': case 'descriptorStructureIn': case 'conceptKindIn':
    case 'disciplineIn': case 'practiceModeIn': case 'tagIn': {
      const value = item[IN_FIELDS[rule.kind]];
      const mine = Array.isArray(value) ? value : [value];
      const wanted = Array.isArray(rule.values) ? rule.values : [];
      return verdict(rule, mine.some(entry => wanted.includes(entry)));
    }
    case 'allOf': {
      // Passes when every child passes; reports the first failure.
      for (const child of rule.rules ?? []) {
        const result = evaluateCompatRule(child, item, depth + 1);
        if (!result.pass) return result;
      }
      return verdict(rule, true);
    }
    case 'anyOf': {
      // Passes when any child passes; reports the first pass.
      for (const child of rule.rules ?? []) {
        const result = evaluateCompatRule(child, item, depth + 1);
        if (result.pass) return result;
      }
      return verdict(rule, false);
    }
    case 'not':
      return verdict(rule, !evaluateCompatRule(rule.rule, item, depth + 1).pass);
    default:
      return verdict(rule, false);
  }
}

/**
 * The items an add-on is given: `[]` for a `none` or `produces` binding;
 * otherwise those that pass the compatRule, capped at
 * `surfaces.transferal.maxItems` when that is declared.
 */
export function selectItems(manifest, items) {
  const binding = manifest?.knowledgeBinding;
  if (binding?.mode !== 'consumes' && binding?.mode !== 'transforms') return { items: [], rejected: [] };
  const kept = [];
  const rejected = [];
  for (const item of items) {
    const result = evaluateCompatRule(binding.compatRule, item);
    if (result.pass) kept.push(item);
    else rejected.push({ item, reason: result.reason });
  }
  const cap = manifest?.surfaces?.transferal?.maxItems;
  return { items: Number.isInteger(cap) ? kept.slice(0, cap) : kept, rejected, capped: Number.isInteger(cap) && kept.length > cap ? cap : undefined };
}

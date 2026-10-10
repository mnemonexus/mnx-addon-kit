/** Offer ordering tasks only for explicitly stated source sequences.
 * An unordered list or array position is insufficient evidence of an order. */
import type { ActivityOffer, KnowledgeAttachment, SourceContext } from '@mnemonexus/addon-sdk/learning';

const MIN_STEPS = 3;
const MAX_STEPS = 12;

/** Sequence knowledge first; otherwise one contiguous numbered list in the text. */
export function extractSequences(source: SourceContext): KnowledgeAttachment[] {
  const sequences = source.knowledge.filter(item => item.descriptorStructure === 'sequence' &&
    Array.isArray(item.structuredItems) && item.structuredItems.length >= MIN_STEPS && item.structuredItems.length <= MAX_STEPS &&
    item.structuredItems.every(step => typeof step === 'string' && step.trim() && step.length <= 2000));
  const attachments = sequences.slice(0, 8).map((item, index) => ({
    id: `sequence-${index + 1}`, schemaId: 'sequence-v1', payload: { steps: [...item.structuredItems], targetId: item.lineageId },
    sourceRefs: source.sourceRefs.slice(0, 1), knowledgeRefs: [item.lineageId],
  }));
  if (attachments.length) return attachments;
  // Contiguous numbering explicitly supplies order; prose, unordered bullets,
  // missing numbers, multiple lists and uncertain long lists yield no task.
  const numbered = [...source.text.matchAll(/^\s*(\d+)[.)]\s+([^\r\n]+)$/gm)];
  if (numbered.length < MIN_STEPS || numbered.length > MAX_STEPS || !source.sourceRefs.length ||
      numbered.some((match, index) => Number(match[1]) !== index + 1 || match[2].trim().length > 2000)) return [];
  return [{
    id: 'source-sequence', schemaId: 'sequence-v1',
    payload: { steps: numbered.map(match => match[2].trim()), targetId: source.subsectionId },
    sourceRefs: source.sourceRefs.slice(0, 1), knowledgeRefs: [],
  }];
}

export function offerSequences({ attachments }: { attachments: KnowledgeAttachment[] }): ActivityOffer[] {
  return attachments.map((attachment, index) => ({
    id: `order-sequence-${index + 1}`, activityId: 'order-process', label: 'Put these process steps in order', payload: attachment.payload,
    sourceRefs: attachment.sourceRefs, knowledgeRefs: attachment.knowledgeRefs, prerequisiteIds: [],
    estimatedSeconds: Math.min(300, (attachment.payload as { steps: string[] }).steps.length * 20), contentKind: 'source-task',
  }));
}

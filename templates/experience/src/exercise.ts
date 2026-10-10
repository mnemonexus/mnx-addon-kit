/** Question content and draft identity, independent of the UI lifecycle. */
import type { KnowledgeItem } from '@mnemonexus/addon-sdk';

export interface Choice { id: string; label: string }
export interface Question { id: string; prompt: string; choices: Choice[]; answer: string; hint: string; lineageId?: string }
export interface Exercise { title: string; intro: string; questions: Question[] }

/** The shape of assets/tasks.json: reviewed exercises keyed by study task id. */
export interface TaskFile { tasks: Record<string, Exercise>; sample: Exercise }

/**
 * Read the reviewed content shipped in the pack. Assets arrive as raw bytes
 * through mnx.asset(), because the sandbox has no network and no file access.
 */
export async function loadTasks(asset: (path: string) => Promise<ArrayBuffer>): Promise<TaskFile> {
  const bytes = await asset('assets/tasks.json');
  return JSON.parse(new TextDecoder().decode(bytes)) as TaskFile;
}

/**
 * Build concept questions from supplied items. Requires at least two concepts
 * and uses only common fields, without assuming descriptor vocabulary.
 */
export function questionsFromItems(items: readonly KnowledgeItem[], limit = 8): Question[] {
  const concepts = new Map<string, string>();
  for (const item of items) if (item.conceptTitle) concepts.set(item.conceptId, item.conceptTitle);
  if (concepts.size < 2) return [];
  const usable = items.filter(item => item.text.trim() && concepts.has(item.conceptId)).slice(0, limit);
  return usable.map(item => {
    // Keep choices in a stable order so saved drafts can resume.
    const others = [...concepts].filter(([id]) => id !== item.conceptId).slice(0, 3);
    const choices = [[item.conceptId, concepts.get(item.conceptId)!], ...others]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const title = concepts.get(item.conceptId)!;
    return {
      id: item.itemId,
      lineageId: item.lineageId,
      prompt: item.text,
      choices,
      answer: item.conceptId,
      hint: `The answer starts with "${title.charAt(0)}".`,
    };
  });
}

/** A short, stable fingerprint of a question list, for naming a draft. */
export function exerciseKey(questions: readonly Question[]): string {
  let hash = 5381;
  for (const char of questions.map(q => q.id).join('|')) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

/**
 * Build props.study using scenario data (contract section 6).
 * Mock fingerprints hash available IDs rather than a lecture document.
 * Add-ons must treat run IDs and fingerprints as opaque.
 */
export interface StudyInputs {
  extensionId: string;
  addonVersion: string;
  taskId: string;
  taskSchema: string;
  workspaceId: string;
  lectureId: string;
  lectureTitle: string;
  subsectionId: string;
  subsectionTitle: string;
  depth: 'core' | 'standard' | 'deep';
  section?: { objective: string; text: string };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function contextFingerprint(input: Pick<StudyInputs, 'lectureId' | 'subsectionId' | 'depth' | 'addonVersion' | 'taskId'>) {
  return sha256Hex(JSON.stringify([input.lectureId, input.subsectionId, input.depth, input.addonVersion, input.taskId]));
}

export async function buildStudyContext(input: StudyInputs) {
  const fingerprint = await contextFingerprint(input);
  return {
    version: 1 as const,
    runId: `${input.extensionId}:${input.taskId}:${fingerprint}`,
    workspaceId: input.workspaceId,
    lectureId: input.lectureId,
    lectureTitle: input.lectureTitle,
    subsectionId: input.subsectionId,
    subsectionTitle: input.subsectionTitle,
    contextFingerprint: fingerprint,
    depth: input.depth,
    taskId: input.taskId,
    taskSchema: input.taskSchema,
    ...(input.section ? { section: input.section } : {}),
  };
}

/**
 * The durable storage scope for a study run: the extension id plus
 * (workspaceId, study.runId, study.contextFingerprint).
 */
export function studyStorageScope(extensionId: string, study: { workspaceId: string; runId: string; contextFingerprint: string }) {
  return JSON.stringify([extensionId, study.workspaceId, study.runId, study.contextFingerprint]);
}

/**
 * Whether a task would be "Suggested" for a subsection: any matchAny phrase
 * appears as whole words in the title, objective or text, case-insensitive,
 * with punctuation counted as spaces.
 */
export function isSuggested(matchAny: readonly string[], ...texts: string[]) {
  const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = ` ${texts.map(words).join(' ')} `;
  return matchAny.some(phrase => {
    const needle = words(phrase);
    return needle.length > 0 && haystack.includes(` ${needle} `);
  });
}

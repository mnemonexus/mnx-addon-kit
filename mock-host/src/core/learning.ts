/** Build preparation sources and activity launch contexts (contract section 9). */
import { MAX_SOURCE_MEDIA, MAX_SOURCE_MEDIA_BYTES, type SourceInput } from './scenario';
import { buildStudyContext, sha256Hex } from './study';

export interface SourceContext {
  workspaceId: string;
  lectureId: string;
  subsectionId: string;
  fingerprint: string;
  objective: string;
  text: string;
  knowledge: unknown[];
  sourceRefs: string[];
  media: { id: string; mimeType: string }[];
}

/** A source figure the host can read: a local file, which the mock serves by path. */
export type ReadableMedia = { id: string; mimeType: string; path: string };

/**
 * The source as the add-on sees it (section 9).
 *
 * Media: the host takes the subsection's first eight figures, then keeps those
 * that are local (data: or blob:, here a file in the add-on folder), report an
 * image/* type and are at most 8 MiB. The rest are left out without a message.
 *
 * The fingerprint is a lowercase hex SHA-256 over the workspace, the lecture,
 * the subsection, the knowledge, the reading depth and the media, as in the
 * app. The mock has no lecture generation time, so it hashes the objective
 * and text in its place.
 */
export async function buildSource(input: SourceInput, sizes: Record<string, number | undefined>):
  Promise<{ source: SourceContext; readable: ReadableMedia[] }> {
  const readable = input.media.slice(0, MAX_SOURCE_MEDIA)
    .filter((row): row is ReadableMedia => 'path' in row && /^image\//i.test(row.mimeType)
      && sizes[row.path] !== undefined && sizes[row.path]! <= MAX_SOURCE_MEDIA_BYTES);
  const media = readable.map(({ id, mimeType }) => ({ id, mimeType }));
  const fingerprint = await sha256Hex(JSON.stringify([input.workspaceId, input.lectureId, input.objective, input.text, input.subsectionId,
    input.knowledge, input.depth, media]));
  return {
    source: {
      workspaceId: input.workspaceId, lectureId: input.lectureId, subsectionId: input.subsectionId, fingerprint,
      objective: input.objective, text: input.text, knowledge: input.knowledge, sourceRefs: input.sourceRefs, media,
    },
    readable,
  };
}

/**
 * The study context of a learning activity launch (section 9): a study run
 * whose task is the offer. taskId is the offer's id and taskSchema its
 * activity's payloadSchema; runId and the evidence rules are any study run's.
 */
export async function activityStudyContext(input: {
  extensionId: string; addonVersion: string; offerId: string; payloadSchema: string;
  study: { workspaceId: string; lectureId: string; lectureTitle: string; subsectionId: string; subsectionTitle: string; depth: 'core' | 'standard' | 'deep'; section: { objective: string; text: string } };
}) {
  return buildStudyContext({
    ...input.study, extensionId: input.extensionId, addonVersion: input.addonVersion,
    taskId: input.offerId, taskSchema: input.payloadSchema,
  });
}

/** Pick an offer by index or id. */
export function chooseOffer<T extends { id: string }>(offers: readonly T[], which: string | number): T | undefined {
  return typeof which === 'number' ? offers[which] : offers.find(offer => offer.id === which);
}

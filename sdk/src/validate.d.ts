export interface Problem { readonly path: string; readonly message: string }
export interface ManifestReport { readonly ok: boolean; readonly errors: Problem[]; readonly warnings: Problem[] }
export const MANIFEST_SCHEMA_VERSION: 'mnxpack_manifest_v1';
export const HOST_PROTOCOL_VERSION: 1;
export const PACK_KINDS: readonly string[];
export const PERMISSIONS: readonly import('./index').Permission[];
export const BINDING_MODES: readonly string[];
export const SURFACE_NAMES: readonly string[];
export const TRANSFERAL_CATEGORIES: readonly string[];
export const COMPAT_LEAVES: readonly string[];
export const COMPAT_LIST_LEAVES: readonly string[];
export const COMPAT_COMBINATORS: readonly string[];
export function isCanonicalPath(path: unknown, prefix: string): boolean;
/** Check a manifest against HOST_CONTRACT.md section 7. */
export function validateManifest(manifest: unknown, options?: { stage?: 'source' | 'built' }): ManifestReport;
export function formatManifestProblems(report: ManifestReport): string;

/** `by: 'host'`: the app refuses the result if it fails. `by: 'kit'`: good practice the app does not check on that surface. */
export interface ResultCheck { readonly rule: string; readonly pass: boolean; readonly by: 'host' | 'kit'; readonly detail?: string }
/** Apply the result checks (HOST_CONTRACT.md section 6). */
export function validateResult(result: unknown, launch: {
  surface: string;
  study?: { runId: string; taskId: string; contextFingerprint: string };
  /** The items the add-on was given, to check itemCoverage keys. */
  items?: readonly { lineageId: string }[];
  /** For surface 'addon-job': the manifest's learning declaration and the source the job was given. */
  learning?: unknown;
  source?: unknown;
}): { ok: boolean; checks: ResultCheck[]; kept?: string[] };

/** Evaluate a compatRule against one item, as the app does. */
export function evaluateCompatRule(rule: unknown, item: import('./index').KnowledgeItem): { pass: boolean; reason: string };
/** The items an add-on is given: [] without consumes/transforms, else those passing the rule, capped at transferal.maxItems. */
export function selectItems<T extends import('./index').KnowledgeItem>(manifest: unknown, items: readonly T[]): {
  items: T[]; rejected: { item: T; reason: string }[]; capped?: number;
};

/** Settings v1: the props.settings an add-on receives for the declared fields and the user's stored values. */
export function resolveSettings(declared: unknown, values?: Readonly<Record<string, unknown>>): Record<string, boolean | number | string>;

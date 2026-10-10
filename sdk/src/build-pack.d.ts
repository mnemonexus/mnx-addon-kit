export interface PackBuildInput {
  readonly manifest: {
    readonly schemaVersion: 'mnxpack_manifest_v1';
    readonly id: string;
    readonly version: string;
    readonly kind: 'experience' | 'recall-face' | 'index-view' | 'knowledge-set' | 'automation-template';
    readonly label: string;
    readonly description: string;
    readonly icon: string;
    readonly author: string;
    readonly knowledgeBinding: Readonly<Record<string, unknown>>;
    readonly surfaces: Readonly<Record<string, unknown>>;
    readonly permissions: readonly import('./index').Permission[];
    readonly engines: { readonly mnxSdk: string; readonly three?: string };
    readonly entry: { readonly logicalPath: string };
    readonly assets?: readonly { readonly logicalPath: string; readonly mimeType?: string | null }[];
    readonly [key: string]: unknown;
  };
  readonly code: Uint8Array;
  readonly assets?: ReadonlyMap<string, Uint8Array>;
}
export const PACK_LIMITS: Readonly<Record<string, number>>;
export function buildPack(input: PackBuildInput): Promise<{
  bytes: Uint8Array; manifest: Record<string, unknown>; packHash: string;
}>;
export function manifestContentHash(manifest: Record<string, unknown>): Promise<string>;
export function sha256Hex(bytes: Uint8Array): Promise<string>;

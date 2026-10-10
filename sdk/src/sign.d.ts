/** PREVIEW (HOST_CONTRACT.md P2). The app does not check signatures yet. */
export interface PackSignature {
  readonly alg: 'ed25519';
  readonly keyId: string;
  readonly contentHash: string;
  /** base64 */
  readonly signature: string;
}
export const SIGNATURE_PREFIX: 'mnxpack-signature-v1:';
export function generateSigningKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string; keyId: string }>;
export function importPrivateKey(pem: string): Promise<CryptoKey>;
export function importPublicKey(pem: string): Promise<CryptoKey>;
export function publicKeyPemFromPrivate(privatePem: string): Promise<string>;
export function keyIdFor(publicKey: CryptoKey): Promise<string>;
export function readPackManifest(packBytes: Uint8Array): { manifest: Record<string, any>; files: Record<string, Uint8Array> };
export function checkPackIntegrity(packBytes: Uint8Array): Promise<{ ok: boolean; problems: string[]; manifest?: Record<string, any> }>;
export function signPack(packBytes: Uint8Array, privateKeyPem: string): Promise<PackSignature>;
export function verifyPack(packBytes: Uint8Array, signature: unknown, publicKeyPem: string): Promise<{ ok: boolean; problems: string[] }>;

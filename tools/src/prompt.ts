/** Render PROMPT.md with the current starter files embedded. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './paths';

export const PROMPT_SOURCE = join(REPO_ROOT, 'tools', 'prompt', 'PROMPT.src.md');
export const PROMPT_FILE = join(REPO_ROOT, 'PROMPT.md');
/** Approximate token limit for the standalone authoring prompt. */
export const PROMPT_TOKEN_BUDGET = 12_000;

export function renderPrompt(): string {
  return readFileSync(PROMPT_SOURCE, 'utf8').replace(/\{\{file:([^}]+)\}\}/g, (_, path: string) =>
    readFileSync(join(REPO_ROOT, path.trim()), 'utf8').trimEnd());
}

/**
 * A conservative token estimate: about 3.5 characters per token for this mix
 * of English and code (real tokenizers usually do a little better).
 */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PROMPT_FILE, PROMPT_TOKEN_BUDGET, estimateTokens, renderPrompt } from '../src/prompt';

describe('PROMPT.md', () => {
  it('is up to date with the starter (run "bun run prompt" if this fails)', () => {
    expect(readFileSync(PROMPT_FILE, 'utf8')).toBe(renderPrompt());
  });
  it('fits in about 12k tokens', () => {
    expect(estimateTokens(renderPrompt())).toBeLessThanOrEqual(PROMPT_TOKEN_BUDGET);
  });
});

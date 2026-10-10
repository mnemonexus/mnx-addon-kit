import { describe, expect, it } from 'bun:test';
import { resolveSettings } from '../src/settings.mjs';

const declared = [
  { id: 'showHints', label: 'Hints', type: 'toggle', default: true },
  { id: 'difficulty', label: 'Difficulty', type: 'choice', options: [{ value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }], default: 'easy' },
  { id: 'rounds', label: 'Rounds', type: 'number', min: 1, max: 10, default: 3 },
  { id: 'greeting', label: 'Greeting', type: 'text', maxLength: 5 },
  { id: 'notes', label: 'Notes', type: 'text', default: 'n' },
];

describe('props.settings', () => {
  it('gives every declared id its default', () => {
    expect(resolveSettings(declared)).toEqual({ showHints: true, difficulty: 'easy', rounds: 3, greeting: '', notes: 'n' });
  });
  it('keeps valid user values', () => {
    expect(resolveSettings(declared, { showHints: false, difficulty: 'hard', rounds: 10, greeting: 'Hi', notes: '' }))
      .toEqual({ showHints: false, difficulty: 'hard', rounds: 10, greeting: 'Hi', notes: '' });
  });
  it('never hands over an impossible value after the field narrows', () => {
    expect(resolveSettings(declared, { showHints: 'yes', difficulty: 'medium', rounds: 11, notes: 3 }))
      .toEqual({ showHints: true, difficulty: 'easy', rounds: 3, greeting: '', notes: 'n' });
  });
  it('cuts text to maxLength, or 500 without one', () => {
    expect(resolveSettings(declared, { greeting: 'Hello there', notes: 'x'.repeat(600) })).toMatchObject({ greeting: 'Hello', notes: 'x'.repeat(500) });
  });
  it('drops values for settings no longer declared, and gives {} without settings', () => {
    expect(resolveSettings(declared, { gone: 1 })).not.toHaveProperty('gone');
    expect(resolveSettings(undefined)).toEqual({});
  });
});

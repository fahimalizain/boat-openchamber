import assert from 'node:assert/strict';
import { test } from 'node:test';

import { promptCommand } from './prompt-argv.ts';

test('a new conversation carries the agent, model and reasoning', () => {
  assert.deepEqual(
    promptCommand('bx_7ppmwt9v', 'fix the tests', {
      newConversation: true,
      provider: 'claude',
      model: 'opus-5-5',
      reasoning: 'high',
    }),
    [
      'bx_7ppmwt9v',
      '--new',
      '--provider',
      'claude',
      '--model',
      'opus-5-5',
      '--reasoning-effort',
      'high',
      '--',
      'fix the tests',
    ],
  );
});

test('a reply carries the conversation and its agent, without reasoning', () => {
  assert.deepEqual(
    promptCommand('bx_7ppmwt9v', 'continue', {
      conversation: 'e25e7685-e730-416e-a89c-1a1495f8cf89',
      provider: 'claude',
      model: 'opus-5-5',
    }),
    [
      'bx_7ppmwt9v',
      '--resume',
      'e25e7685-e730-416e-a89c-1a1495f8cf89',
      '--provider',
      'claude',
      '--model',
      'opus-5-5',
      '--',
      'continue',
    ],
  );
});

test('the minimal prompt is just the sandbox and the text', () => {
  assert.deepEqual(promptCommand('bx_7ppmwt9v', 'hi', {}), ['bx_7ppmwt9v', '--', 'hi']);
});

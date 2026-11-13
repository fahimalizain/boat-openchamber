import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  readPromptFile,
  readPromptFiles,
  MAX_PROMPT_BODY_CHARS,
  MAX_PROMPT_FILE_CHARS,
  MAX_PROMPT_FILES,
} from './validation.ts';

const file = (overrides: Record<string, unknown> = {}) => ({
  name: 'shot.png',
  mime: 'image/png',
  data: 'AAAA',
  ...overrides,
});

test('an attachment needs an image MIME, a name and plain base64', () => {
  assert.deepEqual(readPromptFile(file()), { name: 'shot.png', mime: 'image/png', data: 'AAAA' });
  assert.equal(readPromptFile(file({ mime: 'image/svg+xml' })), null);
  assert.equal(readPromptFile(file({ mime: 'application/pdf' })), null);
  assert.equal(readPromptFile(file({ data: 'not base64!' })), null);
  assert.equal(readPromptFile(file({ data: '' })), null);
  assert.equal(readPromptFile(file({ name: '' })), null);
  assert.equal(readPromptFile(file({ data: 'A'.repeat(MAX_PROMPT_FILE_CHARS + 1) })), null);
  assert.equal(readPromptFile(null), null);
});

test('the prompt files keep their order and stay under the body cap', () => {
  assert.deepEqual(readPromptFiles(undefined, 0), { files: [] });
  assert.deepEqual(readPromptFiles([file()], 10), {
    files: [{ name: 'shot.png', mime: 'image/png', data: 'AAAA' }],
  });

  const tooMany = Array.from({ length: MAX_PROMPT_FILES + 1 }, () => file());
  assert.ok('error' in readPromptFiles(tooMany, 0));
  assert.ok('error' in readPromptFiles('nope', 0));
  assert.ok('error' in readPromptFiles([file({ mime: 'text/plain' })], 0));

  const big = readPromptFiles([file()], MAX_PROMPT_BODY_CHARS);
  assert.ok('error' in big);
  assert.match(big.error, /too large/);
});

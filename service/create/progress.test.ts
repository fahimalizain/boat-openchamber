import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCreateLine } from './progress.ts';

test('created and state lines carry the sandbox id', () => {
  assert.deepEqual(parseCreateLine({ event: 'created', id: 'bx_7ppmwt9v' }), {
    sandboxId: 'bx_7ppmwt9v',
    ready: false,
    failure: null,
  });
  assert.deepEqual(parseCreateLine({ event: 'state', id: 'bx_7ppmwt9v', state: 'provisioned' }), {
    sandboxId: 'bx_7ppmwt9v',
    ready: false,
    failure: null,
  });
});

test('a ready line ends the create', () => {
  const line = parseCreateLine({ event: 'ready', id: 'bx_7ppmwt9v' });
  assert.equal(line?.ready, true);
  assert.equal(line?.sandboxId, 'bx_7ppmwt9v');
});

test('an error line carries the CLI message', () => {
  assert.equal(
    parseCreateLine({ event: 'error', error: 'unknown_environment: no environment named nope' })?.failure,
    'unknown_environment: no environment named nope',
  );
  assert.equal(
    parseCreateLine({ event: 'error', error: { message: 'nested failure' } })?.failure,
    'nested failure',
  );
});

test('anything that is not an object is ignored', () => {
  assert.equal(parseCreateLine(null), null);
  assert.equal(parseCreateLine('created'), null);
  assert.equal(parseCreateLine([]), null);
});

test('wrapped progress lines are unwrapped too', () => {
  assert.deepEqual(parseCreateLine({ event: 'ready', data: { id: 'bx_7ppmwt9v' } }), {
    sandboxId: 'bx_7ppmwt9v',
    ready: true,
    failure: null,
  });
  assert.equal(
    parseCreateLine({ event: 'error', data: { message: 'unknown environment' } })?.failure,
    'unknown environment',
  );
});

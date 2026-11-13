import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BoatError } from '../boat.ts';
import { describeOpencodeError, isReconnectableFailure } from './connection.ts';

const clientError = (reason: string, message: string): Error => (
  Object.assign(new Error(message), { name: 'ClientError', reason })
);

test('only auth, proxy and transport failures rebuild the connection', () => {
  assert.equal(isReconnectableFailure({ _tag: 'UnauthorizedError', message: 'Authentication required' }), true);
  assert.equal(isReconnectableFailure(clientError('Transport', 'Transport: fetch failed')), true);
  assert.equal(isReconnectableFailure(clientError('UnexpectedStatus', 'UnexpectedStatus: 403')), true);
  assert.equal(isReconnectableFailure(clientError('UnexpectedStatus', 'UnexpectedStatus: 401')), true);
  assert.equal(isReconnectableFailure(clientError('UnexpectedStatus', 'UnexpectedStatus: 500')), false);
  assert.equal(isReconnectableFailure(clientError('MalformedResponse', 'bad json')), false);
  assert.equal(isReconnectableFailure(new Error('nope')), false);
  assert.equal(isReconnectableFailure(null), false);
});

test('failures become short messages without credentials', () => {
  const boat = new BoatError('command-failed', 'boat exec failed.');
  assert.equal(describeOpencodeError(boat), boat);

  assert.equal(
    describeOpencodeError(clientError('Transport', 'Transport: fetch failed')).message,
    'The OpenCode server in that sandbox did not answer.',
  );
  assert.equal(
    describeOpencodeError(clientError('UnexpectedStatus', 'UnexpectedStatus: 403')).message,
    'The OpenCode server refused the request.',
  );
  assert.equal(
    describeOpencodeError({ _tag: 'SessionNotFoundError', message: 'Session not found: ses_1' }).message,
    'That OpenCode session no longer exists.',
  );
  assert.equal(
    describeOpencodeError({ _tag: 'FormInvalidAnswerError', message: 'choice: required' }).message,
    'choice: required',
  );
  assert.equal(describeOpencodeError(new Error('something else')).message, 'something else');
  assert.equal(describeOpencodeError({}).message, 'OpenCode did not answer.');
});

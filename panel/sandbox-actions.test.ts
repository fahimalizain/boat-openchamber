import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rowActionsFor } from './sandbox-actions.ts';

test('a running sandbox offers Stop, Extend, Desktop and Copy', () => {
  assert.deepEqual(rowActionsFor('idle', true), {
    primary: 'stop',
    menu: ['extend', 'desktop', 'copy'],
  });
  assert.deepEqual(rowActionsFor('running', false), {
    primary: 'stop',
    menu: ['extend', 'copy'],
  });
});

test('a stopped sandbox only offers Resume and Copy', () => {
  assert.deepEqual(rowActionsFor('stopped', true), { primary: 'resume', menu: ['copy'] });
});

test('a starting sandbox can only be stopped', () => {
  assert.deepEqual(rowActionsFor('cloning', true), { primary: 'stop', menu: [] });
});

test('a broken sandbox offers Copy only', () => {
  assert.deepEqual(rowActionsFor('error', true), { primary: null, menu: ['copy'] });
});

test('a row never offers Stop and Resume together', () => {
  for (const state of ['idle', 'running', 'cloning', 'stopping', 'error']) {
    assert.notEqual(rowActionsFor(state, true).primary, 'resume', state);
  }
  assert.equal(rowActionsFor('stopped', true).primary, 'resume');
});

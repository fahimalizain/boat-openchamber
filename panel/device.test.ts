import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { HostDevice } from '@openchamber/sdk';

import { layoutOf } from './device.ts';

const device = (formFactor: HostDevice['formFactor']): HostDevice => ({
  formFactor,
  pointer: formFactor === 'desktop' ? 'fine' : 'coarse',
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  keyboard: 0,
});

test('phones and tablets get the compact layout', () => {
  assert.equal(layoutOf(device('phone')), 'compact');
  assert.equal(layoutOf(device('tablet')), 'compact');
  assert.equal(layoutOf(device('desktop')), 'roomy');
});

test('a host without a device field stays roomy', () => {
  assert.equal(layoutOf(undefined), 'roomy');
  assert.equal(layoutOf(null), 'roomy');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  attachmentName,
  base64Bytes,
  encodeSteps,
  fitEdge,
  fitsBody,
  imageBudget,
  imageFilesOf,
  isImageFile,
  MAX_BODY_CHARS,
  MAX_EDGE,
  MAX_IMAGE_CHARS,
  MAX_TOTAL_CHARS,
  type ClipboardItemLike,
} from './attachments.ts';

const fileItem = (type: string, name: string): ClipboardItemLike => ({
  kind: 'file',
  type,
  getAsFile: () => new File(['x'], name, { type }),
});

test('an oversized picture is fitted to the long edge', () => {
  assert.deepEqual(fitEdge(4_000, 2_000), { width: MAX_EDGE, height: 800 });
  assert.deepEqual(fitEdge(2_000, 4_000), { width: 800, height: MAX_EDGE });
  assert.deepEqual(fitEdge(500, 300), { width: 500, height: 300 });
  assert.deepEqual(fitEdge(0, 0), { width: 1, height: 1 });
});

test('the encode ladder starts at the fitted size and keeps shrinking', () => {
  const steps = encodeSteps(3_200, 1_600);
  const first = steps[0];
  assert.ok(first);
  assert.equal(first.width, MAX_EDGE);
  assert.equal(first.height, 800);

  const sizes = [...new Set(steps.map((step) => step.width))];
  assert.equal(sizes[0], MAX_EDGE);
  assert.ok(sizes.length > 1);
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok((sizes[index] ?? 0) < (sizes[index - 1] ?? 0));
  }
  assert.ok((sizes.at(-1) ?? 0) >= 220);

  const qualities = steps.slice(0, 4).map((step) => step.quality);
  assert.deepEqual(qualities, [0.82, 0.68, 0.55, 0.42]);
  assert.ok(qualities.every((quality, index) => index === 0 || quality < (qualities[index - 1] ?? 1)));
});

test('a small picture is never upscaled', () => {
  const steps = encodeSteps(320, 200);
  assert.ok(steps.every((step) => step.width <= 320 && step.height <= 200));
  assert.equal(steps[0]?.width, 320);
});

test('base64 sizes and the image budget respect the transport cap', () => {
  assert.equal(base64Bytes('AAAA'), 3);
  assert.equal(base64Bytes('AAA='), 2);
  assert.equal(base64Bytes('AA=='), 1);
  assert.equal(base64Bytes(''), 0);

  assert.equal(imageBudget(0), MAX_IMAGE_CHARS);
  assert.equal(imageBudget(10_000), MAX_IMAGE_CHARS);
  assert.equal(imageBudget(MAX_TOTAL_CHARS - 2_000), 2_000);
  assert.equal(imageBudget(MAX_TOTAL_CHARS - 1_000), 1_000);
  assert.equal(imageBudget(MAX_TOTAL_CHARS + 500), 0);
  assert.equal(imageBudget(0, MAX_BODY_CHARS - 5_000), 4_000);
  assert.equal(imageBudget(0, MAX_BODY_CHARS), 0);

  assert.equal(fitsBody('hello', [{ data: 'x'.repeat(MAX_BODY_CHARS - 5) }]), true);
  assert.equal(fitsBody('hello', [{ data: 'x'.repeat(MAX_BODY_CHARS - 4) }]), false);
  assert.equal(fitsBody('x'.repeat(MAX_BODY_CHARS + 1), []), false);
});

test('a paste or drop yields its image files only', () => {
  const items = [
    { kind: 'string', type: 'text/plain', getAsFile: () => null },
    fileItem('image/png', 'shot.png'),
    { kind: 'file', type: 'application/pdf', getAsFile: () => new File(['x'], 'a.pdf', { type: 'application/pdf' }) },
    fileItem('image/webp', 'photo.webp'),
  ];

  assert.deepEqual(imageFilesOf(items).map((file) => file.name), ['shot.png', 'photo.webp']);
  assert.deepEqual(imageFilesOf([]), []);
  assert.deepEqual(imageFilesOf(null), []);
  assert.deepEqual(imageFilesOf(undefined), []);
});

test('only MIME types OpenCode can read are accepted', () => {
  assert.equal(isImageFile({ type: 'image/png' }), true);
  assert.equal(isImageFile({ type: 'image/jpeg' }), true);
  assert.equal(isImageFile({ type: 'image/webp' }), true);
  assert.equal(isImageFile({ type: 'image/gif' }), true);
  assert.equal(isImageFile({ type: 'image/svg+xml' }), false);
  assert.equal(isImageFile({ type: 'application/pdf' }), false);
  assert.equal(isImageFile({ type: '' }), false);
});

test('a pasted image without a name gets one from its MIME', () => {
  assert.equal(attachmentName({ name: 'diagram.png', type: 'image/png' }, 0), 'diagram.png');
  assert.equal(attachmentName({ name: '', type: 'image/png' }, 0), 'pasted-1.png');
  assert.equal(attachmentName({ name: '   ', type: 'image/jpeg' }, 2), 'pasted-3.jpg');
  assert.equal(attachmentName({ name: '', type: 'image/webp' }, 1), 'pasted-2.webp');
});

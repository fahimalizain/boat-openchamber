import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInline, parseMarkdown, safeHref } from './markdown.ts';

const inlineText = (text: string): string => parseInline(text)
  .map((part) => (part.kind === 'text' ? part.text : ''))
  .join('');

test('only http(s) links survive', () => {
  assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeHref('http://example.com'), 'http://example.com');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeHref('//example.com'), null);
  assert.equal(safeHref('https://example.com has spaces'), null);
});

test('inline spans parse code, emphasis, strike and links', () => {
  assert.deepEqual(parseInline('a `b` c'), [
    { kind: 'text', text: 'a ' },
    { kind: 'code', text: 'b' },
    { kind: 'text', text: ' c' },
  ]);
  assert.deepEqual(parseInline('**bold** and *soft*'), [
    { kind: 'strong', parts: [{ kind: 'text', text: 'bold' }] },
    { kind: 'text', text: ' and ' },
    { kind: 'em', parts: [{ kind: 'text', text: 'soft' }] },
  ]);
  assert.deepEqual(parseInline('~~gone~~'), [
    { kind: 'strike', parts: [{ kind: 'text', text: 'gone' }] },
  ]);
  assert.deepEqual(parseInline('[docs](https://example.com)'), [
    { kind: 'link', href: 'https://example.com', label: 'docs' },
  ]);
});

test('an unsafe link stays plain text', () => {
  assert.deepEqual(parseInline('[x](javascript:alert(1))'), [
    { kind: 'text', text: '[x](javascript:alert(1))' },
  ]);
  assert.equal(inlineText('[x](data:text/html,hi)'), '[x](data:text/html,hi)');
});

test('raw HTML is text, never markup', () => {
  assert.deepEqual(parseMarkdown('<script>alert(1)</script>'), [
    {
      kind: 'paragraph',
      parts: [{ kind: 'text', text: '<script>alert(1)</script>' }],
    },
  ]);
});

test('blocks: headings, fences, lists, quotes and rules', () => {
  const blocks = parseMarkdown([
    '# Title',
    '',
    '```ts',
    'const x = 1;',
    'const y = 2;',
    '```',
    '',
    '- one',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '> quoted line',
    '',
    '---',
  ].join('\n'));

  assert.deepEqual(blocks.map((block) => block.kind), [
    'heading',
    'code',
    'list',
    'list',
    'quote',
    'rule',
  ]);
  assert.equal(blocks[0]?.kind === 'heading' ? blocks[0].level : 0, 1);
  assert.equal(blocks[1]?.kind === 'code' ? blocks[1].language : null, 'ts');
  assert.equal(blocks[1]?.kind === 'code' ? blocks[1].text : '', 'const x = 1;\nconst y = 2;');
  assert.deepEqual(blocks[2]?.kind === 'list' ? blocks[2].items.map((item) => item[0]) : [], [
    { kind: 'text', text: 'one' },
    { kind: 'text', text: 'two' },
  ]);
  assert.equal(blocks[3]?.kind === 'list' ? blocks[3].ordered : null, true);
  assert.deepEqual(blocks[4]?.kind === 'quote' ? blocks[4].parts : [], [{ kind: 'text', text: 'quoted line' }]);
});

test('paragraphs keep lines and an unclosed fence runs to the end', () => {
  const blocks = parseMarkdown('first line\nsecond line\n\n```\nstuck');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], {
    kind: 'paragraph',
    parts: [{ kind: 'text', text: 'first line second line' }],
  });
  assert.deepEqual(blocks[1], { kind: 'code', language: null, text: 'stuck' });
});

test('an empty message has no blocks', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseInline(''), []);
});

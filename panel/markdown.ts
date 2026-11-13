/**
 * A small Markdown reader for chat text. It produces data, never HTML: the view
 * builds DOM nodes and text nodes only, so model output cannot inject markup.
 * A link survives only when it is http(s); everything else stays plain text.
 */

export type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; parts: InlinePart[] }
  | { kind: 'em'; parts: InlinePart[] }
  | { kind: 'strike'; parts: InlinePart[] }
  | { kind: 'link'; href: string; label: string };

export type MarkdownBlock =
  | { kind: 'paragraph'; parts: InlinePart[] }
  | { kind: 'heading'; level: number; parts: InlinePart[] }
  | { kind: 'code'; language: string | null; text: string }
  | { kind: 'list'; ordered: boolean; items: InlinePart[][] }
  | { kind: 'quote'; parts: InlinePart[] }
  | { kind: 'rule' };

/** Only http(s) leaves the panel; a `javascript:` or `data:` href is dead text. */
export const safeHref = (value: string): string | null => {
  const href = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(href) ? href : null;
};

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]*\]\([^)\s]+\))/;

const pushText = (parts: InlinePart[], text: string): void => {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last?.kind === 'text') {
    parts[parts.length - 1] = { kind: 'text', text: last.text + text };
    return;
  }
  parts.push({ kind: 'text', text });
};

/** Reads inline spans; nested emphasis is allowed, nesting links is not. */
export const parseInline = (text: string): InlinePart[] => {
  const parts: InlinePart[] = [];
  let rest = text;

  while (rest) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) {
      pushText(parts, rest);
      break;
    }
    const index = match.index;
    if (index > 0) pushText(parts, rest.slice(0, index));

    const token = match[0];
    rest = rest.slice(index + token.length);

    if (token.startsWith('`')) {
      parts.push({ kind: 'code', text: token.slice(1, -1) });
      continue;
    }
    if (token.startsWith('**') || token.startsWith('__')) {
      parts.push({ kind: 'strong', parts: parseInline(token.slice(2, -2)) });
      continue;
    }
    if (token.startsWith('~~')) {
      parts.push({ kind: 'strike', parts: parseInline(token.slice(2, -2)) });
      continue;
    }
    if (token.startsWith('*') || token.startsWith('_')) {
      parts.push({ kind: 'em', parts: parseInline(token.slice(1, -1)) });
      continue;
    }
    if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      if (href) parts.push({ kind: 'link', href, label: label || href });
      else pushText(parts, token);
      continue;
    }

    pushText(parts, token);
  }

  return parts;
};

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

/** Reads a whole message into blocks; an unclosed fence runs to the end. */
export const parseMarkdown = (text: string): MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: InlinePart[][] } | null = null;
  let quote: string[] = [];
  let code: { language: string | null; lines: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', parts: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (!list) return;
    blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    blocks.push({ kind: 'quote', parts: parseInline(quote.join(' ')) });
    quote = [];
  };
  const flush = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (code) {
      if (FENCE.test(line)) {
        blocks.push({ kind: 'code', language: code.language, text: code.lines.join('\n') });
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    if (FENCE.test(line)) {
      flush();
      const info = line.replace(/^\s*```/, '').trim();
      code = { language: info || null, lines: [] };
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading?.[1]) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length, parts: parseInline(heading[2] ?? '') });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1] ?? '');
      continue;
    }

    const item = ITEM.exec(line);
    if (item?.[1]) {
      flushParagraph();
      flushQuote();
      const ordered = /^\d/.test(item[1]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseInline(item[2] ?? ''));
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  if (code) blocks.push({ kind: 'code', language: code.language, text: code.lines.join('\n') });
  flush();
  return blocks;
};

export type MarkdownOptions = {
  /** A sandboxed iframe cannot open a link; the host does it. */
  onOpenUrl?: (url: string) => void;
};

const inlineNode = (part: InlinePart, options: MarkdownOptions): Node => {
  switch (part.kind) {
    case 'text':
      return document.createTextNode(part.text);
    case 'code': {
      const node = document.createElement('code');
      node.textContent = part.text;
      return node;
    }
    case 'strong': {
      const node = document.createElement('strong');
      appendInline(node, part.parts, options);
      return node;
    }
    case 'em': {
      const node = document.createElement('em');
      appendInline(node, part.parts, options);
      return node;
    }
    case 'strike': {
      const node = document.createElement('del');
      appendInline(node, part.parts, options);
      return node;
    }
    case 'link': {
      const node = document.createElement('a');
      node.href = part.href;
      node.textContent = part.label;
      node.rel = 'noreferrer noopener';
      node.addEventListener('click', (event) => {
        event.preventDefault();
        options.onOpenUrl?.(part.href);
      });
      return node;
    }
  }
};

const appendInline = (parent: Node, parts: InlinePart[], options: MarkdownOptions): void => {
  for (const part of parts) parent.appendChild(inlineNode(part, options));
};

const blockNode = (block: MarkdownBlock, options: MarkdownOptions): Node => {
  switch (block.kind) {
    case 'paragraph': {
      const node = document.createElement('p');
      appendInline(node, block.parts, options);
      return node;
    }
    case 'heading': {
      const node = document.createElement(`h${Math.min(block.level, 6)}`);
      appendInline(node, block.parts, options);
      return node;
    }
    case 'code': {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (block.language) code.className = `language-${block.language}`;
      code.textContent = block.text;
      pre.appendChild(code);
      return pre;
    }
    case 'list': {
      const node = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const row = document.createElement('li');
        appendInline(row, item, options);
        node.appendChild(row);
      }
      return node;
    }
    case 'quote': {
      const node = document.createElement('blockquote');
      appendInline(node, block.parts, options);
      return node;
    }
    case 'rule':
      return document.createElement('hr');
  }
};

/** Draws Markdown into a fragment: only elements this module creates, no HTML. */
export const renderMarkdown = (text: string, options: MarkdownOptions = {}): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(text)) fragment.appendChild(blockNode(block, options));
  return fragment;
};

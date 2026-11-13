/** One OpenCode message as DOM: Markdown text, reasoning, tools, patches and files. */
import { clip } from '../../shared/json.ts';
import type { OpencodeMessage, OpencodePart, OpencodeTool } from '../../shared/opencode.ts';
import { messageSpeaker } from '../chat-model.ts';
import { el } from '../kit.ts';
import { renderMarkdown } from '../markdown.ts';

export type RenderOptions = {
  onOpenUrl: (url: string) => void;
};

export const toolStatusLabel = (status: OpencodeTool['status']): string => {
  if (status === 'completed') return 'done';
  if (status === 'error') return 'failed';
  return status;
};

const INPUT_KEYS = [
  'description',
  'command',
  'filePath',
  'file_path',
  'path',
  'pattern',
  'query',
  'url',
  'name',
  'prompt',
];

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** How long a tool ran, as the collapsed row's right edge shows it. */
export const toolDuration = (tool: OpencodeTool): string => {
  if (!tool.startedAt) return '';
  const running = tool.status === 'running' || tool.status === 'streaming';
  const end = tool.completedAt ?? (running ? Date.now() : null);
  if (end === null) return '';
  const milliseconds = Math.max(0, end - tool.startedAt);
  if (milliseconds < 1_000) return `${Math.max(1, Math.round(milliseconds))}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
};

/** The one line a collapsed tool row shows: a command, a path or a short ask. */
export const toolSummary = (tool: OpencodeTool): string => {
  const input = tool.input;
  if (input) {
    for (const key of INPUT_KEYS) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) return clip(oneLine(value), 100);
    }
    const files = input.files;
    if (Array.isArray(files)) {
      const first = files.find((entry) => typeof entry === 'string');
      if (typeof first === 'string') return clip(oneLine(first), 100);
    }
  }
  if (tool.inputText) return clip(oneLine(tool.inputText), 100);
  if (tool.files[0]) return clip(tool.files[0].name ?? tool.files[0].mime, 100);
  return '';
};

const detailNode = (className: string, key: string): HTMLDetailsElement => {
  const node = el('details', className);
  node.dataset.detail = key;
  return node;
};

const markdownNode = (text: string, options: RenderOptions): HTMLElement => {
  const node = el('div', 'msg-text md');
  node.append(renderMarkdown(text, { onOpenUrl: options.onOpenUrl }));
  return node;
};

const preNode = (text: string, className = 'tool-pre'): HTMLElement => {
  const pre = el('pre', className);
  pre.textContent = text;
  return pre;
};

const fileChips = (files: { name: string | null; mime: string; uri: string | null }[]): HTMLElement => {
  const row = el('div', 'file-row');
  for (const file of files) {
    row.append(el('span', 'file-chip', [file.name ?? file.mime, file.mime].filter(Boolean).join(' · ')));
  }
  return row;
};

const reasoningNode = (
  message: OpencodeMessage,
  part: Extract<OpencodePart, { kind: 'reasoning' }>,
  options: RenderOptions,
): HTMLElement => {
  const node = detailNode('reasoning', `${message.id}:reasoning:${part.ordinal}`);
  const summary = el('summary', 'reasoning-head');
  summary.append(el('span', 'reasoning-label', part.completedAt || part.text ? 'Thinking' : 'Thinking…'));
  if (part.text) summary.append(el('span', 'reasoning-hint', `${part.text.length.toLocaleString()} chars`));
  node.append(summary);
  if (part.text) node.append(markdownNode(part.text, options));
  return node;
};

const toolNode = (
  message: OpencodeMessage,
  tool: OpencodeTool,
  options: RenderOptions,
): HTMLElement => {
  const node = detailNode(`tool tool-${tool.status}`, `${message.id}:tool:${tool.id}`);
  const summary = el('summary', 'tool-head');
  summary.append(el('span', 'tool-state', tool.status === 'error' ? '×' : tool.status === 'completed' ? '✓' : '●'));
  summary.append(el('span', 'tool-name', tool.name));
  const detail = toolSummary(tool);
  if (detail) summary.append(el('span', 'tool-summary', detail));
  const duration = toolDuration(tool);
  summary.append(el('span', 'tool-meta', [duration, toolStatusLabel(tool.status)].filter(Boolean).join(' · ')));
  node.append(summary);

  const body = el('div', 'tool-body');
  if (tool.inputText ?? tool.input) {
    body.append(el('div', 'tool-label', 'Input'));
    body.append(preNode(tool.inputText ?? JSON.stringify(tool.input, null, 2)));
  }
  if (tool.output) {
    body.append(el('div', 'tool-label', 'Output'));
    body.append(preNode(tool.output));
    if (tool.truncated) body.append(el('div', 'hint', 'Output clipped at 20,000 characters.'));
  }
  if (tool.error) body.append(el('div', 'msg-error', tool.error));
  if (tool.files.length > 0) body.append(fileChips(tool.files));
  if (body.childNodes.length > 0) node.append(body);
  return node;
};

const patchNode = (
  message: OpencodeMessage,
  part: Extract<OpencodePart, { kind: 'patch' }>,
): HTMLElement => {
  const files = part.patch.files;
  const node = detailNode('patch', `${message.id}:patch`);
  const summary = el('summary', 'patch-head');
  summary.append(el('span', '', files.length === 1 ? '1 file changed' : `${files.length} files changed`));
  node.append(summary);

  const list = el('div', 'patch-files');
  for (const file of files) list.append(el('div', 'patch-file', file));
  node.append(list);
  return node;
};

const todoNode = (todos: Extract<OpencodePart, { kind: 'todo' }>['todos']): HTMLElement => {
  const node = el('div', 'todo-list');
  for (const todo of todos) {
    const row = el('div', `todo todo-${todo.status}`);
    const tick = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '▸' : todo.status === 'cancelled' ? '×' : '·';
    row.append(el('span', 'todo-tick', tick), el('span', 'todo-text', todo.content));
    node.append(row);
  }
  return node;
};

const partNode = (message: OpencodeMessage, part: OpencodePart, options: RenderOptions): Node | null => {
  switch (part.kind) {
    case 'text':
      return part.text ? markdownNode(part.text, options) : null;
    case 'reasoning':
      return reasoningNode(message, part, options);
    case 'tool':
      return toolNode(message, part.tool, options);
    case 'patch':
      return part.patch.files.length > 0 ? patchNode(message, part) : null;
    case 'todo':
      return part.todos.length > 0 ? todoNode(part.todos) : null;
    case 'file':
      return fileChips([part.file]);
  }
};

/** One message, with the parts the service projected for it. */
export const createMessageNode = (
  message: OpencodeMessage,
  options: RenderOptions,
  previous: OpencodeMessage | null = null,
): HTMLElement => {
  const node = el('div', `msg ${message.role}${message.error ? ' failed' : ''}`);
  const head = el('div', 'msg-head');

  if (message.role === 'user') {
    // The bubble itself says who spoke; a label would only cost a line.
  } else if (message.role === 'assistant') {
    // The session bar already names the agent and model; repeat it only when
    // this message is the first of a run or the run changed model.
    const speaker = messageSpeaker(message);
    if (!previous || previous.role !== 'assistant' || messageSpeaker(previous) !== speaker) {
      head.append(el('span', '', speaker));
    }
    if (message.streaming) head.append(el('span', 'tag live', 'streaming'));
    if (message.error) head.append(el('span', 'tag bad', 'failed'));
  } else {
    head.append(el('span', '', message.notice ?? 'System'));
  }
  if (head.childNodes.length > 0) node.append(head);

  if (message.role === 'system') {
    const text = message.parts
      .filter((part): part is Extract<OpencodePart, { kind: 'text' }> => part.kind === 'text')
      .map((part) => part.text)
      .join('\n');
    if (text) node.append(el('div', 'msg-notice', text));
    if (message.error) node.append(el('div', 'msg-error', message.error));
    return node;
  }

  for (const part of message.parts) {
    const child = partNode(message, part, options);
    if (child) node.append(child);
  }
  if (message.error) node.append(el('div', 'msg-error', message.error));
  if (message.notice) node.append(el('div', 'msg-notice', message.notice));
  return node;
};

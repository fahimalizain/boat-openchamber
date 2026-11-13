import { isRecord } from './json.ts';
import type { UiEvent } from './types.ts';

/** Checks an event that arrived over `host.emit` before the panel draws it. */
export const isUiEvent = (value: unknown): value is UiEvent => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.type !== 'string') return false;
  if (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'system') return false;
  if (typeof value.at !== 'number') return false;
  if (typeof value.text !== 'string') return false;
  if (value.tools !== undefined && !Array.isArray(value.tools)) return false;
  return true;
};

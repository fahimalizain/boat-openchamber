/** The ids, paths and sizes the service accepts from the panel. */
import { isRecord, readString } from '../shared/json.ts';
import type { OpencodeModelRef } from '../shared/opencode.ts';

export const SANDBOX_ID = /^[a-z]{2,8}_[a-z0-9]{4,40}$/;
export const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const OPENCODE_SESSION_ID = /^ses_[A-Za-z0-9]{6,64}$/;
export const OPENCODE_NAME = /^[A-Za-z0-9._:-]{1,100}$/;
/** Model ids carry provider punctuation such as `claude-fable-5-1[1m]`. */
export const OPENCODE_MODEL_NAME = /^[A-Za-z0-9._:@+[\]()/-]{1,200}$/;
export const OPENCODE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const MAX_PROMPT_CHARS = 20_000;
export const MAX_MODEL_CHARS = 200;
export const MAX_TITLE_CHARS = 200;
export const MAX_DIRECTORY_CHARS = 500;

export const isSandboxId = (value: unknown): value is string => (
  typeof value === 'string' && SANDBOX_ID.test(value)
);

export const isConversationId = (value: unknown): value is string => (
  typeof value === 'string' && CONVERSATION_ID.test(value)
);

export const isOpencodeSessionId = (value: unknown): value is string => (
  typeof value === 'string' && OPENCODE_SESSION_ID.test(value)
);

/** Permission (`per…`), form (`frm…`) and message (`msg…`) ids. */
export const isOpencodeRequestId = (value: unknown): value is string => (
  typeof value === 'string' && OPENCODE_REQUEST_ID.test(value)
);

export const isOpencodeName = (value: unknown): value is string => (
  typeof value === 'string' && OPENCODE_NAME.test(value)
);

/** An absolute sandbox path, without NULs or traversal segments. */
export const isAbsoluteDirectory = (value: unknown): value is string => (
  typeof value === 'string'
  && value.startsWith('/')
  && value.length <= MAX_DIRECTORY_CHARS
  && !value.includes('\0')
  && !value.split('/').includes('..')
);

/** A model selection from the panel: provider, model and optional variant. */
export const readOpencodeModelRef = (value: unknown): OpencodeModelRef | null => {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const providerID = readString(value.providerID);
  if (!id || !providerID || !OPENCODE_MODEL_NAME.test(id) || !OPENCODE_MODEL_NAME.test(providerID)) return null;
  const variant = readString(value.variant);
  if (variant !== null && !OPENCODE_MODEL_NAME.test(variant)) return null;
  return { id, providerID, variant };
};

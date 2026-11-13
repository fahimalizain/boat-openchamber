/** The ids, paths and sizes the service accepts from the panel. */
import { isRecord, readString } from '../shared/json.ts';
import type { OpencodeModelRef } from '../shared/opencode.ts';
import type { OpencodePromptFile } from '../shared/routes.ts';

export const SANDBOX_ID = /^[a-z]{2,8}_[a-z0-9]{4,40}$/;
export const OPENCODE_SESSION_ID = /^ses_[A-Za-z0-9]{6,64}$/;
export const OPENCODE_NAME = /^[A-Za-z0-9._:-]{1,100}$/;
/** Model ids carry provider punctuation such as `claude-fable-5-1[1m]`. */
export const OPENCODE_MODEL_NAME = /^[A-Za-z0-9._:@+[\]()/-]{1,200}$/;
export const OPENCODE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const MAX_PROMPT_CHARS = 20_000;
export const MAX_MODEL_CHARS = 200;
export const MAX_TITLE_CHARS = 200;
export const MAX_DIRECTORY_CHARS = 500;

/** Inline images: the host caps a panel→service body at 64 000 characters. */
export const MAX_PROMPT_FILES = 4;
export const MAX_PROMPT_FILE_CHARS = 24_000;
export const MAX_PROMPT_FILES_CHARS = 48_000;
/** Text plus attachments, safely under the host's 64 000-character body cap. */
export const MAX_PROMPT_BODY_CHARS = 60_000;

export const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;
export const BASE64_DATA = /^[A-Za-z0-9+/]+={0,2}$/;

export const isSandboxId = (value: unknown): value is string => (
  typeof value === 'string' && SANDBOX_ID.test(value)
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

/** One inline image the panel prepared: a known image MIME and plain base64. */
export const readPromptFile = (value: unknown): OpencodePromptFile | null => {
  if (!isRecord(value)) return null;
  const name = readString(value.name);
  const mime = readString(value.mime);
  const data = readString(value.data);
  if (!name || name.length > MAX_TITLE_CHARS) return null;
  if (!mime || !IMAGE_MIME.test(mime)) return null;
  if (!data || data.length > MAX_PROMPT_FILE_CHARS || !BASE64_DATA.test(data)) return null;
  return { name, mime, data };
};

/**
 * The prompt's attachments in order. The whole set has to fit the
 * panel→service body cap with the text; a bad entry names what to fix.
 */
export type PromptFilesRead = { files: OpencodePromptFile[] } | { error: string };

export const readPromptFiles = (value: unknown, textChars: number): PromptFilesRead => {
  if (value === undefined) return { files: [] };
  if (!Array.isArray(value)) return { error: 'Unknown attachment.' };
  if (value.length > MAX_PROMPT_FILES) {
    return { error: `At most ${MAX_PROMPT_FILES} images can ride with one message.` };
  }
  const files: OpencodePromptFile[] = [];
  let chars = 0;
  for (const entry of value) {
    const file = readPromptFile(entry);
    if (!file) return { error: 'Only PNG, JPEG, WebP or GIF images can be attached.' };
    chars += file.data.length;
    files.push(file);
  }
  if (chars > MAX_PROMPT_FILES_CHARS || textChars + chars > MAX_PROMPT_BODY_CHARS) {
    return { error: 'That message and its images are too large to send together.' };
  }
  return { files };
};

/**
 * Inline images for a prompt. The panel shrinks every picture into the
 * panel→service body budget before it can be sent: decode, fit the long edge,
 * re-encode as WebP (JPEG when the browser cannot), step the quality and then
 * the size down until the base64 fits. Nothing here touches the network.
 */

export type PendingImage = {
  id: string;
  name: string;
  mime: string;
  /** Base64 with no `data:` prefix, as the prompt route takes it. */
  data: string;
  /** Bytes of the encoded image the panel holds. */
  bytes: number;
  width: number;
  height: number;
  /** A blob: URL for the composer's thumbnail; revoked when it is dropped. */
  preview: string;
};

/** The host refuses a panel→service body over 64 000 characters. */
export const MAX_BODY_CHARS = 60_000;
export const MAX_ATTACHMENTS = 3;
/** Long edge of the decoded image, before the transport budget wins. */
export const MAX_EDGE = 1600;
/** Base64 characters one attachment may use. */
export const MAX_IMAGE_CHARS = 20_000;
/** Base64 characters all attachments together may use. */
export const MAX_TOTAL_CHARS = 34_000;
/** Below this long edge a picture is a thumbnail and no longer worth sending. */
export const MIN_EDGE = 220;

const IMAGE_MIMES = /^image\/(png|jpe?g|webp|gif)$/;
const QUALITIES = [0.82, 0.68, 0.55, 0.42];
/** How much each failed pass shrinks the picture before trying again. */
const SHRINK = 0.8;

export const isImageFile = (file: { type: string }): boolean => IMAGE_MIMES.test(file.type);

/** The shape a clipboard item or a drag's `DataTransferItem` exposes. */
export type ClipboardItemLike = {
  kind: string;
  type: string;
  getAsFile: () => File | null;
};

/**
 * The image files a paste or a drop carried, in order. A clipboard with text
 * and a screenshot yields the screenshot; a drop of a folder yields nothing.
 */
export const imageFilesOf = (items: ArrayLike<ClipboardItemLike> | null | undefined): File[] => {
  if (!items) return [];
  const files: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== 'file' || !isImageFile(item)) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
};

/** Scales a picture down to fit `maxEdge`; a smaller picture is left alone. */
export const fitEdge = (
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } => {
  const long = Math.max(width, height);
  if (long <= 0) return { width: 1, height: 1 };
  if (long <= maxEdge) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/** Decoded bytes behind a base64 payload, without decoding it. */
export const base64Bytes = (data: string): number => {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
};

export type EncodeStep = { width: number; height: number; quality: number };

/**
 * The encode attempts for one picture, best first: every quality at the fitted
 * size, then the same ladder one size down, until the long edge hits the floor.
 */
export const encodeSteps = (
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
  minEdge: number = MIN_EDGE,
): EncodeStep[] => {
  const steps: EncodeStep[] = [];
  let size = fitEdge(width, height, maxEdge);
  while (Math.max(size.width, size.height) >= minEdge || steps.length === 0) {
    for (const quality of QUALITIES) steps.push({ ...size, quality });
    if (Math.max(size.width, size.height) <= minEdge) break;
    const next = fitEdge(Math.round(size.width * SHRINK), Math.round(size.height * SHRINK), maxEdge);
    if (next.width === size.width && next.height === size.height) break;
    size = next;
  }
  return steps;
};

/**
 * Room left for one more image, given what the others already use and the
 * prompt's text. The body cap is shared, so a long draft leaves less for images.
 */
export const imageBudget = (usedChars: number, textChars = 0): number => (
  Math.max(
    0,
    Math.min(
      MAX_IMAGE_CHARS,
      MAX_TOTAL_CHARS - usedChars,
      MAX_BODY_CHARS - textChars - 1_000,
    ),
  )
);

/** True when the prompt's text and images fit under the service's body cap. */
export const fitsBody = (text: string, images: Array<{ data: string }>): boolean => (
  text.length + images.reduce((total, image) => total + image.data.length, 0) <= MAX_BODY_CHARS
);

/** Name a pasted screenshot gets when the clipboard carries none. */
export const attachmentName = (file: { name: string; type: string }, index: number): string => {
  if (file.name.trim()) return file.name;
  const extension = file.type === 'image/jpeg' ? 'jpg' : (file.type.split('/')[1] || 'png');
  return `pasted-${index + 1}.${extension}`;
};

/** Drops the thumbnails' blob URLs; call before forgetting the attachments. */
export const releaseImages = (images: PendingImage[]): void => {
  for (const image of images) {
    if (image.preview.startsWith('blob:')) URL.revokeObjectURL(image.preview);
  }
};

const base64Of = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('That image could not be read.'));
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    const comma = result.indexOf(',');
    if (comma < 0) {
      reject(new Error('That image could not be read.'));
      return;
    }
    resolve(result.slice(comma + 1));
  };
  reader.readAsDataURL(blob);
});

const encode = (canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> => (
  new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
);

const canvasOf = (width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot resize images.');
  // JPEG has no alpha; white keeps a transparent screenshot readable.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  return { canvas, context };
};

/**
 * Decodes, shrinks and encodes one file into an attachment under `budget`
 * base64 characters. Throws with a panel-ready message when even the smallest
 * attempt is too large.
 */
export const prepareImage = async (
  file: File,
  budget: number,
  name: string = file.name,
): Promise<PendingImage> => {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('That image could not be read.');

  try {
    const steps = encodeSteps(bitmap.width, bitmap.height);
    let encoded = false;

    for (const step of steps) {
      const { canvas, context } = canvasOf(step.width, step.height);
      context.drawImage(bitmap, 0, 0, step.width, step.height);
      const webp = await encode(canvas, 'image/webp', step.quality);
      const mime = webp ? 'image/webp' : 'image/jpeg';
      const blob = webp ?? await encode(canvas, 'image/jpeg', step.quality);
      if (!blob) continue;
      encoded = true;
      const data = await base64Of(blob);
      if (data.length <= budget) {
        return {
          id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          name,
          mime,
          data,
          bytes: blob.size,
          width: step.width,
          height: step.height,
          preview: URL.createObjectURL(blob),
        };
      }
    }

    if (encoded) {
      throw new Error('That image is still too large to send. Crop it, or pick a smaller one.');
    }
    throw new Error('That image could not be read.');
  } finally {
    bitmap.close();
  }
};

/** The phone layout decision and the safe-area values the CSS reads. */
import type { HostDevice } from '@openchamber/sdk';

export type PanelLayout = 'compact' | 'roomy';

export const layoutOf = (device: HostDevice | undefined | null): PanelLayout => (
  device?.formFactor === 'phone' || device?.formFactor === 'tablet' ? 'compact' : 'roomy'
);

export const applyDevice = (device: HostDevice | undefined, root: HTMLElement): void => {
  root.dataset.layout = layoutOf(device);
  setPixels(root, '--safe-top', device?.insets.top);
  setPixels(root, '--safe-right', device?.insets.right);
  setPixels(root, '--safe-bottom', device?.insets.bottom);
  setPixels(root, '--safe-left', device?.insets.left);
  setPixels(root, '--keyboard-inset', device?.keyboard);
};

const setPixels = (root: HTMLElement, name: string, value: number | undefined): void => {
  root.style.setProperty(name, `${Math.max(0, Math.round(value ?? 0))}px`);
};

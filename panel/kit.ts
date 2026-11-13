/** DOM helpers and the one way a view creates a kit button slot. */
import { mountButton, type ButtonHandle, type ButtonProps } from '@openchamber/sdk/ui';

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Boat panel: #${id} is missing.`);
  return node as T;
};

export type ButtonSlot = { slot: HTMLDivElement; handle: ButtonHandle };

export const buttonSlot = (parent: HTMLElement, props: ButtonProps): ButtonSlot => {
  const slot = el('div', 'slot');
  parent.append(slot);
  return { slot, handle: mountButton(slot, props) };
};

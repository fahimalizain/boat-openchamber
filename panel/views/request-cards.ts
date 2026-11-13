/** The two request cards: an OpenCode permission and an OpenCode form question. */
import { mountButton, mountTextField, type ButtonHandle, type TextFieldHandle } from '@openchamber/sdk/ui';

import type {
  OpencodePermissionDecision,
  OpencodePermissionRequest,
  OpencodeQuestionAnswer,
  OpencodeQuestionField,
  OpencodeQuestionRequest,
} from '../../shared/opencode.ts';
import { el } from '../kit.ts';

export type RequestCard = {
  dispose: () => void;
  /** A panel action is running; the card's controls wait for it. */
  update: (disabled: boolean) => void;
};

const cardShell = (title: string, body: string | null): { card: HTMLElement; actions: HTMLElement } => {
  const card = el('div', 'card request-card');
  card.append(el('div', 'card-title', title));
  if (body) card.append(el('div', 'card-body', body));
  const actions = el('div', 'card-actions');
  card.append(actions);
  return { card, actions };
};

export const createPermissionCard = (
  root: HTMLElement,
  request: OpencodePermissionRequest,
  onDecide: (requestId: string, decision: OpencodePermissionDecision) => void,
): RequestCard => {
  const body = [
    request.source ? `From ${request.source}` : null,
    request.agent ? `Agent ${request.agent}` : null,
    request.message,
    request.resources.length > 0 ? request.resources.join(', ') : null,
  ].filter(Boolean).join(' · ');

  const card = el('div', 'card request-card permission-card');
  const row = el('div', 'request-row');
  row.append(el('span', 'chip', 'permission'), el('span', 'chip mono', request.action));
  if (body) row.append(el('span', 'request-text', body));
  const actions = el('div', 'card-actions');
  row.append(actions);
  card.append(row);
  const buttons: ButtonHandle[] = [];

  const add = (label: string, variant: 'default' | 'outline' | 'destructive', decision: OpencodePermissionDecision): void => {
    const slot = el('div', 'slot');
    actions.append(slot);
    buttons.push(mountButton(slot, {
      label,
      size: 'xs',
      variant,
      onClick: () => onDecide(request.id, decision),
    }));
  };

  add('Allow once', 'default', 'once');
  add('Always', 'outline', 'always');
  add('Reject', 'destructive', 'reject');
  root.append(card);

  const update = (disabled: boolean): void => {
    for (const button of buttons) button.update({ disabled });
  };

  return {
    update,
    dispose: () => {
      for (const button of buttons) button.dispose();
      card.remove();
    },
  };
};

type FieldControl = {
  setDisabled: (disabled: boolean) => void;
  dispose: () => void;
};

const fieldControl = (
  field: OpencodeQuestionField,
  container: HTMLElement,
  answers: Map<string, OpencodeQuestionAnswer>,
  onChange: () => void,
): FieldControl => {
  const options = field.options.length > 0
    ? field.options.map((option) => ({ value: option.value, label: option.label }))
    : field.type === 'boolean'
      ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
      : [];

  const choiceRow = el('div', 'choice-row');
  container.append(choiceRow);
  let choiceHandles: ButtonHandle[] = [];
  let disabled = false;

  const isChosen = (value: string): boolean => {
    const answer = answers.get(field.key);
    if (field.type === 'multiselect') return Array.isArray(answer) && answer.includes(value);
    if (field.type === 'boolean') return answer === (value === 'true');
    return answer === value;
  };

  const paintChoices = (): void => {
    for (const handle of choiceHandles) handle.dispose();
    choiceHandles = [];
    choiceRow.replaceChildren();
    for (const option of options) {
      const slot = el('div', 'slot');
      choiceRow.append(slot);
      choiceHandles.push(mountButton(slot, {
        label: option.label,
        size: 'xs',
        variant: isChosen(option.value) ? 'default' : 'outline',
        disabled,
        onClick: () => choose(option.value),
      }));
    }
  };

  const choose = (value: string): void => {
    if (field.type === 'multiselect') {
      const current = answers.get(field.key);
      const list = Array.isArray(current) ? [...current] : [];
      const at = list.indexOf(value);
      if (at >= 0) list.splice(at, 1);
      else list.push(value);
      answers.set(field.key, list);
    } else if (field.type === 'boolean') {
      answers.set(field.key, value === 'true');
    } else {
      answers.set(field.key, value);
    }
    paintChoices();
    onChange();
  };

  paintChoices();

  let text: TextFieldHandle | null = null;
  if (options.length === 0) {
    const inputRoot = el('div', 'request-input');
    container.append(inputRoot);
    const raw = answers.get(field.key);
    text = mountTextField(inputRoot, {
      value: raw === undefined || Array.isArray(raw) ? '' : String(raw),
      placeholder: field.type === 'number' || field.type === 'integer' ? 'Number' : 'Type an answer',
      disabled,
      onChange: (value) => {
        if (!value.trim()) {
          answers.delete(field.key);
        } else {
          const numeric = Number(value);
          answers.set(field.key, (field.type === 'number' || field.type === 'integer') && Number.isFinite(numeric)
            ? numeric
            : value);
        }
        onChange();
      },
    });
  }

  return {
    setDisabled: (next) => {
      if (next === disabled) return;
      disabled = next;
      paintChoices();
      text?.update({ disabled: next });
    },
    dispose: () => {
      for (const handle of choiceHandles) handle.dispose();
      text?.dispose();
    },
  };
};

export const createQuestionCard = (
  root: HTMLElement,
  request: OpencodeQuestionRequest,
  onSubmit: (questionId: string, answer: Record<string, OpencodeQuestionAnswer>) => void,
  onOpenUrl?: (url: string) => void,
): RequestCard => {
  const { card, actions } = cardShell(request.title, null);
  const fields = request.fields.filter((field) => !field.hidden);
  const answers = new Map<string, OpencodeQuestionAnswer>();
  for (const field of fields) {
    if (field.default !== null) answers.set(field.key, field.default);
  }

  let blocked = false;
  let submitting = false;
  const controls: FieldControl[] = [];
  const external: ButtonHandle[] = [];
  let submit: ButtonHandle | null = null;

  const complete = (): boolean => {
    if (submitting || answers.size === 0) return false;
    return fields.every((field) => {
      if (!field.required) return true;
      const value = answers.get(field.key);
      if (value === undefined || value === '') return false;
      return !(Array.isArray(value) && value.length === 0);
    });
  };

  const refresh = (): void => {
    submit?.update({ disabled: blocked || !complete(), loading: submitting });
  };

  const collect = (): Record<string, OpencodeQuestionAnswer> => {
    const answer: Record<string, OpencodeQuestionAnswer> = {};
    for (const field of fields) {
      const value = answers.get(field.key);
      if (value === undefined || value === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;
      answer[field.key] = value;
    }
    return answer;
  };

  for (const field of fields) {
    const block = el('div', 'request-field');
    block.append(el('div', 'request-label', field.title));
    if (field.description) block.append(el('div', 'hint', field.description));
    controls.push(fieldControl(field, block, answers, refresh));

    if (field.url && onOpenUrl) {
      const slot = el('div', 'slot');
      block.append(slot);
      external.push(mountButton(slot, {
        label: 'Open',
        size: 'xs',
        variant: 'ghost',
        onClick: () => onOpenUrl(field.url ?? ''),
      }));
    }
    card.insertBefore(block, actions);
  }

  const submitSlot = el('div', 'slot');
  actions.append(submitSlot);
  submit = mountButton(submitSlot, {
    label: 'Submit',
    size: 'sm',
    disabled: !complete(),
    onClick: () => {
      if (!complete()) return;
      submitting = true;
      refresh();
      onSubmit(request.id, collect());
    },
  });

  root.append(card);
  refresh();

  const update = (disabled: boolean): void => {
    blocked = disabled;
    for (const control of controls) control.setDisabled(disabled);
    for (const button of external) button.update({ disabled });
    refresh();
  };

  return {
    update,
    dispose: () => {
      for (const control of controls) control.dispose();
      for (const button of external) button.dispose();
      submit?.dispose();
      card.remove();
    },
  };
};

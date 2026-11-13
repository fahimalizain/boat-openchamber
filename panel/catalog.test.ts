import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OpencodeCatalog, OpencodeModel, OpencodeSession } from '../shared/opencode.ts';
import {
  agentChoices,
  findModel,
  groupModels,
  modelChoices,
  modelKey,
  modelRefFromKey,
  modelRefWithVariant,
  selectionForSession,
  settleSelection,
  variantsOf,
} from './catalog.ts';

const model = (overrides: Partial<OpencodeModel> = {}): OpencodeModel => ({
  id: 'big',
  providerID: 'acme',
  providerName: 'Acme',
  name: 'Big',
  type: 'chat',
  variants: [],
  reasoning: false,
  tools: true,
  imageInput: null,
  contextLimit: null,
  outputLimit: null,
  enabled: true,
  ...overrides,
});

const catalog = (overrides: Partial<OpencodeCatalog> = {}): OpencodeCatalog => ({
  directory: '/home/user/app',
  directories: ['/home/user/app', '/home/user'],
  agents: [
    { id: 'build', name: 'Build', description: null, mode: 'primary', hidden: false, model: null },
    { id: 'plan', name: 'Plan', description: null, mode: 'primary', hidden: false, model: null },
    { id: 'hidden', name: 'Hidden', description: null, mode: 'primary', hidden: true, model: null },
    { id: 'sub', name: 'Sub', description: null, mode: 'subagent', hidden: false, model: null },
  ],
  providers: [{ id: 'acme', name: 'Acme' }],
  models: [model()],
  defaultAgent: 'build',
  defaultModel: { id: 'big', providerID: 'acme', variant: null },
  ...overrides,
});

test('model keys keep providers apart', () => {
  assert.equal(modelKey({ id: 'big', providerID: 'acme' }), 'acme/big');
  assert.deepEqual(modelRefFromKey('acme/big'), { id: 'big', providerID: 'acme', variant: null });
  assert.deepEqual(modelRefFromKey('acme/vendor/big'), { id: 'vendor/big', providerID: 'acme', variant: null });
  assert.equal(modelRefFromKey('nodash'), null);
  assert.equal(modelRefFromKey('/big'), null);
});

test('models group by provider, enabled only, sorted', () => {
  const groups = groupModels([
    model({ id: 'zeta', name: 'Zeta', providerID: 'zeta', providerName: 'Zeta Co' }),
    model({ id: 'small', name: 'Small' }),
    model({ id: 'big', name: 'Big' }),
    model({ id: 'off', name: 'Off', enabled: false }),
    model({ id: 'other', name: 'Other', providerID: 'beta', providerName: 'Beta' }),
  ]);

  assert.deepEqual(groups.map((group) => group.providerID), ['acme', 'beta', 'zeta']);
  assert.deepEqual(groups[0]?.models.map((entry) => entry.id), ['big', 'small']);
  assert.deepEqual(modelChoices(groups).map((choice) => choice.id), ['acme/big', 'acme/small', 'beta/other', 'zeta/zeta']);
  assert.equal(modelChoices(groups)[0]?.hint, 'Acme');
});

test('agents offer primaries first, and fall back to every visible agent', () => {
  assert.deepEqual(agentChoices(catalog()).map((agent) => agent.id), ['build', 'plan']);
  assert.deepEqual(
    agentChoices(catalog({
      agents: [{ id: 'sub', name: 'Sub', description: null, mode: 'subagent', hidden: false, model: null }],
    })).map((agent) => agent.id),
    ['sub'],
  );
  assert.deepEqual(agentChoices(null), []);
});

test('a remembered pick the catalogue lost settles on its defaults', () => {
  const settled = settleSelection({
    agent: 'gone',
    model: { id: 'gone', providerID: 'acme', variant: null },
    variant: 'high',
  }, catalog());

  assert.equal(settled.agent, 'build');
  assert.deepEqual(settled.model, { id: 'big', providerID: 'acme', variant: null });
  assert.equal(settled.variant, null);
});

test('a valid pick and reasoning variant survive settling', () => {
  const reasoning = model({ id: 'thinking', name: 'Thinking', variants: ['low', 'high'], reasoning: true });
  const settled = settleSelection({
    agent: 'plan',
    model: { id: 'thinking', providerID: 'acme', variant: null },
    variant: 'high',
  }, catalog({ models: [model(), reasoning], defaultModel: null }));

  assert.equal(settled.agent, 'plan');
  assert.deepEqual(settled.model, { id: 'thinking', providerID: 'acme', variant: null });
  assert.equal(settled.variant, 'high');
  assert.deepEqual(variantsOf([model(), reasoning], settled.model), ['low', 'high']);
  assert.equal(findModel([model()], settled.model), null);

  assert.equal(settleSelection({
    agent: 'plan',
    model: { id: 'thinking', providerID: 'acme', variant: null },
    variant: 'default',
  }, catalog({ models: [reasoning] })).variant, null);
});

test('without a catalogue the remembered pick is left alone', () => {
  const selection = { agent: 'plan', model: { id: 'x', providerID: 'y', variant: null }, variant: 'low' };
  assert.equal(settleSelection(selection, null), selection);
});

test('opening a session shows the agent and model it already uses', () => {
  const thinking = model({ id: 'thinking', name: 'Thinking', variants: ['low', 'high'], reasoning: true });
  const session: OpencodeSession = {
    id: 'ses_abc123',
    title: null,
    directory: '/home/user/app',
    projectID: null,
    agent: 'plan',
    model: { id: 'thinking', providerID: 'acme', variant: 'high' },
    createdAt: 0,
    updatedAt: 0,
    busyAt: null,
    idleAt: null,
    archived: false,
    outcome: null,
    status: 'idle',
    cost: 0,
  };
  const selection = selectionForSession(
    session,
    { agent: 'build', model: modelRefFromKey('acme/big'), variant: null },
    catalog({ models: [model(), thinking] }),
  );

  assert.equal(selection.agent, 'plan');
  assert.deepEqual(selection.model, { id: 'thinking', providerID: 'acme', variant: null });
  assert.equal(selection.variant, 'high');
  assert.deepEqual(modelRefWithVariant(selection.model, 'low'), {
    id: 'thinking',
    providerID: 'acme',
    variant: 'low',
  });
  assert.equal(modelRefWithVariant(null, 'low'), null);
});

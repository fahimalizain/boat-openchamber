import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agentOptions,
  fallbackAgents,
  parseAgentCatalog,
  providerForHarness,
} from './agent-catalog.ts';

/** A trimmed copy of the real `provider-models` response. */
const RAW = {
  'claude-code': {
    cli: { name: 'claude', description: 'Claude Code', aliases: ['claude', 'claude-code'], order: 2 },
    models: [
      {
        id: 'opus-5-5',
        label: 'Opus 5.5',
        sdkId: 'claude-opus-5-5',
        fastMode: true,
        credentialIds: ['claude-subscription', 'anthropic-api-key'],
        reasoningEffort: { supported: ['low', 'high', 'max'], default: 'high' },
      },
      {
        id: 'claude-fable-5',
        label: 'Claude Fable 5',
        credentialIds: ['anthropic-api-key'],
      },
    ],
  },
  codex: {
    cli: { name: 'codex', description: 'OpenAI Codex / ChatGPT', aliases: ['codex'], order: 1 },
    models: [
      {
        id: 'gpt-6.1-sol',
        label: 'GPT-6.1 Sol',
        fastMode: true,
        credentialIds: ['chatgpt-subscription', 'openai-api-key'],
        reasoningEffort: { supported: ['low', 'high'], default: 'low' },
      },
    ],
  },
};

test('the catalogue parses providers, models, order and reasoning', () => {
  const agents = parseAgentCatalog(RAW);

  assert.deepEqual(agents.map((agent) => agent.provider), ['codex', 'claude']);
  const claude = agents.find((agent) => agent.provider === 'claude');
  assert.equal(claude?.harness, 'claude-code');
  assert.equal(claude?.label, 'Claude Code');
  assert.deepEqual(claude?.aliases, ['claude', 'claude-code']);
  assert.equal(claude?.models[0]?.reasoning?.supported.length, 3);
  assert.equal(claude?.models[0]?.reasoning?.default, 'high');
  assert.equal(claude?.models[0]?.fast, true);
  assert.equal(claude?.models[1]?.reasoning, null);
});

test('availability follows the connected credentials', () => {
  const agents = parseAgentCatalog(RAW);
  const options = agentOptions(agents, new Set(['claude-subscription']));

  const claude = options.find((agent) => agent.provider === 'claude');
  const codex = options.find((agent) => agent.provider === 'codex');
  assert.equal(claude?.available, true);
  assert.equal(claude?.models.find((model) => model.id === 'opus-5-5')?.available, true);
  assert.equal(claude?.models.find((model) => model.id === 'claude-fable-5')?.available, false);
  assert.equal(codex?.available, false);
  assert.equal(codex?.models[0]?.available, false);

  const unknown = agentOptions(agents, null);
  assert.equal(unknown.every((agent) => agent.available), true);
});

test('a fallback agent with no models stays usable', () => {
  const options = agentOptions(fallbackAgents(), new Set(['claude-subscription']));
  assert.equal(options.length, 7);
  assert.ok(options.every((agent) => agent.available));
});

test('the conversation harness maps to the CLI provider', () => {
  const agents = parseAgentCatalog(RAW);
  assert.equal(providerForHarness(agents, 'claude-code'), 'claude');
  assert.equal(providerForHarness(agents, 'claude'), 'claude');
  assert.equal(providerForHarness(agents, 'codex'), 'codex');
  assert.equal(providerForHarness(fallbackAgents(), 'prime-agent'), 'prime');
  assert.equal(providerForHarness(agents, 'unknown-agent'), null);
  assert.equal(providerForHarness(agents, null), null);
});

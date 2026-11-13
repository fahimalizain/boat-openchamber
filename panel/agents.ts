/** Sorting and lookups for the agent/model selects. */
import type { AgentDto, AgentModel } from '../shared/routes.ts';

/** Available agents first, each group by `order`. */
export const sortAgents = (agents: AgentDto[]): AgentDto[] => (
  [...agents].sort((left, right) => (
    Number(!left.available) - Number(!right.available) || left.order - right.order
  ))
);

export const defaultProvider = (agents: AgentDto[]): string | null => (
  sortAgents(agents)[0]?.provider ?? null
);

/** The agent's models, available ones first. */
export const modelsOf = (agents: AgentDto[], provider: string | null): AgentModel[] => {
  const agent = agents.find((entry) => entry.provider === provider);
  if (!agent) return [];
  return [...agent.models].sort((left, right) => Number(!left.available) - Number(!right.available));
};

export const modelOf = (agents: AgentDto[], provider: string | null, modelId: string): AgentModel | null => (
  modelId ? modelsOf(agents, provider).find((model) => model.id === modelId) ?? null : null
);

/** The reasoning levels to offer, or null when this model has none. */
export const reasoningOf = (
  agents: AgentDto[],
  provider: string | null,
  modelId: string,
): AgentModel['reasoning'] => modelOf(agents, provider, modelId)?.reasoning ?? null;

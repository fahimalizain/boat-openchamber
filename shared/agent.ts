/** The coding-agent harnesses `boat prompt --provider` accepts. */
export const AGENT_PROVIDERS = ['claude', 'codex', 'pi', 'opencode', 'prime', 'kimi', 'mistral'] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const isAgentProvider = (value: string): value is AgentProvider => (
  (AGENT_PROVIDERS as readonly string[]).includes(value)
);

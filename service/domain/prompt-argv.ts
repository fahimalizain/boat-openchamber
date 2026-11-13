/** The prompt argv, so the CLI flags stay testable in one place. */
export type PromptOptions = {
  provider?: string;
  model?: string;
  reasoning?: string;
  /** Continue this conversation instead of starting one. */
  conversation?: string;
  newConversation?: boolean;
};

export const promptCommand = (
  sandboxId: string,
  text: string,
  options: PromptOptions,
): string[] => {
  const args = [sandboxId];
  if (options.newConversation) args.push('--new');
  if (options.conversation) args.push('--resume', options.conversation);
  if (options.provider) args.push('--provider', options.provider);
  if (options.model) args.push('--model', options.model);
  if (options.reasoning) args.push('--reasoning-effort', options.reasoning);
  args.push('--', text);
  return args;
};

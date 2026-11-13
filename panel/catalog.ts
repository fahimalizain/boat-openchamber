/**
 * The OpenCode catalogue as the pickers need it: models grouped by provider and
 * keyed `providerID/id`, agents worth showing, and the rule that settles a
 * remembered choice against what the sandbox actually offers.
 */
import type {
  OpencodeCatalog,
  OpencodeModel,
  OpencodeModelRef,
  OpencodeSession,
} from '../shared/opencode.ts';

export type ModelChoice = {
  id: string;
  label: string;
  hint?: string;
};

export type AgentChoice = {
  id: string;
  label: string;
};

/** Model ids repeat across providers; the pair is the identity. */
export const modelKey = (model: { providerID: string; id: string }): string => (
  `${model.providerID}/${model.id}`
);

/** The provider id is the first segment; a model id may carry slashes of its own. */
export const modelRefFromKey = (key: string): OpencodeModelRef | null => {
  const slash = key.indexOf('/');
  if (slash <= 0 || slash >= key.length - 1) return null;
  return { id: key.slice(slash + 1), providerID: key.slice(0, slash), variant: null };
};

export type ModelGroup = {
  providerID: string;
  providerName: string;
  models: OpencodeModel[];
};

/** Enabled models, grouped and sorted by provider name, then model name. */
export const groupModels = (models: OpencodeModel[]): ModelGroup[] => {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    if (!model.enabled) continue;
    const group = groups.get(model.providerID) ?? {
      providerID: model.providerID,
      providerName: model.providerName || model.providerID,
      models: [],
    };
    group.models.push(model);
    groups.set(model.providerID, group);
  }

  const list = [...groups.values()];
  for (const group of list) {
    group.models.sort((left, right) => (
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    ));
  }
  return list.sort((left, right) => (
    left.providerName.localeCompare(right.providerName) || left.providerID.localeCompare(right.providerID)
  ));
};

/** A flat option list for the kit's select; the provider rides along as the hint. */
export const modelChoices = (groups: ModelGroup[]): ModelChoice[] => groups.flatMap((group) => (
  group.models.map((model) => ({
    id: modelKey(model),
    label: model.name,
    hint: group.providerName,
  }))
));

export const findModel = (models: OpencodeModel[], ref: OpencodeModelRef | null): OpencodeModel | null => {
  if (!ref) return null;
  return models.find((model) => model.providerID === ref.providerID && model.id === ref.id) ?? null;
};

export const variantsOf = (models: OpencodeModel[], ref: OpencodeModelRef | null): string[] => (
  findModel(models, ref)?.variants ?? []
);

/** Visible primary agents, or every visible agent when none claims primary. */
export const agentChoices = (catalog: OpencodeCatalog | null): AgentChoice[] => {
  const agents = (catalog?.agents ?? []).filter((agent) => !agent.hidden);
  const primary = agents.filter((agent) => agent.mode === 'primary');
  return (primary.length > 0 ? primary : agents).map((agent) => ({ id: agent.id, label: agent.name }));
};

export type Selection = {
  agent: string;
  model: OpencodeModelRef | null;
  variant: string | null;
};

export const modelRefWithVariant = (model: OpencodeModelRef | null, variant: string | null): OpencodeModelRef | null => (
  model ? { id: model.id, providerID: model.providerID, variant: variant || null } : null
);

const defaultModelOf = (catalog: OpencodeCatalog): OpencodeModelRef | null => {
  const preferred = findModel(catalog.models, catalog.defaultModel);
  if (preferred) return { id: preferred.id, providerID: preferred.providerID, variant: null };
  const first = catalog.models.find((model) => model.enabled) ?? null;
  return first ? { id: first.id, providerID: first.providerID, variant: null } : null;
};

/**
 * Drops a remembered agent, model or variant the catalogue no longer offers,
 * and fills an empty pick with the sandbox's default. `default` as a variant
 * means "no reasoning level", as OpenCode sometimes reports it.
 */
export const settleSelection = (selection: Selection, catalog: OpencodeCatalog | null): Selection => {
  if (!catalog) return selection;

  const agents = agentChoices(catalog);
  const chosenAgent = agents.some((agent) => agent.id === selection.agent)
    ? selection.agent
    : catalog.defaultAgent && agents.some((agent) => agent.id === catalog.defaultAgent)
      ? catalog.defaultAgent
      : agents[0]?.id ?? '';

  const chosen = findModel(catalog.models, selection.model);
  const model = chosen
    ? { id: chosen.id, providerID: chosen.providerID, variant: null }
    : defaultModelOf(catalog);
  const variants = variantsOf(catalog.models, model);
  const variant = selection.variant && variants.includes(selection.variant) ? selection.variant : null;

  return { agent: chosenAgent, model, variant };
};

/** Opening a session shows the agent and model that session already uses. */
export const selectionForSession = (
  session: OpencodeSession,
  current: Selection,
  catalog: OpencodeCatalog | null,
): Selection => settleSelection({
  agent: session.agent ?? current.agent,
  model: session.model ?? current.model,
  variant: session.model?.variant ?? current.variant,
}, catalog);

/** The short label the chat header and composer hint use. */
export const modelLabel = (model: OpencodeModelRef | null): string => {
  if (!model) return 'Default model';
  return model.variant && model.variant !== 'default' ? `${model.id} · ${model.variant}` : model.id;
};

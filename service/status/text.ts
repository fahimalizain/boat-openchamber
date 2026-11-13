/** The terse sandbox list every agent session receives, globally or per project. */
import { clip } from '../../shared/json.ts';
import { isUpState, type Sandbox } from '../../shared/types.ts';

const TEXT_MAX = 4_000;
const SANDBOXES_SHOWN = 12;

const COMMANDS_LINE = 'Run commands with `boat exec <id> -- <command>`. Ask a sandbox agent with `boat prompt <id> --provider <claude|codex|opencode|pi|kimi|mistral|prime> --model <model> [--new | --resume <conversation>] "<text>"`; add to a running turn with `boat steer <id> --convo <conversation> "<text>"`, stop it with `boat interrupt <id>`. Pass `--json --no-update` to every command.';

const sizeOf = (sandbox: Sandbox): string => {
  const parts = [sandbox.type, sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`].filter(Boolean);
  return parts.join(' ');
};

const leftOf = (sandbox: Sandbox, now: number): string | null => {
  if (!isUpState(sandbox.state) || !sandbox.archiveAfter) return null;
  const deadline = Date.parse(sandbox.archiveAfter);
  if (!Number.isFinite(deadline)) return null;
  const minutes = Math.max(0, Math.round((deadline - now) / 60_000));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
};

const sandboxLine = (sandbox: Sandbox, now: number): string => {
  const details = [sandbox.state, sizeOf(sandbox), leftOf(sandbox, now)].filter(Boolean).join(', ');
  return `- ${sandbox.id} "${sandbox.name}": ${details}`;
};

export const buildInstructions = (sandboxes: Sandbox[], now: number, failure: string | null = null): string => {
  if (failure && sandboxes.length === 0) {
    return clip(`Boat cloud sandboxes are unavailable. ${failure}`, 1_000);
  }

  const lines = ['Boat sandboxes (boat.dev) managed by the Boat extension, reachable with the `boat` CLI:'];
  const shown = sandboxes.slice(0, SANDBOXES_SHOWN);

  if (shown.length === 0) {
    lines.push('- none right now. Create one with `boat new`.');
  } else {
    for (const sandbox of shown) lines.push(sandboxLine(sandbox, now));
    if (sandboxes.length > shown.length) {
      lines.push(`- and ${sandboxes.length - shown.length} more (see \`boat list\`).`);
    }
  }

  lines.push(COMMANDS_LINE);
  return clip(lines.join('\n'), TEXT_MAX);
};

/** Instructions for one project, naming its sandboxes first. */
export const buildProjectInstructions = (
  projectName: string,
  sandboxes: Sandbox[],
  now: number,
): string => {
  const lines = [`Boat sandboxes for the "${projectName}" project (boat.dev):`];
  const shown = sandboxes.slice(0, SANDBOXES_SHOWN);

  if (shown.length === 0) {
    lines.push(`- none for this project. Pin one with the \`openchamber.project\` label, or add this repository to its boat environment.`);
  } else {
    for (const sandbox of shown) lines.push(sandboxLine(sandbox, now));
    if (sandboxes.length > shown.length) {
      lines.push(`- and ${sandboxes.length - shown.length} more (see \`boat list\`).`);
    }
  }

  lines.push(COMMANDS_LINE);
  return clip(lines.join('\n'), TEXT_MAX);
};

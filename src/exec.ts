import { environment, exec, join, spawn, tmpdir, writeFileSync } from "./node";
import type { ChipTemplate, ToolConfig } from "./settings";

/** Replace {{var}} placeholders. Unknown placeholders are left untouched. */
export function substitute(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
		name in vars ? vars[name] : match
	);
}

/**
 * Quote a value as a single double-quoted shell argument.
 * Newlines are flattened to spaces — pass multiline content via a prompt file.
 */
export function quoteArg(value: string): string {
	const flat = value.replace(/\r?\n/g, " ").trim();
	return '"' + flat.replace(/(["\\])/g, "\\$1") + '"';
}

/**
 * Expand a raw variable map into template variables: each key is provided
 * quoted ({{key}}) and unquoted ({{keyRaw}}).
 */
export function shellVars(raw: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		out[key] = quoteArg(value);
		out[key + "Raw"] = value;
	}
	return out;
}

/**
 * Every tool this device can actually launch, most likely first: the chip's own
 * tool if it names one, else the shared default. That first entry is the
 * primary button on the confirmation dialog.
 *
 * A tool whose command template is empty is not offered. It is a name in the
 * settings file rather than something that runs, and a button that can only
 * fail is worse than no button.
 */
export function toolChoices(
	chip: ChipTemplate,
	tools: Record<string, ToolConfig>,
	defaultTool: string
): string[] {
	const configured = Object.keys(tools).filter(
		(name) => (tools[name]?.command ?? "").trim() !== ""
	);
	const preferred = chip.tool || defaultTool;
	return configured.includes(preferred)
		? [preferred, ...configured.filter((name) => name !== preferred)]
		: configured;
}

/**
 * The prompt template this tool wants for this chip.
 *
 * A chip carries an intent, not a tool-specific string: `/refine US1` and
 * `$refine US1` are the same intention spelled for two agents. The override is
 * keyed by {@link ChipTemplate.intent} and falls back to the label, so a chip
 * that never declares an intent still works — and a device that configures no
 * override keeps the note's own prompt, exactly as before.
 */
export function resolvePrompt(
	chip: ChipTemplate,
	toolName: string,
	tools: Record<string, ToolConfig>
): string {
	const key = chip.intent || chip.label;
	return tools[toolName]?.prompts?.[key] || chip.prompt;
}

/**
 * Variables the template references that resolve empty for this launch — e.g.
 * {{id}} on a note with no ticket id, which would launch "/refine " with no
 * argument. Only variables the caller supplies are checked: an unknown {{var}}
 * is left literal by substitute() and is a visibly different problem.
 */
export function emptyVars(template: string, values: Record<string, string>): string[] {
	const names = [...template.matchAll(/\{\{(\w+)\}\}/g)]
		.map((m) => m[1])
		.filter((name) => name in values && values[name].trim() === "");
	return [...new Set(names)];
}

/** Write a prompt to a temp file and return its absolute path. */
export function writePromptFile(prompt: string): string {
	const file = join(tmpdir(), `dispatch-prompt-${Date.now()}.md`);
	writeFileSync(file, prompt, "utf8");
	return file;
}

/** Fire-and-forget launch (chips): opens a terminal/tool and detaches. */
export function launchDetached(
	command: string,
	cwd: string,
	onError: (err: Error) => void,
	env?: Record<string, string>
): void {
	const child = spawn(command, {
		shell: true,
		cwd,
		detached: true,
		stdio: "ignore",
		env: env ? { ...environment(), ...env } : undefined,
	});
	child.on("error", onError);
	child.unref();
}

/** Run a hook command to completion and report the result. */
export function runHook(
	command: string,
	cwd: string,
	done: (err: Error | null, output: string) => void
): void {
	exec(command, { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
		done(err, `${stdout}${stderr}`.trim());
	});
}

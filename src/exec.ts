import { exec, spawn } from "child_process";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
		env: env ? { ...process.env, ...env } : undefined,
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

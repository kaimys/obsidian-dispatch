#!/usr/bin/env node
/**
 * Portable validation gate for a repository scaffolded by dispatch-setup.
 *
 * Copy to scripts/dispatch/validate.mjs. With no arguments it verifies the
 * committed project surface. During setup pass --device <path> (or launch it
 * from a chip, which supplies DISPATCH_LOCAL_SETTINGS) to verify the device and
 * vault configuration too.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedPrefixes = { claude: "/", codex: "$" };

function readJson(path, errors) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}

function markdownFiles(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return markdownFiles(path);
		return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
	});
}

function requirePath(path, errors) {
	if (!existsSync(path)) errors.push(`missing ${path}`);
}

function validatePlaceholders(paths, errors) {
	for (const path of paths) {
		if (readFileSync(path, "utf8").includes("<<")) errors.push(`unresolved placeholder in ${path}`);
	}
}

function commandName(prompt) {
	return /^[/$]([a-z][a-z0-9-]*)\b/.exec(prompt)?.[1] ?? "";
}

function commandTemplates(shared) {
	return [
		...(shared?.chips?.templates ?? []),
		...(shared?.meetings?.templates ?? []),
		...(shared?.meetings?.calendarChips ?? []),
	].filter((template) => commandName(template?.prompt ?? ""));
}

function findVault(local) {
	for (const value of Object.values(local?.repos ?? {})) {
		if (typeof value !== "string") continue;
		const config = join(value, ".obsidian", "plugins", "dispatch", "data.json");
		if (existsSync(config)) return { root: value, config };
	}
	return null;
}

export function validateSetup(repoRoot, deviceFile = "") {
	const root = resolve(repoRoot);
	const errors = [];
	const workflowDir = join(root, "dispatch", "workflow");
	const workflowFiles = markdownFiles(workflowDir);

	requirePath(join(root, "dispatch", "invariants.md"), errors);
	requirePath(join(root, "scripts", "dispatch", "run-state.mjs"), errors);
	validatePlaceholders([
		...workflowFiles,
		...markdownFiles(join(root, ".claude", "commands")),
		...markdownFiles(join(root, ".codex", "skills")),
	], errors);

	for (const path of [join(root, ".claude", "settings.json"), join(root, ".codex", "hooks.json")]) {
		if (existsSync(path)) readJson(path, errors);
	}
	const gate = join(root, "scripts", "dispatch", "validate.mjs");
	if (workflowFiles.some((path) => readFileSync(path, "utf8").includes("node scripts/dispatch/validate.mjs"))) {
		requirePath(gate, errors);
	}

	if (!deviceFile) return errors;
	const devicePath = resolve(deviceFile);
	const local = readJson(devicePath, errors);
	if (!local) return errors;
	const tools = Object.entries(local.tools ?? {});
	if (tools.length === 0) errors.push(`${devicePath}: no tools configured`);
	for (const [name, config] of tools) {
		if (!config || typeof config.command !== "string" || !config.command.trim()) {
			errors.push(`${devicePath}: tool ${name} has no command`);
		} else if (!config.command.includes("{{prompt}}") && !config.command.includes("{{promptFile}}")) {
			errors.push(`${devicePath}: tool ${name} command does not pass {{prompt}} or {{promptFile}}`);
		}
		const expected = expectedPrefixes[name];
		if (expected && config?.promptPrefix !== expected) {
			errors.push(`${devicePath}: tool ${name} needs promptPrefix ${JSON.stringify(expected)}`);
		}
	}
	if (tools.length > 1 && local.confirmBeforeRun !== true) {
		errors.push(`${devicePath}: multi-agent setup needs confirmBeforeRun true so one chip can choose either agent`);
	}
	for (const [alias, path] of Object.entries(local.repos ?? {})) {
		let directory = false;
		try {
			directory = typeof path === "string" && existsSync(path) && statSync(path).isDirectory();
		} catch {
			directory = false;
		}
		if (!directory) {
			errors.push(`${devicePath}: repo alias ${alias} does not resolve to a directory`);
		}
	}

	const vault = findVault(local);
	if (!vault) {
		errors.push(`${devicePath}: no repo alias points at a vault with .obsidian/plugins/dispatch/data.json`);
		return errors;
	}
	const shared = readJson(vault.config, errors);
	if (!shared) return errors;
	const templates = commandTemplates(shared);
	const intents = new Set();
	for (const template of templates) {
		const name = commandName(template.prompt);
		if (tools.length > 1) {
			if (template.tool) errors.push(`${vault.config}: multi-agent command chip ${template.label} must omit tool`);
			if (!template.intent) errors.push(`${vault.config}: multi-agent command chip ${template.label} needs intent`);
		}
		if (template.intent) {
			if (intents.has(template.intent)) errors.push(`${vault.config}: duplicate command-chip intent ${template.intent}`);
			intents.add(template.intent);
		}
		if (template.repo && !local.repos?.[template.repo]) {
			errors.push(`${vault.config}: chip ${template.label} uses unknown repo alias ${template.repo}`);
		}
		if (template.tool && !local.tools?.[template.tool]) {
			errors.push(`${vault.config}: chip ${template.label} uses unknown tool ${template.tool}`);
		}
		if (!existsSync(join(workflowDir, `${name}.md`))) {
			errors.push(`${vault.config}: chip ${template.label} invokes missing workflow ${name}`);
		}
		if (local.tools?.claude) {
			requirePath(join(root, ".claude", "commands", `${name}.md`), errors);
		}
		if (local.tools?.codex) {
			requirePath(join(root, ".codex", "skills", name, "SKILL.md"), errors);
		}
		for (const [tool, config] of tools) {
			const prefix = config?.promptPrefix;
			const resolved = prefix && prefix !== "/" ? prefix + template.prompt.slice(1) : template.prompt;
			if (expectedPrefixes[tool] && !resolved.startsWith(expectedPrefixes[tool] + name)) {
				errors.push(`${vault.config}: chip ${template.label} does not resolve for ${tool}`);
			}
		}
	}

	if (local.tools?.claude) {
		requirePath(join(root, "CLAUDE.md"), errors);
		requirePath(join(root, ".claude", "settings.json"), errors);
	}
	if (local.tools?.codex) {
		requirePath(join(root, "AGENTS.md"), errors);
		requirePath(join(root, ".codex", "hooks.json"), errors);
	}
	return errors;
}

function option(name) {
	const index = process.argv.indexOf(name);
	if (index < 0) return "";
	if (!process.argv[index + 1]) throw new Error(`${name} needs a path`);
	return process.argv[index + 1];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	try {
		const device = option("--device") || process.env.DISPATCH_LOCAL_SETTINGS || "";
		const errors = validateSetup(process.cwd(), device);
		if (errors.length > 0) {
			console.error(`Dispatch setup validation failed (${errors.length}):\n- ${errors.join("\n- ")}`);
			process.exitCode = 1;
		} else {
			console.log(`Dispatch setup valid (${device ? "project + device" : "project only"})`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

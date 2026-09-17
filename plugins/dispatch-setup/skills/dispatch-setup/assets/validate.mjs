#!/usr/bin/env node
/**
 * Portable validation gate for a repository scaffolded by dispatch-setup.
 *
 * Copy to scripts/dispatch/validate.mjs. With no arguments it verifies the
 * committed project surface. During setup pass both --device <path> and
 * --vault <path> to verify the device and vault configuration too.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
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

export function resolveToolPrompt(template, toolName, tools) {
	const tool = tools[toolName];
	const override = tool?.prompts?.[template.intent || template.label];
	if (override) return override;
	const prefix = tool?.promptPrefix;
	if (prefix && prefix !== "/" && template.prompt.startsWith("/")) {
		return prefix + template.prompt.slice(1);
	}
	return template.prompt;
}

export function validateSetup(repoRoot, deviceFile = "", vaultRoot = "") {
	const root = resolve(repoRoot);
	const errors = [];
	const workflowDir = join(root, "dispatch", "workflow");
	const workflowFiles = markdownFiles(workflowDir);
	const invariants = join(root, "dispatch", "invariants.md");
	const pointers = [join(root, "CLAUDE.md"), join(root, "AGENTS.md")];
	const agentFiles = [
		...markdownFiles(join(root, ".claude", "commands")),
		...markdownFiles(join(root, ".codex", "skills")),
	];
	const projectMarkdown = [invariants, ...workflowFiles, ...pointers, ...agentFiles].filter(existsSync);

	requirePath(invariants, errors);
	requirePath(join(root, "scripts", "dispatch", "run-state.mjs"), errors);
	validatePlaceholders(projectMarkdown, errors);

	for (const path of [join(root, ".claude", "settings.json"), join(root, ".codex", "hooks.json")]) {
		if (existsSync(path)) readJson(path, errors);
	}
	const gate = join(root, "scripts", "dispatch", "validate.mjs");
	if (projectMarkdown.some((path) => readFileSync(path, "utf8").includes("node scripts/dispatch/validate.mjs"))) {
		requirePath(gate, errors);
	}

	if (!deviceFile && !vaultRoot) return errors;
	if (!deviceFile || !vaultRoot) {
		errors.push("device validation requires both --device <path> and --vault <path>");
		return errors;
	}
	const devicePath = resolve(deviceFile);
	const vaultPath = resolve(vaultRoot);
	const vaultConfig = join(vaultPath, ".obsidian", "plugins", "dispatch", "data.json");
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

	if (!existsSync(vaultConfig)) {
		errors.push(`missing ${vaultConfig}`);
		return errors;
	}
	const shared = readJson(vaultConfig, errors);
	if (!shared) return errors;
	const templates = commandTemplates(shared);
	const intents = new Set();
	for (const template of templates) {
		const name = commandName(template.prompt);
		if (tools.length > 1) {
			if (template.tool) errors.push(`${vaultConfig}: multi-agent command chip ${template.label} must omit tool`);
			if (!template.intent) errors.push(`${vaultConfig}: multi-agent command chip ${template.label} needs intent`);
		}
		if (template.intent) {
			if (intents.has(template.intent)) errors.push(`${vaultConfig}: duplicate command-chip intent ${template.intent}`);
			intents.add(template.intent);
		}
		if (template.repo && !local.repos?.[template.repo]) {
			errors.push(`${vaultConfig}: chip ${template.label} uses unknown repo alias ${template.repo}`);
		}
		if (template.tool && !local.tools?.[template.tool]) {
			errors.push(`${vaultConfig}: chip ${template.label} uses unknown tool ${template.tool}`);
		}
		if (!existsSync(join(workflowDir, `${name}.md`))) {
			errors.push(`${vaultConfig}: chip ${template.label} invokes missing workflow ${name}`);
		}
		for (const [tool, config] of tools) {
			const resolved = resolveToolPrompt(template, tool, local.tools);
			const resolvedName = commandName(resolved);
			if (expectedPrefixes[tool] && !resolved.startsWith(expectedPrefixes[tool] + resolvedName)) {
				errors.push(`${vaultConfig}: chip ${template.label} does not resolve for ${tool}`);
				continue;
			}
			if (tool === "claude") {
				requirePath(join(root, ".claude", "commands", `${resolvedName}.md`), errors);
			}
			if (tool === "codex") {
				requirePath(join(root, ".codex", "skills", resolvedName, "SKILL.md"), errors);
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

const isMain =
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
	try {
		const device = option("--device");
		const vault = option("--vault");
		const errors = validateSetup(process.cwd(), device, vault);
		if (errors.length > 0) {
			console.error(`Dispatch setup validation failed (${errors.length}):\n- ${errors.join("\n- ")}`);
			process.exitCode = 1;
		} else {
			console.log(`Dispatch setup valid (${device && vault ? "project + device" : "project only"})`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

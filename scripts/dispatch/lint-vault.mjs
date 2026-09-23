#!/usr/bin/env node
/**
 * Read-only vault lint through Obsidian's CLI (US00034).
 *
 * Usage:
 *   npm run lint:vault
 *   node scripts/dispatch/lint-vault.mjs --vault Dispatch-Wiki
 *   node scripts/dispatch/lint-vault.mjs --vault Dispatch-Wiki --format json
 *
 * Obsidian must already be running with the named vault as the active window.
 * Obsidian 1.13.7 on Windows ignores `vault=<name>`, so the script supplies it
 * but verifies the answering vault around every data call. It reports findings
 * and writes nothing. The lint-vault workflow owns remediation.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const DEFAULT_WIKI = "wiki";
const RULEBOOK = join("02_Product", "Reports", "_definitions", "Vault lint.md");
const PROPERTY_REFERENCE = join("07_Engineering", "Frontmatter Properties.md");
const TEMPLATE_DIR = join("00_Start-Here", "Templates");

const say = (message = "") => process.stdout.write(`${message}\n`);

export function commandSpecs(vault) {
	if (!String(vault || "").trim()) throw new Error("--vault <name> is required");
	const target = `vault=${String(vault).trim()}`;
	return [
		{ key: "unresolved", args: ["unresolved", "verbose", "format=json", target] },
		{ key: "orphans", args: ["orphans", target] },
		{ key: "deadends", args: ["deadends", target] },
		{ key: "properties", args: ["properties", "counts", "format=json", target] },
	];
}

export function parseJson(text, label) {
	try {
		const value = JSON.parse(String(text || ""));
		if (!Array.isArray(value)) throw new Error("expected an array");
		return value;
	} catch (error) {
		throw new Error(`Invalid ${label} JSON: ${error.message}`);
	}
}

export function parseUnresolved(text) {
	if (/^No unresolved links found\.?$/i.test(String(text || "").trim())) return [];
	return parseJson(text, "unresolved");
}

export function parseMarkdownPaths(text) {
	return [...new Set(String(text || "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /\.md$/i.test(line)))]
		.sort((a, b) => a.localeCompare(b));
}

function normalizedVaultPath(path) {
	return String(path || "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function wikiFileSet(inputs) {
	if (!Array.isArray(inputs.wikiFiles)) throw new Error("Vault lint inputs do not include the wiki file list");
	return new Set(inputs.wikiFiles.map((path) => normalizedVaultPath(path)));
}

export function validateVaultPaths(paths, label, inputs) {
	const existing = wikiFileSet(inputs);
	return paths.map((path) => normalizedVaultPath(path)).filter(Boolean).map((path) => {
		const absolute = /^(?:[a-z]:|\/)/i.test(path);
		const traversal = path.split("/").some((part) => part === "." || part === "..");
		if (absolute || traversal || !existing.has(path)) {
			throw new Error(
				`Obsidian CLI returned ${label} path "${path}" outside ${inputs.vault}. ` +
				`The CLI serves the active vault window; focus ${inputs.vault} and rerun.`,
			);
		}
		return path;
	});
}

export function parseUnresolvedSources(value, inputs) {
	const existing = wikiFileSet(inputs);
	let arrayPaths = null;
	if (Array.isArray(value)) {
		arrayPaths = value.map((path) => normalizedVaultPath(path)).filter(Boolean);
		if (arrayPaths.every((path) => existing.has(path))) return arrayPaths;
	}

	const joined = normalizedVaultPath(arrayPaths ? arrayPaths.join(", ") : value);
	if (!joined) return [];
	const pieces = joined.split(", ");
	const memo = new Map();
	const partition = (start) => {
		if (start === pieces.length) return [];
		if (memo.has(start)) return memo.get(start);
		for (let end = start + 1; end <= pieces.length; end += 1) {
			const candidate = pieces.slice(start, end).join(", ");
			if (!existing.has(candidate)) continue;
			const rest = partition(end);
			if (rest) {
				const result = [candidate, ...rest];
				memo.set(start, result);
				return result;
			}
		}
		memo.set(start, null);
		return null;
	};
	const paths = partition(0);
	if (paths) return paths;
	throw new Error(
		`Obsidian CLI unresolved sources "${joined}" could not be matched to files in ${inputs.vault}. ` +
		"The vault may have changed during the run; rerun the lint.",
	);
}

export function parseFrontmatter(text) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ""));
	if (!match) return {};
	const value = parseYaml(match[1]);
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function documentedProperties(text) {
	const section = String(text || "").split("## Page types and their properties")[1]?.split("## Enumerations")[0] || "";
	const names = new Set();
	for (const line of section.split(/\r?\n/)) {
		if (!line.startsWith("|")) continue;
		const firstCell = line.split("|")[1] || "";
		for (const match of firstCell.matchAll(/`([^`]+)`/g)) names.add(match[1]);
	}
	return names;
}

export function templateProperties(files) {
	const names = new Set();
	for (const text of files) Object.keys(parseFrontmatter(text)).forEach((name) => names.add(name));
	return names;
}

function distance(a, b) {
	const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i += 1) {
		let northwest = previous[0];
		previous[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const north = previous[j];
			previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, northwest + (a[i - 1] === b[j - 1] ? 0 : 1));
			northwest = north;
		}
	}
	return previous[b.length];
}

export function closestProperty(name, declared) {
	let best = null;
	for (const candidate of declared) {
		const score = distance(name, candidate);
		if (score <= 2 && (!best || score < best.score || (score === best.score && candidate < best.name))) {
			best = { name: candidate, score };
		}
	}
	return best?.name || null;
}

export function classifyDeadends(paths, rulebook) {
	const prefixes = Array.isArray(rulebook.deadend_prefixes) ? rulebook.deadend_prefixes.map(String) : [];
	const exact = new Set(Array.isArray(rulebook.deadend_paths) ? rulebook.deadend_paths.map(String) : []);
	const intentional = [];
	const findings = [];
	for (const path of paths) {
		if (exact.has(path) || prefixes.some((prefix) => path.startsWith(prefix))) intentional.push(path);
		else findings.push(path);
	}
	return { findings, intentional };
}

export function buildReport(raw, inputs) {
	const unresolved = parseUnresolved(raw.unresolved).map((item) => ({
		link: String(item.link || ""),
		count: Number(item.count || 0),
		sources: parseUnresolvedSources(item.sources, inputs),
	})).sort((a, b) => a.link.localeCompare(b.link));
	const inUse = parseJson(raw.properties, "properties").map((item) => ({
		name: String(item.name || ""),
		type: String(item.type || ""),
		count: Number(item.count || 0),
	})).filter((item) => item.name && item.count > 0).sort((a, b) => a.name.localeCompare(b.name));
	const declared = new Set([...documentedProperties(inputs.propertyReference), ...templateProperties(inputs.templates)]);
	const undeclared = inUse.filter((item) => !declared.has(item.name)).map((item) => ({
		...item,
		suggestion: closestProperty(item.name, declared),
	}));
	const orphanPaths = validateVaultPaths(String(raw.orphans || "").split(/\r?\n/), "orphan", inputs);
	const deadendPaths = validateVaultPaths(String(raw.deadends || "").split(/\r?\n/), "dead-end", inputs);
	const deadends = classifyDeadends(parseMarkdownPaths(deadendPaths.join("\n")), parseFrontmatter(inputs.rulebook));
	return {
		vault: inputs.vault,
		unresolved,
		orphans: parseMarkdownPaths(orphanPaths.join("\n")),
		deadends,
		properties: { inUse, undeclared },
	};
}

export function hasFindings(report) {
	return report.unresolved.length > 0 || report.orphans.length > 0 ||
		report.deadends.findings.length > 0 || report.properties.undeclared.length > 0;
}

export function formatReport(report) {
	const sections = [
		["Unresolved links", report.unresolved.map((item) => `${item.link} <- ${item.sources.join(", ")}`)],
		["Orphaned pages", report.orphans],
		["Unclassified dead ends", report.deadends.findings],
		["Intentional dead ends", report.deadends.intentional],
		["Undeclared properties", report.properties.undeclared.map((item) =>
			`${item.name} (${item.count})${item.suggestion ? ` -> ${item.suggestion}?` : ""}`)],
	];
	const lines = [`Vault lint: ${report.vault}`];
	for (const [heading, items] of sections) {
		lines.push("", `${heading}: ${items.length}`);
		items.forEach((item) => lines.push(`- ${item}`));
	}
	lines.push("", hasFindings(report) ? "Result: findings" : "Result: clean");
	return lines.join("\n");
}

function runCommand(cli, args, runner) {
	const result = runner(cli, args, { encoding: "utf8", windowsHide: true });
	if (result.error) throw new Error(`Could not run ${cli}: ${result.error.message}`);
	if (result.status !== 0) {
		const detail = String(result.stderr || result.stdout || "unknown CLI failure").trim();
		throw new Error(`Obsidian CLI failed (${args[0]}): ${detail}`);
	}
	const stdout = String(result.stdout || "");
	if (/^\s*Error:/i.test(stdout)) {
		throw new Error(`Obsidian CLI failed (${args[0]}): ${stdout.trim()}`);
	}
	return stdout;
}

function assertActiveVault(actual, expected) {
	const name = String(actual || "").trim();
	if (name !== expected.trim()) {
		throw new Error(
			`Obsidian CLI serves the active vault window${name ? ` "${name}"` : ""}, not "${expected.trim()}". ` +
			`Focus ${expected.trim()} and rerun.`,
		);
	}
}

export function collectRaw(vault, options = {}) {
	const runner = options.runner || spawnSync;
	const cli = options.cli || "obsidian";
	const target = `vault=${vault.trim()}`;
	const identity = () => runCommand(cli, ["vault", "info=name", target], runner);
	const raw = {};
	for (const { key, args } of commandSpecs(vault)) {
		assertActiveVault(identity(), vault);
		raw[key] = runCommand(cli, args, runner);
		assertActiveVault(identity(), vault);
	}
	return raw;
}

function listWikiFiles(root, directory = root) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...listWikiFiles(root, absolute));
		else if (entry.isFile()) files.push(absolute.slice(root.length + 1).replaceAll("\\", "/"));
	}
	return files;
}

export function readInputs(wiki, vault) {
	const root = resolve(wiki);
	const propertyPath = join(root, PROPERTY_REFERENCE);
	const rulebookPath = join(root, RULEBOOK);
	const templatePath = join(root, TEMPLATE_DIR);
	for (const path of [propertyPath, rulebookPath, templatePath]) {
		if (!existsSync(path)) throw new Error(`Required lint input is missing: ${path}`);
	}
	const templates = readdirSync(templatePath)
		.filter((name) => name.endsWith(".md"))
		.map((name) => readFileSync(join(templatePath, name), "utf8"));
	return {
		vault,
		wikiFiles: listWikiFiles(root).sort((a, b) => a.localeCompare(b)),
		propertyReference: readFileSync(propertyPath, "utf8"),
		rulebook: readFileSync(rulebookPath, "utf8"),
		templates,
	};
}

function argument(args, name) {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
}

export function parseArgs(args) {
	const vault = argument(args, "vault");
	if (!vault) throw new Error("Usage: lint-vault.mjs --vault <name> [--wiki <path>] [--format text|json]");
	const format = argument(args, "format") || "text";
	if (!["text", "json"].includes(format)) throw new Error("--format must be text or json");
	return { vault, wiki: argument(args, "wiki") || DEFAULT_WIKI, format };
}

export function main(args = process.argv.slice(2), options = {}) {
	try {
		const parsed = parseArgs(args);
		const inputs = options.inputs || readInputs(parsed.wiki, parsed.vault);
		const report = buildReport(collectRaw(parsed.vault, options), inputs);
		say(parsed.format === "json" ? JSON.stringify(report, null, 2) : formatReport(report));
		return hasFindings(report) ? 1 : 0;
	} catch (error) {
		process.stderr.write(`Vault lint failed: ${error.message}\n`);
		return 2;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exitCode = main();

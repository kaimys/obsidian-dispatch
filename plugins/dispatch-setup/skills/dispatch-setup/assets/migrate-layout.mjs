#!/usr/bin/env node
/**
 * Moves a repository set up by an older dispatch-setup onto the `dispatch/`
 * layout (US00033, ADR-0035). Run it from this skill's directory; it is never
 * copied into a project.
 *
 *   node migrate-layout.mjs --repo <path> [--vault <path>]           list only
 *   node migrate-layout.mjs --repo <path> [--vault <path>] --apply   migrate
 *
 * Without --apply it prints every move and rewrite it would make and touches
 * nothing; a repository already on the new layout prints nothing to do. The
 * skill shows that list and asks once before running it with --apply.
 *
 * What moves: every file in `scripts/dispatch/`, and a scaffolded
 * `scripts/move-ticket.mjs`, into `dispatch/scripts/` (with `git mv` in a git
 * repository). What is rewritten: those paths in both agents' hook files, the
 * workflow files, their stubs and the pointer files; the vault's absolute path
 * and a root `wiki/` lookup in the same files, to `dispatch/wiki/`; and an
 * automation command in the vault's `data.json` that names an old path, leaving
 * every other byte of that file alone. A root `wiki` is removed only when it is
 * a link, never a real folder, and only once `dispatch/wiki` exists or is about
 * to — a project is never left with neither. Without --vault, the vault is taken
 * from the old root link; with neither, the migration warns that the link must
 * be created by hand. It refuses, changing nothing, when a file exists at both
 * its old and new path with different contents.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmdirSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const OLD_SCRIPTS = join("scripts", "dispatch");
const NEW_SCRIPTS = join("dispatch", "scripts");
const OLD_TRACKER_SCRIPT = join("scripts", "move-ticket.mjs");
const LINK = join("dispatch", "wiki");

function isLink(path) {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
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

/** The files that name a script or vault path: hooks, workflows, stubs, pointers. */
function textFiles(root) {
	return [
		join(root, ".claude", "settings.json"),
		join(root, ".codex", "hooks.json"),
		join(root, "dispatch", "invariants.md"),
		join(root, "CLAUDE.md"),
		join(root, "AGENTS.md"),
		...markdownFiles(join(root, "dispatch", "workflow")),
		...markdownFiles(join(root, ".claude", "commands")),
		...markdownFiles(join(root, ".codex", "skills")),
	].filter((path) => existsSync(path));
}

/** A vault path as a workflow may spell it: as given, and with either separator. */
function vaultSpellings(vault) {
	const spellings = [vault, vault.replaceAll("\\", "/"), vault.replaceAll("/", "\\")];
	return [...new Set(spellings)].sort((a, b) => b.length - a.length);
}

/** The text with every old-layout path replaced, or the same text when none is there. */
export function rewrite(text, { vault = "", rootWiki = false } = {}) {
	let out = text
		.replaceAll("scripts/dispatch/", "dispatch/scripts/")
		.replace(/(?<![\w/.-])scripts\/move-ticket\.mjs/g, "dispatch/scripts/move-ticket.mjs");
	if (vault) for (const spelling of vaultSpellings(vault)) out = out.replaceAll(spelling, "dispatch/wiki");
	if (rootWiki) out = out.replace(/(?<![\w/.-])wiki\//g, "dispatch/wiki/");
	return out;
}

/**
 * Whether `path` lies outside `root`. Compares resolved prefixes rather than
 * `path.relative`, which returns a bare `D:\…` for a vault on another drive.
 */
export function isOutside(root, path) {
	const fold = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
	const base = fold(root);
	const target = fold(path);
	return target !== base && !target.startsWith(base.endsWith(sep) ? base : base + sep);
}

function sameContents(a, b) {
	return readFileSync(a).equals(readFileSync(b));
}

/** Every action the migration would take, and every conflict that forbids it. */
export function planMigration(repoRoot, vaultRoot = "") {
	const root = resolve(repoRoot);
	let vault = vaultRoot ? resolve(vaultRoot) : "";
	const actions = [];
	const conflicts = [];
	const warnings = [];

	const moves = [];
	const oldScripts = join(root, OLD_SCRIPTS);
	if (existsSync(oldScripts)) {
		for (const entry of readdirSync(oldScripts, { withFileTypes: true })) {
			if (entry.isFile()) moves.push([join(oldScripts, entry.name), join(root, NEW_SCRIPTS, entry.name)]);
		}
	}
	if (existsSync(join(root, OLD_TRACKER_SCRIPT))) {
		moves.push([join(root, OLD_TRACKER_SCRIPT), join(root, NEW_SCRIPTS, "move-ticket.mjs")]);
	}
	const targets = new Map();
	for (const [from, to] of moves) {
		if (targets.has(to)) {
			conflicts.push(`${relative(root, from)} and ${relative(root, targets.get(to))} both move to ${relative(root, to)}`);
			continue;
		}
		targets.set(to, from);
		if (!existsSync(to)) actions.push({ kind: "move", from, to });
		else if (sameContents(from, to)) actions.push({ kind: "remove-duplicate", path: from, keeps: to });
		else conflicts.push(`${relative(root, from)} and ${relative(root, to)} both exist and differ`);
	}

	const rootWikiPath = join(root, "wiki");
	const rootWikiIsLink = isLink(rootWikiPath);
	const rootWiki = rootWikiIsLink || !existsSync(rootWikiPath);
	// Without --vault, the old root link already says where the vault is.
	if (!vault && rootWikiIsLink && existsSync(rootWikiPath)) vault = realpathSync(rootWikiPath);
	const vaultOutside = Boolean(vault) && isOutside(root, vault);
	for (const path of textFiles(root)) {
		const text = readFileSync(path, "utf8");
		const next = rewrite(text, { vault: vaultOutside ? vault : "", rootWiki });
		if (next !== text) actions.push({ kind: "rewrite", path, text: next });
	}

	const link = join(root, LINK);
	const linkResolves = existsSync(link);
	const linkPlanned = vaultOutside && !linkResolves && !isLink(link);
	if (linkPlanned) actions.push({ kind: "link", path: link, target: vault });
	const gitignore = join(root, ".gitignore");
	const ignored = existsSync(gitignore) ? readFileSync(gitignore, "utf8").split(/\r?\n/) : [];
	if (vaultOutside && !ignored.includes("/dispatch/wiki")) actions.push({ kind: "ignore", path: gitignore });
	// The old link goes only once the new one is certain: a project is never left with neither.
	if (rootWikiIsLink && (linkPlanned || linkResolves)) actions.push({ kind: "unlink", path: rootWikiPath });
	if (!linkPlanned && !linkResolves) {
		warnings.push(
			vault && !vaultOutside
				? `the vault ${vault} is inside the repository, so no dispatch/wiki link is created`
				: "no dispatch/wiki link can be created: pass --vault <path> so the workflows can reach the vault"
		);
	}

	if (vault) {
		const dataPath = join(vault, ".obsidian", "plugins", "dispatch", "data.json");
		if (existsSync(dataPath)) {
			const raw = readFileSync(dataPath, "utf8");
			let data;
			try {
				data = JSON.parse(raw);
			} catch (error) {
				conflicts.push(`${dataPath} does not parse: ${error instanceof Error ? error.message : String(error)}`);
			}
			let next = raw;
			for (const rule of data?.board?.automations ?? []) {
				if (typeof rule?.command !== "string") continue;
				const command = rewrite(rule.command);
				if (command !== rule.command) next = next.replaceAll(JSON.stringify(rule.command), JSON.stringify(command));
			}
			if (next !== raw) actions.push({ kind: "automation", path: dataPath, text: next });
		}
	}

	return { root, actions, conflicts, warnings };
}

export function describeAction(action, root) {
	const rel = (path) => (path.startsWith(root + sep) ? relative(root, path) : path);
	switch (action.kind) {
		case "move":
			return `move ${rel(action.from)} -> ${rel(action.to)}`;
		case "remove-duplicate":
			return `remove ${rel(action.path)} (identical to ${rel(action.keeps)})`;
		case "rewrite":
			return `rewrite old paths in ${rel(action.path)}`;
		case "link":
			return `link ${rel(action.path)} -> ${action.target}`;
		case "ignore":
			return `add /dispatch/wiki to ${rel(action.path)}`;
		case "unlink":
			return `remove the root link ${rel(action.path)} (the vault is untouched)`;
		case "automation":
			return `repoint the automation command in ${action.path}`;
		default:
			return action.kind;
	}
}

function inGit(root) {
	const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
	return result.status === 0 && result.stdout.trim() === "true";
}

function tracked(root, path) {
	return spawnSync("git", ["ls-files", "--error-unmatch", path], { cwd: root }).status === 0;
}

function removeEmpty(dir) {
	if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

/** Carries out a plan without conflicts. Never deletes a real folder. */
export function applyMigration({ root, actions, conflicts }) {
	if (conflicts.length) throw new Error(`refusing to migrate: ${conflicts.join("; ")}`);
	const git = inGit(root);
	for (const action of actions) {
		switch (action.kind) {
			case "move":
				mkdirSync(dirname(action.to), { recursive: true });
				if (git && tracked(root, action.from)) {
					const moved = spawnSync("git", ["mv", action.from, action.to], { cwd: root, encoding: "utf8" });
					if (moved.status !== 0) throw new Error(`git mv failed: ${moved.stderr.trim()}`);
				} else {
					renameSync(action.from, action.to);
				}
				break;
			case "remove-duplicate":
				if (git && tracked(root, action.path)) spawnSync("git", ["rm", "-q", action.path], { cwd: root });
				else unlinkSync(action.path);
				break;
			case "rewrite":
			case "automation":
				writeFileSync(action.path, action.text);
				break;
			case "link":
				mkdirSync(dirname(action.path), { recursive: true });
				symlinkSync(action.target, action.path, "junction");
				break;
			case "ignore": {
				const current = existsSync(action.path) ? readFileSync(action.path, "utf8") : "";
				const eol = current.includes("\r\n") ? "\r\n" : "\n";
				const lead = current && !current.endsWith("\n") ? eol : "";
				writeFileSync(action.path, `${current}${lead}# the vault link (dispatch-setup)${eol}/dispatch/wiki${eol}`);
				break;
			}
			case "unlink":
				// Only a link is ever removed; a junction needs rmdir, which removes the link, not the vault.
				if (!isLink(action.path)) throw new Error(`${action.path} is not a link; left in place`);
				try {
					unlinkSync(action.path);
				} catch {
					rmdirSync(action.path);
				}
				break;
		}
	}
	removeEmpty(join(root, OLD_SCRIPTS));
	removeEmpty(join(root, "scripts"));
}

function option(args, name) {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? "" : args[index + 1] ?? "";
}

export function main(args = process.argv.slice(2)) {
	const repo = option(args, "repo");
	if (!repo) {
		process.stderr.write("Usage: migrate-layout.mjs --repo <path> [--vault <path>] [--apply]\n");
		return 2;
	}
	const plan = planMigration(repo, option(args, "vault"));
	for (const conflict of plan.conflicts) process.stdout.write(`conflict: ${conflict}\n`);
	if (plan.conflicts.length) {
		process.stdout.write("Refusing to migrate: resolve the conflicts above first. Nothing was changed.\n");
		return 1;
	}
	for (const warning of plan.warnings) process.stdout.write(`warning: ${warning}\n`);
	if (plan.actions.length === 0) {
		process.stdout.write("Already on the dispatch/ layout: nothing to migrate.\n");
		return 0;
	}
	for (const action of plan.actions) process.stdout.write(`${describeAction(action, plan.root)}\n`);
	if (!args.includes("--apply")) {
		process.stdout.write(`${plan.actions.length} change(s) planned. Nothing was changed; re-run with --apply.\n`);
		return 0;
	}
	applyMigration(plan);
	process.stdout.write(`Migrated to the dispatch/ layout: ${plan.actions.length} change(s).\n`);
	return 0;
}

function sameFile(first, second) {
	if (!first || !existsSync(first)) return false;
	try {
		return realpathSync(first) === realpathSync(second);
	} catch {
		return false;
	}
}

if (sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
	try {
		process.exitCode = main();
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}

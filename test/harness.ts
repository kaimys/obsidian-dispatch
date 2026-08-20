/**
 * Loads the fixture wiki from disk the way the plugin receives it at runtime.
 *
 * Obsidian hands a plugin two things per note: parsed frontmatter (from
 * `metadataCache`) and the full file text (from `cachedRead`) — frontmatter
 * included, which is why todo line numbers count from the first line of the
 * file. The harness reproduces exactly that and nothing more, so a test that
 * passes here is testing our rules rather than a reimplementation of Obsidian.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

export interface VaultFile {
	/** Vault-relative, forward-slashed — the form the plugin's settings use. */
	path: string;
	basename: string;
	/** Parsed frontmatter; empty object when the note has none. */
	frontmatter: Record<string, unknown>;
	/** Full file text, frontmatter included. */
	content: string;
}

const VAULT = fileURLToPath(new URL("./vault", import.meta.url));

function parseFrontmatter(text: string): Record<string, unknown> {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!m) return {};
	const parsed = load(m[1]);
	return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (entry.name.endsWith(".md")) out.push(full);
	}
	return out;
}

/** Every markdown note in the fixture vault, optionally under one folder. */
export function loadVault(folder?: string): VaultFile[] {
	const root = folder ? path.join(VAULT, folder) : VAULT;
	return walk(root)
		.map((full) => {
			const content = fs.readFileSync(full, "utf8");
			const rel = path.relative(VAULT, full).split(path.sep).join("/");
			return {
				path: rel,
				basename: path.basename(full, ".md"),
				frontmatter: parseFrontmatter(content),
				content,
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}

/** One note by basename prefix — e.g. `note("US00002")`. */
export function note(prefix: string): VaultFile {
	const hit = loadVault().find((f) => f.basename.startsWith(prefix));
	if (!hit) throw new Error(`no fixture note starting with "${prefix}"`);
	return hit;
}

/** The board settings the fixture wiki is written against. */
export const SETTINGS = {
	statusProperty: "status",
	orderProperty: "rank",
	titleProperty: "id",
	versionProperty: "version_target",
	sizeProperty: "size",
	requiredProperties: ["id", "status", "updated"],
	columns: [
		{ value: "Ready for Refinement", progress: 0 },
		{ value: "Refinement", progress: 10 },
		{ value: "Ready for Dev", progress: 25 },
		{ value: "Development", progress: 55 },
		{ value: "Ready for Build", progress: 80 },
		{ value: "Deployed", progress: 100 },
	],
	assignees: ["Alex", "Robin", "Morgan"],
	fallbackAssignee: "Team",
	todoSections: new Set(["action items", "open action items"]),
};

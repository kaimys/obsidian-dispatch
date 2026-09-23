/**
 * US00033 criterion 9: re-running dispatch-setup on a project with the old
 * layout lists every change, asks once, and on confirmation leaves the project
 * on the `dispatch/` layout — one copy of each script, the vault's automation
 * repointed, no absolute vault path — or, when declined, changes nothing.
 *
 * The asking is the skill's; this pins the script it asks about. The fixture is
 * the shape an older setup left behind: scripts in `scripts/dispatch/`, a
 * tracker script at `scripts/move-ticket.mjs`, a root `wiki` link, and a
 * workflow that reaches the vault by absolute path.
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isOutside, planMigration } from "../plugins/dispatch-setup/skills/dispatch-setup/assets/migrate-layout.mjs";

const assets = resolve("plugins/dispatch-setup/skills/dispatch-setup/assets");
const migrator = join(assets, "migrate-layout.mjs");

function write(path: string, contents: string): void {
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, contents);
}

const automation = "node scripts/dispatch/move-ticket.mjs {{file}} {{from}} {{to}}";
const dataJson = `{
  "board": {
    "statusProperty": "status",
    "automations": [
      { "when": [], "set": {}, "repo": "app", "command": "${automation}" },
      { "when": ["Done"], "set": { "completed": "{{date}}" } }
    ]
  },
  "chips": { "templates": [] }
}
`;

/** An old-layout project in a git repository, with its vault outside it. */
function fixture(): { root: string; repo: string; vault: string } {
	const root = mkdtempSync(join(tmpdir(), "migrate-layout-"));
	const repo = join(root, "repo");
	const vault = join(root, "vault");
	write(join(vault, ".obsidian", "plugins", "dispatch", "data.json"), dataJson);
	write(join(vault, "05_Requirements", "Tickets", "US00001.md"), "---\nid: US00001\n---\n");

	write(join(repo, "scripts", "dispatch", "run-state.mjs"), "// hook\n");
	copyFileSync(join(assets, "validate.mjs"), join(repo, "scripts", "dispatch", "validate.mjs"));
	write(join(repo, "scripts", "move-ticket.mjs"), "// tracker\n");
	write(
		join(repo, ".claude", "settings.json"),
		'{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "node", ' +
			'"args": ["${CLAUDE_PROJECT_DIR}/scripts/dispatch/run-state.mjs", "waiting"] }] }] } }\n'
	);
	write(join(repo, ".codex", "hooks.json"), '{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "node scripts/dispatch/run-state.mjs waiting" }] }] } }\n');
	write(
		join(repo, "dispatch", "workflow", "refine.md"),
		`# Refine\n1. grep \`id: <ARGS>\` in \`${vault}/05_Requirements/Tickets\`, then \`wiki/00_Start-Here\`.\n` +
			"2. Gate: `node scripts/dispatch/validate.mjs`.\n"
	);
	write(join(repo, "dispatch", "invariants.md"), "# Invariants\nDrags run `node scripts/move-ticket.mjs`.\n");
	write(join(repo, "CLAUDE.md"), "Read dispatch/invariants.md\n");
	write(join(repo, "AGENTS.md"), "Read dispatch/invariants.md\n");
	write(join(repo, ".gitignore"), "node_modules/\nwiki\n");
	symlinkSync(vault, join(repo, "wiki"), "junction");

	spawnSync("git", ["init", "-q"], { cwd: repo });
	spawnSync("git", ["add", "-A"], { cwd: repo });
	return { root, repo, vault };
}

/** path → contents for every file under `dir`, not following links. */
function snapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (path: string): void => {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			out[relative(dir, path)] = `-> ${realpathSync(path)}`;
		} else if (stat.isDirectory()) {
			if (path.endsWith(".git")) return;
			for (const name of readdirSync(path)) walk(join(path, name));
		} else {
			out[relative(dir, path)] = readFileSync(path, "utf8");
		}
	};
	walk(dir);
	return out;
}

/** Runs the migration; `vault: ""` leaves `--vault` out, as its usage allows. */
function migrate(f: { repo: string; vault: string }, ...extra: string[]): { status: number | null; output: string } {
	const vault = f.vault ? ["--vault", f.vault] : [];
	const result = spawnSync(process.execPath, [migrator, "--repo", f.repo, ...vault, ...extra], {
		encoding: "utf8",
	});
	return { status: result.status, output: result.stdout + result.stderr };
}

describe("migrate-layout — US00033", () => {
	it("lists every change and touches nothing without --apply", () => {
		const f = fixture();
		try {
			const before = snapshot(f.root);
			const result = migrate(f);
			expect(result.status).toBe(0);
			expect(result.output).toContain(`move ${join("scripts", "dispatch", "run-state.mjs")} -> ${join("dispatch", "scripts", "run-state.mjs")}`);
			expect(result.output).toContain(`move ${join("scripts", "move-ticket.mjs")} -> ${join("dispatch", "scripts", "move-ticket.mjs")}`);
			expect(result.output).toContain(`rewrite old paths in ${join(".codex", "hooks.json")}`);
			expect(result.output).toContain("remove the root link wiki (the vault is untouched)");
			expect(result.output).toContain("repoint the automation command in");
			expect(result.output).toContain("Nothing was changed; re-run with --apply.");
			expect(snapshot(f.root)).toEqual(before);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("leaves the project on the dispatch/ layout with --apply", () => {
		const f = fixture();
		try {
			const result = migrate(f, "--apply");
			expect(result.output).toContain("Migrated to the dispatch/ layout");
			expect(result.status).toBe(0);

			expect(existsSync(join(f.repo, "scripts"))).toBe(false);
			const files = Object.keys(snapshot(f.repo));
			expect(files.filter((path) => path.endsWith("run-state.mjs"))).toEqual([join("dispatch", "scripts", "run-state.mjs")]);
			expect(files).toContain(join("dispatch", "scripts", "move-ticket.mjs"));
			const tracked = spawnSync("git", ["ls-files", "dispatch/scripts"], { cwd: f.repo, encoding: "utf8" });
			expect(tracked.stdout.split("\n").filter(Boolean)).toHaveLength(3);

			const workflow = readFileSync(join(f.repo, "dispatch", "workflow", "refine.md"), "utf8");
			expect(workflow).not.toContain(f.vault);
			expect(workflow).toContain("`dispatch/wiki/05_Requirements/Tickets`");
			expect(workflow).toContain("`dispatch/wiki/00_Start-Here`");
			expect(workflow).toContain("`node dispatch/scripts/validate.mjs`");
			expect(readFileSync(join(f.repo, "dispatch", "invariants.md"), "utf8")).toContain("node dispatch/scripts/move-ticket.mjs");
			for (const hooks of [join(".claude", "settings.json"), join(".codex", "hooks.json")]) {
				const text = readFileSync(join(f.repo, hooks), "utf8");
				expect(text).toContain("dispatch/scripts/run-state.mjs");
				expect(text).not.toContain("scripts/dispatch/");
			}

			expect(realpathSync(join(f.repo, "dispatch", "wiki"))).toBe(realpathSync(f.vault));
			expect(existsSync(join(f.repo, "wiki"))).toBe(false);
			expect(existsSync(join(f.vault, "05_Requirements", "Tickets", "US00001.md"))).toBe(true);
			expect(readFileSync(join(f.repo, ".gitignore"), "utf8").split("\n")).toContain("/dispatch/wiki");
			expect(spawnSync("git", ["status", "--porcelain", "dispatch/wiki"], { cwd: f.repo, encoding: "utf8" }).stdout).toBe("");

			const data = readFileSync(join(f.vault, ".obsidian", "plugins", "dispatch", "data.json"), "utf8");
			expect(data).toBe(dataJson.replace(automation, "node dispatch/scripts/move-ticket.mjs {{file}} {{from}} {{to}}"));

			const validate = spawnSync(process.execPath, [join(f.repo, "dispatch", "scripts", "validate.mjs")], {
				cwd: f.repo,
				encoding: "utf8",
			});
			expect(validate.stdout + validate.stderr).toContain("Dispatch setup valid (project only)");

			const again = migrate(f);
			expect(again.output).toContain("Already on the dispatch/ layout: nothing to migrate.");
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("refuses and changes nothing when a script exists at both paths with different contents", () => {
		const f = fixture();
		try {
			write(join(f.repo, "dispatch", "scripts", "run-state.mjs"), "// a different hook\n");
			const before = snapshot(f.root);
			const result = migrate(f, "--apply");
			expect(result.status).toBe(1);
			expect(result.output).toContain(
				`conflict: ${join("scripts", "dispatch", "run-state.mjs")} and ${join("dispatch", "scripts", "run-state.mjs")} both exist and differ`
			);
			expect(snapshot(f.root)).toEqual(before);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("never removes a root wiki that is a real folder", () => {
		const root = mkdtempSync(join(tmpdir(), "migrate-layout-folder-"));
		try {
			const repo = join(root, "repo");
			write(join(repo, "wiki", "05_Requirements", "note.md"), "kept\n");
			write(join(repo, "scripts", "dispatch", "run-state.mjs"), "// hook\n");
			const plan = planMigration(repo) as { actions: Array<{ kind: string }> };
			expect(plan.actions.map((action) => action.kind)).toEqual(["move"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	/**
	 * Review finding 1 (2026-09-23): without --vault the root link was removed and
	 * no dispatch/wiki created, leaving the project with no way to its vault.
	 */
	it("takes the vault from the root link when --vault is left out", () => {
		const f = fixture();
		try {
			const result = migrate({ repo: f.repo, vault: "" }, "--apply");
			expect(result.status).toBe(0);
			expect(result.output).not.toContain("warning:");
			expect(realpathSync(join(f.repo, "dispatch", "wiki"))).toBe(realpathSync(f.vault));
			expect(existsSync(join(f.repo, "wiki"))).toBe(false);
			expect(readFileSync(join(f.vault, ".obsidian", "plugins", "dispatch", "data.json"), "utf8")).toContain(
				"node dispatch/scripts/move-ticket.mjs"
			);
			expect(readFileSync(join(f.repo, "dispatch", "workflow", "refine.md"), "utf8")).not.toContain(f.vault);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("keeps any link it cannot replace, and says the vault link is missing", () => {
		const root = mkdtempSync(join(tmpdir(), "migrate-layout-novault-"));
		try {
			const repo = join(root, "repo");
			write(join(repo, "scripts", "dispatch", "run-state.mjs"), "// hook\n");
			write(join(repo, "dispatch", "workflow", "refine.md"), "grep `wiki/05_Requirements`\n");
			const plan = planMigration(repo) as { actions: Array<{ kind: string }>; warnings: string[] };
			expect(plan.actions.map((action) => action.kind)).not.toContain("unlink");
			expect(plan.warnings).toEqual([
				"no dispatch/wiki link can be created: pass --vault <path> so the workflows can reach the vault",
			]);
			const result = migrate({ repo, vault: "" });
			expect(result.output).toContain("warning: no dispatch/wiki link can be created");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.runIf(process.platform === "win32")("treats a vault on another drive as outside the repository", () => {
		expect(isOutside("C:\\repo", "D:\\Vault")).toBe(true);
		expect(isOutside("C:\\repo", "C:\\repo-vault")).toBe(true);
		expect(isOutside("C:\\repo", "C:\\repo\\wiki")).toBe(false);
		expect(isOutside("C:\\Repo", "c:\\repo")).toBe(false);
	});
});

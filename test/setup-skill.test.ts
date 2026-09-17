import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const setup = resolve("plugins/dispatch-setup/skills/dispatch-setup");
const validator = join(setup, "assets", "validate.mjs");
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function write(path: string, contents: string): void {
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, contents);
}

function fixture(): {
	root: string;
	repo: string;
	vault: string;
	device: string;
	shared: Record<string, unknown>;
	local: Record<string, unknown>;
} {
	const root = mkdtempSync(join(tmpdir(), "dispatch-setup-validator-"));
	const repo = join(root, "repo");
	const vault = join(root, "vault");
	const device = join(root, "device.json");
	const shared = {
		chips: {
			defaultTool: "claude",
			templates: [
				{
					label: "Start refinement",
					intent: "refine",
					repo: "app",
					prompt: "/refine {{id}}",
				},
			],
		},
		meetings: { templates: [], calendarChips: [] },
	};
	const local = {
		repos: { app: repo, wiki: vault },
		tools: {
			claude: { command: "claude {{prompt}}", promptPrefix: "/" },
			codex: { command: "codex {{prompt}}", promptPrefix: "$" },
		},
		confirmBeforeRun: true,
	};

	write(join(repo, "dispatch", "invariants.md"), "# Invariants\n");
	write(join(repo, "dispatch", "workflow", "refine.md"), "# Refine\nnode scripts/dispatch/validate.mjs\n");
	write(join(repo, "scripts", "dispatch", "run-state.mjs"), "// hook\n");
	mkdirSync(join(repo, "scripts", "dispatch"), { recursive: true });
	copyFileSync(validator, join(repo, "scripts", "dispatch", "validate.mjs"));
	write(join(repo, "CLAUDE.md"), "Read dispatch/invariants.md\n");
	write(join(repo, "AGENTS.md"), "Read dispatch/invariants.md\n");
	write(join(repo, ".claude", "settings.json"), "{}\n");
	write(join(repo, ".claude", "commands", "refine.md"), "Read dispatch/workflow/refine.md\n");
	write(join(repo, ".codex", "hooks.json"), '{"hooks":{}}\n');
	write(join(repo, ".codex", "skills", "refine", "SKILL.md"), "Read dispatch/workflow/refine.md\n");
	write(join(vault, ".obsidian", "plugins", "dispatch", "data.json"), JSON.stringify(shared));
	write(device, JSON.stringify(local));
	return { root, repo, vault, device, shared, local };
}

function run(repo: string, device: string): { status: number | null; output: string } {
	const result = spawnSync(process.execPath, [validator, "--device", device], {
		cwd: repo,
		encoding: "utf8",
	});
	return { status: result.status, output: result.stdout + result.stderr };
}

describe("dispatch-setup multi-agent contract", () => {
	it("shows one neutral shared chip and explicit prefixes for both agents", () => {
		const skill = read(join(setup, "SKILL.md"));
		const shared = skill.slice(skill.indexOf("## 2 ·"), skill.indexOf("## 3 ·"));
		const local = skill.slice(skill.indexOf("## 3 ·"), skill.indexOf("## 4 ·"));
		expect(shared).toContain('"intent": "refine"');
		expect(shared).not.toContain('"tool": "claude"');
		expect(local).toContain('"promptPrefix": "/"');
		expect(local).toContain('"promptPrefix": "$"');
		expect(skill).toContain("A command not run is **incomplete**");
	});

	it("packages a portable validator and no assumed backend release sequence", () => {
		expect(read(validator)).toContain("export function validateSetup");
		const release = read(join(setup, "assets", "commands", "release.md"));
		expect(release).not.toMatch(/refresh any mirror of a backend|promoting a backend/);
		expect(release).toContain("never invent backend, mirror or deployment steps");
	});

	it("accepts a complete two-agent scaffold", () => {
		const f = fixture();
		try {
			const result = run(f.repo, f.device);
			expect(result.output).toContain("Dispatch setup valid (project + device)");
			expect(result.status).toBe(0);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("rejects the missing prefix, duplicate per-agent chip and missing gate from the failed setup", () => {
		const f = fixture();
		try {
			const local = f.local as { tools: { codex: { promptPrefix?: string } } };
			delete local.tools.codex.promptPrefix;
			write(f.device, JSON.stringify(local));
			const shared = f.shared as {
				chips: { templates: Array<Record<string, string>> };
			};
			shared.chips.templates.push({
				label: "refine (Codex)",
				intent: "refine",
				tool: "codex",
				repo: "app",
				prompt: "$refine {{id}}",
			});
			write(
				join(f.vault, ".obsidian", "plugins", "dispatch", "data.json"),
				JSON.stringify(shared)
			);
			rmSync(join(f.repo, "scripts", "dispatch", "validate.mjs"));

			const result = run(f.repo, f.device);
			expect(result.status).toBe(1);
			expect(result.output).toContain('tool codex needs promptPrefix "$"');
			expect(result.output).toContain("multi-agent command chip refine (Codex) must omit tool");
			expect(result.output).toContain("duplicate command-chip intent refine");
			expect(result.output).toContain("missing " + join(f.repo, "scripts", "dispatch", "validate.mjs"));
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("rejects a disabled chooser and unresolved placeholders in nested Codex stubs", () => {
		const f = fixture();
		try {
			const local = f.local as { confirmBeforeRun: boolean };
			local.confirmBeforeRun = false;
			write(f.device, JSON.stringify(local));
			write(
				join(f.repo, ".codex", "skills", "refine", "SKILL.md"),
				"Read <<WORKFLOW>>\n"
			);

			const result = run(f.repo, f.device);
			expect(result.status).toBe(1);
			expect(result.output).toContain("multi-agent setup needs confirmBeforeRun true");
			expect(result.output).toContain(
				"unresolved placeholder in " + join(f.repo, ".codex", "skills", "refine", "SKILL.md")
			);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
});

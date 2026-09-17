import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolvePrompt } from "../src/exec";
import type { ChipTemplate, ToolConfig } from "../src/settings";

const setup = resolve("plugins/dispatch-setup/skills/dispatch-setup");
const validator = join(setup, "assets", "validate.mjs");
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function example(sectionStart: string, sectionEnd: string): Record<string, unknown> {
	const skill = read(join(setup, "SKILL.md"));
	const section = skill.slice(skill.indexOf(sectionStart), skill.indexOf(sectionEnd));
	const block = /```json\n([\s\S]*?)\n```/.exec(section)?.[1];
	if (!block) throw new Error(`No JSON example in ${sectionStart}`);
	return JSON.parse(block) as Record<string, unknown>;
}

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
	const vault = join(repo, "wiki");
	const device = join(root, "device.json");
	const shared = {
		chips: {
			defaultTool: "claude",
			templates: [
				{
					label: "Start refinement",
					intent: "refine",
					repo: "my-app",
					prompt: "/refine {{id}}",
				},
			],
		},
		meetings: { templates: [], calendarChips: [] },
	};
	const local = example("## 3 ·", "## 4 ·") as {
		repos: Record<string, string>;
		tools: Record<string, ToolConfig>;
		confirmBeforeRun: boolean;
	};
	local.repos["my-app"] = repo;

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

function run(
	repo: string,
	options: { device?: string; vault?: string; script?: string; env?: NodeJS.ProcessEnv } = {}
): { status: number | null; output: string } {
	const args = [options.script ?? validator];
	if (options.device) args.push("--device", options.device);
	if (options.vault) args.push("--vault", options.vault);
	const result = spawnSync(process.execPath, args, {
		cwd: repo,
		encoding: "utf8",
		env: { ...process.env, ...options.env },
	});
	return { status: result.status, output: result.stdout + result.stderr };
}

describe("dispatch-setup multi-agent contract", () => {
	it("resolves the skill's neutral-chip examples for both agents", () => {
		const skill = read(join(setup, "SKILL.md"));
		const shared = skill.slice(skill.indexOf("## 2 ·"), skill.indexOf("## 3 ·"));
		const local = skill.slice(skill.indexOf("## 3 ·"), skill.indexOf("## 4 ·"));
		expect(shared).toContain('"intent": "refine"');
		expect(shared).not.toContain('"tool": "claude"');
		expect(local).toContain('"promptPrefix": "/"');
		expect(local).toContain('"promptPrefix": "$"');
		expect(skill).toContain("A command not run is **incomplete**");

		const sharedConfig = example("## 2 ·", "## 3 ·") as {
			chips: { templates: ChipTemplate[] };
		};
		const localConfig = example("## 3 ·", "## 4 ·") as {
			tools: Record<string, ToolConfig>;
		};
		const chip = sharedConfig.chips.templates.find((item) => item.intent === "refine");
		expect(chip).toBeDefined();
		expect(resolvePrompt(chip!, "claude", localConfig.tools)).toBe("/refine {{id}}");
		expect(resolvePrompt(chip!, "codex", localConfig.tools)).toBe("$refine {{id}}");
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
			const result = run(f.repo, { device: f.device, vault: f.vault });
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
				repo: "my-app",
				prompt: "$refine {{id}}",
			});
			write(
				join(f.vault, ".obsidian", "plugins", "dispatch", "data.json"),
				JSON.stringify(shared)
			);
			rmSync(join(f.repo, "scripts", "dispatch", "validate.mjs"));

			write(join(f.repo, "dispatch", "workflow", "refine.md"), "# Refine\n");
			write(
				join(f.repo, "dispatch", "invariants.md"),
				"# Invariants\nnode scripts/dispatch/validate.mjs\n"
			);

			const result = run(f.repo, { device: f.device, vault: f.vault });
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

			const result = run(f.repo, { device: f.device, vault: f.vault });
			expect(result.status).toBe(1);
			expect(result.output).toContain("multi-agent setup needs confirmBeforeRun true");
			expect(result.output).toContain(
				"unresolved placeholder in " + join(f.repo, ".codex", "skills", "refine", "SKILL.md")
			);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("allows ordinary double-angle syntax while rejecting placeholder tokens", () => {
		const f = fixture();
		try {
			write(join(f.repo, "CLAUDE.md"), "Example: git commit -F- <<'EOF'\n");
			write(join(f.repo, "AGENTS.md"), "Bit shift: `x << 2`\n");

			const result = run(f.repo, {
				script: join(f.repo, "scripts", "dispatch", "validate.mjs"),
			});
			expect(result.status).toBe(0);
			expect(result.output).toContain("Dispatch setup valid (project only)");
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("keeps the no-argument gate project-only even when a chip exports device settings", () => {
		const f = fixture();
		try {
			const local = f.local as {
				tools: { claude: { promptPrefix: string } };
				confirmBeforeRun: boolean;
			};
			local.tools.claude.promptPrefix = "wrong";
			local.confirmBeforeRun = false;
			write(f.device, JSON.stringify(local));

			const result = run(f.repo, {
				script: join(f.repo, "scripts", "dispatch", "validate.mjs"),
				env: { DISPATCH_LOCAL_SETTINGS: f.device },
			});
			expect(result.status).toBe(0);
			expect(result.output).toContain("Dispatch setup valid (project only)");
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("runs through a linked repository path instead of exiting silently", () => {
		const f = fixture();
		try {
			const linkedRepo = join(f.root, "repo-link");
			symlinkSync(f.repo, linkedRepo, process.platform === "win32" ? "junction" : "dir");
			rmSync(join(f.repo, "dispatch", "invariants.md"));

			const result = run(linkedRepo, {
				script: join(linkedRepo, "scripts", "dispatch", "validate.mjs"),
			});
			expect(result.status).toBe(1);
			expect(result.output).toContain("Dispatch setup validation failed");
			expect(result.output).toContain("invariants.md");
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});

	it("can be imported when the process entry argument is not a file", () => {
		const result = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`await import(${JSON.stringify(pathToFileURL(validator).href)})`,
				"not-a-file",
			],
			{ cwd: resolve("."), encoding: "utf8" }
		);
		expect(result.status).toBe(0);
		expect(result.stdout + result.stderr).toBe("");
	});

	it("matches product prompt resolution and validates the resolved override stub", async () => {
		const f = fixture();
		try {
			const module = (await import(pathToFileURL(validator).href)) as {
				resolveToolPrompt: (
					chip: ChipTemplate,
					tool: string,
					tools: Record<string, ToolConfig>
				) => string;
			};
			const chip = (f.shared as { chips: { templates: ChipTemplate[] } }).chips.templates[0];
			const local = f.local as { tools: Record<string, ToolConfig> };
			local.tools.codex.prompts = { refine: "$ticket-refine {{id}}" };
			write(f.device, JSON.stringify(local));
			rmSync(join(f.repo, ".codex", "skills", "refine"), { recursive: true, force: true });
			write(
				join(f.repo, ".codex", "skills", "ticket-refine", "SKILL.md"),
				"Read dispatch/workflow/refine.md\n"
			);

			for (const tool of Object.keys(local.tools)) {
				expect(module.resolveToolPrompt(chip, tool, local.tools)).toBe(
					resolvePrompt(chip, tool, local.tools)
				);
			}
			const result = run(f.repo, { device: f.device, vault: f.vault });
			expect(result.status).toBe(0);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
});

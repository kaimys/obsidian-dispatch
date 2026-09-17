/**
 * The unconfigured board is the first thing a new install shows, and its
 * button is the one launch that must work with nothing configured. These cover
 * the two decisions behind it: what the agent is told, and whether the button
 * can honestly promise to start anything on this device.
 *
 * Both used to assume Claude Code (US00002, 2026-09-17): the prompt told the
 * agent to run Claude's `/plugin` commands, and the button considered only the
 * default tool, so a device that could start only Codex saw it disabled.
 */
import { describe, expect, it } from "vitest";
import { INSTALL_ROUTES, setupLaunchState, setupPrompt } from "../src/setup";

describe("setupPrompt", () => {
	it("stays on one line", () => {
		// Chip prompts reach the shell as a single quoted argument and quoteArg
		// flattens newlines — a multi-line prompt would arrive mangled.
		expect(setupPrompt("C:\\Users\\me\\Vault")).not.toMatch(/\r?\n/);
	});

	it("names the vault, which an agent started in a repo cannot guess", () => {
		expect(setupPrompt("C:\\Users\\me\\Vault")).toContain("C:\\Users\\me\\Vault");
	});

	it("asks for the vault instead of inventing one when the path is unknown", () => {
		const prompt = setupPrompt("");
		expect(prompt).toMatch(/ask me where/i);
		expect(prompt).not.toContain("undefined");
	});

	it("names both agents' install commands, so it works before the skill exists", () => {
		const prompt = setupPrompt("/home/me/vault");
		for (const route of INSTALL_ROUTES) {
			expect(prompt).toContain(route.agent);
			for (const command of route.commands) expect(prompt).toContain(command);
		}
	});

	it("covers Claude Code and Codex, with the README's commands", () => {
		expect(INSTALL_ROUTES.map((route) => route.agent)).toEqual(["Claude Code", "Codex"]);
		expect(INSTALL_ROUTES[1].commands).toEqual([
			"codex plugin marketplace add kaimys/obsidian-dispatch",
			"codex plugin add dispatch-setup@dispatch",
		]);
	});

	it("does not tell whichever agent receives it to run Claude's slash commands", () => {
		// Copy the prompt cannot know which agent it is pasted into, and a Codex
		// session cannot run `/plugin` at all.
		expect(setupPrompt("/home/me/vault")).not.toMatch(/\brun \/plugin/);
	});

	it("asks for a new session once the skill is installed", () => {
		expect(setupPrompt("/home/me/vault")).toMatch(/new session/i);
	});

	it("names the skill it wants used", () => {
		expect(setupPrompt("/home/me/vault")).toContain("dispatch-setup");
	});
});

describe("setupLaunchState", () => {
	const claude = { command: 'start "Dispatch" /d {{cwd}} cmd /k claude {{prompt}}' };
	const codex = { command: 'start "Dispatch" /d {{cwd}} cmd /k codex {{prompt}}' };

	it("can launch when a tool command and a vault folder both exist", () => {
		const state = setupLaunchState({ claude }, "claude", "C:\\Vault");
		expect(state).toMatchObject({ tool: "claude", canLaunch: true, blocked: "" });
	});

	it("names the one agent it can start the way the dialog does", () => {
		// The confirmation dialog says "Run with Claude"; a button reading
		// "Set up with claude" spelled the same agent two ways.
		expect(setupLaunchState({ claude }, "claude", "C:\\Vault").label).toBe("Set up with Claude");
	});

	it("launches Codex on a device that can start only Codex, whatever the default says", () => {
		// The shared default is still `claude` on a fresh board. The button used
		// to check that tool alone and stay disabled.
		const state = setupLaunchState({ claude: { command: "" }, codex }, "claude", "C:\\Vault");
		expect(state).toMatchObject({
			tool: "codex",
			label: "Set up with Codex",
			canLaunch: true,
			blocked: "",
		});
	});

	// Replaces "falls back to claude when no default tool is set": with no
	// default, the button names whichever single agent this device can start,
	// which is no longer assumed to be Claude.
	it("names the only launchable agent when no default tool is set", () => {
		expect(setupLaunchState({ claude }, "", "C:\\Vault").tool).toBe("claude");
		expect(setupLaunchState({ codex }, "", "C:\\Vault").tool).toBe("codex");
	});

	it("leaves the choice to the confirmation dialog when several agents can start", () => {
		const state = setupLaunchState({ claude, codex }, "claude", "C:\\Vault");
		expect(state).toMatchObject({
			tool: "",
			label: "Set up with an agent",
			canLaunch: true,
			blocked: "",
		});
	});

	it("names the agent a click will start when confirmations are off", () => {
		// No dialog, so no choice: promising "an agent" would hide which one runs.
		expect(setupLaunchState({ claude, codex }, "codex", "C:\\Vault", false)).toMatchObject({
			tool: "codex",
			label: "Set up with Codex",
			canLaunch: true,
		});
	});

	it("blocks when no tool has a command on this device, naming both agents", () => {
		// The macOS and Linux defaults ship empty, so this is the common case.
		const state = setupLaunchState({ claude: { command: "" } }, "claude", "C:\\Vault");
		expect(state.canLaunch).toBe(false);
		expect(state.label).toBe("Set up with an agent");
		expect(state.blocked).toContain("claude");
		expect(state.blocked).toContain("codex");
		expect(state.blocked).toMatch(/copy the prompt/i);
	});

	it("blocks on a whitespace-only command rather than launching nothing", () => {
		expect(setupLaunchState({ claude: { command: "   " } }, "claude", "C:\\Vault").canLaunch).toBe(
			false
		);
	});

	it("blocks when no tool is defined at all", () => {
		const state = setupLaunchState({}, "codex", "C:\\Vault");
		expect(state.canLaunch).toBe(false);
		expect(state.blocked).toContain("claude");
		expect(state.blocked).toContain("codex");
	});

	it("blocks when the vault has no folder on disk", () => {
		// A non-FileSystemAdapter vault gives an empty base path; there is then
		// no working directory to start an agent in.
		const state = setupLaunchState({ claude }, "claude", "");
		expect(state.canLaunch).toBe(false);
		expect(state.blocked).toMatch(/nowhere to start/i);
	});

	it("always explains itself when it blocks", () => {
		const blocked = [
			setupLaunchState({}, "claude", "C:\\Vault"),
			setupLaunchState({ claude }, "claude", ""),
			setupLaunchState({ codex }, "claude", ""),
		];
		for (const state of blocked) expect(state.blocked.trim().length).toBeGreaterThan(0);
	});
});

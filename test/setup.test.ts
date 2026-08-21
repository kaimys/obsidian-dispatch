/**
 * The unconfigured board is the first thing a new install shows, and its
 * button is the one launch that must work with nothing configured. These cover
 * the two decisions behind it: what the agent is told, and whether the button
 * can honestly promise to start anything on this device.
 */
import { describe, expect, it } from "vitest";
import { INSTALL_COMMANDS, setupLaunchState, setupPrompt } from "../src/setup";

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

	it("carries its own install instructions, so it works before the skill exists", () => {
		const prompt = setupPrompt("/home/me/vault");
		for (const command of INSTALL_COMMANDS) expect(prompt).toContain(command);
	});

	it("names the skill it wants used", () => {
		expect(setupPrompt("/home/me/vault")).toContain("dispatch-setup");
	});
});

describe("setupLaunchState", () => {
	const configured = { claude: { command: 'start "Dispatch" /d {{cwd}} cmd /k claude {{prompt}}' } };

	it("can launch when a tool command and a vault folder both exist", () => {
		const state = setupLaunchState(configured, "claude", "C:\\Vault");
		expect(state).toMatchObject({ tool: "claude", canLaunch: true, blocked: "" });
	});

	it("falls back to claude when no default tool is set", () => {
		expect(setupLaunchState(configured, "", "C:\\Vault").tool).toBe("claude");
	});

	it("blocks when the tool has no command on this device", () => {
		// The macOS and Linux defaults ship empty, so this is the common case.
		const state = setupLaunchState({ claude: { command: "" } }, "claude", "C:\\Vault");
		expect(state.canLaunch).toBe(false);
		expect(state.blocked).toContain("claude");
	});

	it("blocks on a whitespace-only command rather than launching nothing", () => {
		expect(setupLaunchState({ claude: { command: "   " } }, "claude", "C:\\Vault").canLaunch).toBe(
			false
		);
	});

	it("blocks when the tool is not defined at all", () => {
		expect(setupLaunchState({}, "codex", "C:\\Vault").canLaunch).toBe(false);
		expect(setupLaunchState({}, "codex", "C:\\Vault").blocked).toContain("codex");
	});

	it("blocks when the vault has no folder on disk", () => {
		// A non-FileSystemAdapter vault gives an empty base path; there is then
		// no working directory to start an agent in.
		const state = setupLaunchState(configured, "claude", "");
		expect(state.canLaunch).toBe(false);
		expect(state.blocked).toMatch(/nowhere to start/i);
	});

	it("always explains itself when it blocks", () => {
		const blocked = [
			setupLaunchState({}, "claude", "C:\\Vault"),
			setupLaunchState(configured, "claude", ""),
		];
		for (const state of blocked) expect(state.blocked.trim().length).toBeGreaterThan(0);
	});
});

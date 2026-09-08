/**
 * What a chip launch puts in the child process's environment (US00001, code
 * review finding 1).
 *
 * `DISPATCH_LOCAL_SETTINGS` is documented as the channel by which a
 * Dispatch-scope script is handed its configuration — ADR-0027, the ADR-0023
 * amendment, `docs/installation.md` and `meet-fetch.mjs` all name it — and the
 * launch did not set it. The script's own fallback is "the single
 * `~/.dispatch/<vault>-<hash>.json` on the machine", and it refuses to guess
 * between two, so on a machine with more than one vault every chip-launched
 * `/meeting report` stopped and asked for `--config`.
 *
 * The path cannot be derived by the script: it is a hash of the vault's
 * absolute path, which only the plugin knows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const launched: { command: string; cwd: string; env?: Record<string, string> }[] = [];

vi.mock("../src/exec", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/exec")>()),
	launchDetached: (
		command: string,
		cwd: string,
		_onError: unknown,
		env?: Record<string, string>
	) => {
		launched.push({ command, cwd, env });
	},
}));

const { launchChip } = await import("../src/chips");

const SETTINGS_PATH = "C:\\Users\\kai\\.dispatch\\Dispatch-Wiki-7ea0c874.json";

/** The handful of plugin surfaces a chip launch actually touches. */
function fakePlugin(
	tools: Record<string, { command: string; prompts?: Record<string, string> }> = {
		claude: { command: "claude {{prompt}}" },
	},
	defaultTool = "claude"
) {
	return {
		app: { vault: { getAbstractFileByPath: () => null } },
		shared: {
			board: { titleProperty: "id", statusProperty: "status" },
			chips: { defaultTool },
		},
		local: { repos: {}, tools, confirmBeforeRun: false },
		runs: {
			append: () => undefined,
			path: () => "C:\\Users\\kai\\.dispatch\\runs\\Dispatch-Wiki-7ea0c874.jsonl",
			activeForCwd: () => [],
		},
		pendingRunCount: () => 0,
		getVaultBasePath: () => "C:\\Users\\kai\\Workspace\\Dispatch-Wiki",
		localSettingsPath: () => SETTINGS_PATH,
	};
}

describe("the chip launch environment", () => {
	beforeEach(() => {
		launched.length = 0;
	});

	const launch = () => {
		const plugin = fakePlugin();
		launchChip(
			plugin as unknown as Parameters<typeof launchChip>[0],
			{ label: "Read transcript & write report", prompt: "/meeting report {{title}}" },
			"09_Meetings-and-Workshops/2026-09-01 - Dispatch Introduction.md"
		);
		return launched[0];
	};

	it("names this vault's device file, so a repo-side script can find it", () => {
		expect(launch().env?.DISPATCH_LOCAL_SETTINGS).toBe(SETTINGS_PATH);
	});

	it("still carries the run-lifecycle variables the hooks report through", () => {
		// The same env block feeds RunTracker; adding to it must not displace it.
		const env = launch().env ?? {};
		expect(Object.keys(env).sort()).toEqual([
			"DISPATCH_LABEL",
			"DISPATCH_LOCAL_SETTINGS",
			"DISPATCH_NOTE",
			"DISPATCH_RUNS_FILE",
			"DISPATCH_RUN_ID",
			"DISPATCH_STARTED",
			"DISPATCH_TOOL",
		]);
		expect(env.DISPATCH_LABEL).toBe("Read transcript & write report");
	});

	it("names the agent that ran, so the note's run log can attribute it", () => {
		// The durable record is the note's `## Dispatch runs` line, written by
		// the lifecycle hook from this variable (US00002). With two agents on one
		// board, a run log that does not say who ran is not a record.
		expect(launch().env?.DISPATCH_TOOL).toBe("claude");
	});
});

describe("choosing the agent at click time", () => {
	beforeEach(() => {
		launched.length = 0;
	});

	const both = () => ({
		claude: { command: "claude {{prompt}}" },
		codex: { command: "codex {{prompt}}", prompts: { refine: "$refine {{title}}" } },
	});

	const launchWith = (
		tools: Record<string, { command: string; prompts?: Record<string, string> }>,
		chip: { label: string; intent?: string; tool?: string; prompt: string },
		defaultTool = "claude"
	) => {
		const plugin = fakePlugin(tools, defaultTool);
		launchChip(
			plugin as unknown as Parameters<typeof launchChip>[0],
			chip,
			"05_Requirements/Tickets/Story - US00002 - Support Codex as a chip tool.md"
		);
		return launched[launched.length - 1];
	};

	const refine = { label: "Refine", intent: "refine", prompt: "/refine {{title}}" };

	it("runs the chip's own tool with confirmations off, not merely the first configured one", () => {
		// `confirmBeforeRun: false` means "don't make me confirm" — it must not
		// start picking a different agent than the chip names.
		const run = launchWith(both(), { ...refine, tool: "codex" });
		expect(run.env?.DISPATCH_TOOL).toBe("codex");
		expect(run.command.startsWith("codex ")).toBe(true);
	});

	it("falls back to the shared default when the chip names no tool", () => {
		expect(launchWith(both(), refine).env?.DISPATCH_TOOL).toBe("claude");
		expect(launchWith(both(), refine, "codex").env?.DISPATCH_TOOL).toBe("codex");
	});

	it("launches each agent with the prompt that agent wants", () => {
		// The same chip, the same note — two spellings of one intention.
		const title = "Story - US00002 - Support Codex as a chip tool";
		expect(launchWith(both(), refine).command).toBe(`claude "/refine ${title}"`);
		expect(launchWith(both(), { ...refine, tool: "codex" }).command).toBe(
			`codex "$refine ${title}"`
		);
	});

	it("keeps the note's prompt for a tool that configured no override", () => {
		const title = "Story - US00002 - Support Codex as a chip tool";
		const tools = { codex: { command: "codex {{prompt}}" } };
		expect(launchWith(tools, { ...refine, tool: "codex" }, "codex").command).toBe(
			`codex "/refine ${title}"`
		);
	});

	it("still quotes an override into one argument", () => {
		// An override is device config rather than note content, but it reaches a
		// shell the same way and gets no more trust for it (ADR-0004).
		const tools = {
			codex: { command: "codex {{prompt}}", prompts: { refine: 'x"; rm -rf ~; echo "' } },
		};
		const command = launchWith(tools, { ...refine, tool: "codex" }, "codex").command;
		const arg = command.slice("codex ".length);
		expect(arg.startsWith('"')).toBe(true);
		expect(arg.endsWith('"')).toBe(true);
		expect(arg.slice(1, -1).match(/(?<!\\)"/)).toBeNull();
	});

	it("does not launch a tool whose command template is empty", () => {
		launchWith({ claude: { command: "" } }, refine);
		expect(launched.length).toBe(0);
	});
});

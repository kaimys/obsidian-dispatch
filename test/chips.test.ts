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
function fakePlugin() {
	return {
		app: { vault: { getAbstractFileByPath: () => null } },
		shared: {
			board: { titleProperty: "id", statusProperty: "status" },
			chips: { defaultTool: "claude" },
		},
		local: {
			repos: {},
			tools: { claude: { command: "claude {{prompt}}" } },
			confirmBeforeRun: false,
		},
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
		]);
		expect(env.DISPATCH_LABEL).toBe("Read transcript & write report");
	});
});

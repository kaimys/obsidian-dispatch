/**
 * The chip launch path is the one place where note content reaches a shell, so
 * these are the security tests: a prompt from a synced note must never be able
 * to end its own argument and start a command.
 */
import { describe, expect, it } from "vitest";
import {
	emptyVars,
	quoteArg,
	resolvePrompt,
	shellVars,
	substitute,
	toolChoices,
} from "../src/exec";
import type { ChipTemplate, ToolConfig } from "../src/settings";

describe("quoteArg", () => {
	it("wraps a plain value in one double-quoted argument", () => {
		expect(quoteArg("/refine US00042")).toBe('"/refine US00042"');
	});

	it("escapes the characters that would end the argument", () => {
		expect(quoteArg('say "hi"')).toBe('"say \\"hi\\""');
		expect(quoteArg("C:\\Users\\me")).toBe('"C:\\\\Users\\\\me"');
	});

	it("keeps shell metacharacters inside the quotes", () => {
		// A ticket titled like this must stay one argument, not two commands.
		const hostile = 'fix"; rm -rf ~; echo "';
		const quoted = quoteArg(hostile);
		expect(quoted.startsWith('"')).toBe(true);
		expect(quoted.endsWith('"')).toBe(true);
		// every inner quote is escaped, so none of them closes the argument
		expect(quoted.slice(1, -1).match(/(?<!\\)"/)).toBeNull();
	});

	it("flattens newlines, because a multiline prompt would break the command", () => {
		expect(quoteArg("line one\nline two")).toBe('"line one line two"');
		expect(quoteArg("crlf\r\nhere")).toBe('"crlf here"');
	});
});

describe("substitute", () => {
	it("replaces known placeholders and leaves unknown ones alone", () => {
		expect(substitute("claude {{prompt}}", { prompt: '"go"' })).toBe('claude "go"');
		// An unknown variable stays literal rather than collapsing to nothing,
		// so a broken template is visible instead of silently truncated.
		expect(substitute("claude {{nope}}", {})).toBe("claude {{nope}}");
	});

	it("substitutes every occurrence", () => {
		expect(substitute("{{a}} and {{a}}", { a: "x" })).toBe("x and x");
	});
});

describe("shellVars", () => {
	it("offers each value quoted, and unquoted under a Raw suffix", () => {
		const vars = shellVars({ cwd: "C:/my project" });
		expect(vars.cwd).toBe('"C:/my project"');
		expect(vars.cwdRaw).toBe("C:/my project");
	});

	it("adds a Raw alias for every key it is given", () => {
		// chips.ts never routes the prompt through here — it sets {{prompt}}
		// itself, which is why no {{promptRaw}} reaches a tool template.
		const vars = shellVars({ prompt: "/refine US1" });
		expect(vars.prompt).toBe('"/refine US1"');
		expect(Object.keys(vars).sort()).toEqual(["prompt", "promptRaw"]);
	});
});

const chip = (over: Partial<ChipTemplate> = {}): ChipTemplate => ({
	label: "Refine this ticket",
	prompt: "/refine {{id}}",
	...over,
});

const tools = (map: Record<string, ToolConfig>) => map;

describe("toolChoices", () => {
	const both = tools({
		claude: { command: "claude {{prompt}}" },
		codex: { command: "codex {{prompt}}" },
	});

	it("puts the chip's own tool first, then every other configured one", () => {
		expect(toolChoices(chip({ tool: "codex" }), both, "claude")).toEqual(["codex", "claude"]);
	});

	it("falls back to the shared default when the chip names no tool", () => {
		expect(toolChoices(chip(), both, "claude")).toEqual(["claude", "codex"]);
		expect(toolChoices(chip(), both, "codex")).toEqual(["codex", "claude"]);
	});

	it("offers the one configured tool on a single-tool device", () => {
		expect(toolChoices(chip(), tools({ claude: { command: "claude {{prompt}}" } }), "claude"))
			.toEqual(["claude"]);
	});

	it("does not offer a tool whose command template is empty", () => {
		// The non-Windows default ships `claude` with no command — a name in the
		// settings file, not something that runs. A button for it could only fail.
		const half = tools({ claude: { command: "" }, codex: { command: "codex {{prompt}}" } });
		expect(toolChoices(chip(), half, "claude")).toEqual(["codex"]);
		expect(toolChoices(chip(), tools({ claude: { command: "   " } }), "claude")).toEqual([]);
	});

	it("still offers the others when the preferred tool is not configured here", () => {
		// A chip pinned to a tool this device does not have is not a dead chip:
		// the tool is a default, not a constraint (ADR-0021).
		expect(toolChoices(chip({ tool: "gemini" }), both, "claude")).toEqual(["claude", "codex"]);
	});
});

describe("resolvePrompt", () => {
	const withOverride = tools({
		claude: { command: "claude {{prompt}}" },
		codex: { command: "codex {{prompt}}", prompts: { refine: "$refine {{id}}" } },
	});

	it("uses the tool's override for the chip's intent", () => {
		expect(resolvePrompt(chip({ intent: "refine" }), "codex", withOverride)).toBe(
			"$refine {{id}}"
		);
	});

	it("falls back to the chip's own prompt when the tool has no override", () => {
		expect(resolvePrompt(chip({ intent: "refine" }), "claude", withOverride)).toBe(
			"/refine {{id}}"
		);
		expect(resolvePrompt(chip({ intent: "develop" }), "codex", withOverride)).toBe(
			"/refine {{id}}"
		);
	});

	it("keys on the intent, not the label", () => {
		// Renaming the button must not silently drop the override — which is the
		// whole reason `intent` exists beside `label`.
		const renamed = chip({ intent: "refine", label: "Sharpen this spec" });
		expect(resolvePrompt(renamed, "codex", withOverride)).toBe("$refine {{id}}");
	});

	it("keys on the label when the chip declares no intent", () => {
		const byLabel = tools({
			codex: { command: "codex", prompts: { "Refine this ticket": "$refine {{id}}" } },
		});
		expect(resolvePrompt(chip(), "codex", byLabel)).toBe("$refine {{id}}");
	});

	it("falls back for an unknown tool, an absent map and an empty override", () => {
		expect(resolvePrompt(chip({ intent: "refine" }), "gemini", withOverride)).toBe(
			"/refine {{id}}"
		);
		expect(resolvePrompt(chip({ intent: "refine" }), "claude", withOverride)).toBe(
			"/refine {{id}}"
		);
		const blank = tools({ codex: { command: "codex", prompts: { refine: "" } } });
		expect(resolvePrompt(chip({ intent: "refine" }), "codex", blank)).toBe("/refine {{id}}");
	});

	it("swaps a leading slash for the tool's own invocation prefix", () => {
		// The ordinary case: same skill, same name, different sigil. One line of
		// config per tool instead of one per chip per tool.
		const codex = tools({ codex: { command: "codex", promptPrefix: "$" } });
		expect(resolvePrompt(chip(), "codex", codex)).toBe("$refine {{id}}");
	});

	it("leaves a prompt that is not a command completely alone", () => {
		// Column chips carry prose, not a slash command. Rewriting their first
		// character would corrupt the prompt for every batch run.
		const codex = tools({ codex: { command: "codex", promptPrefix: "$" } });
		const batch = chip({ label: "Refine all", prompt: "Work through these tickets: {{ids}}." });
		expect(resolvePrompt(batch, "codex", codex)).toBe("Work through these tickets: {{ids}}.");
	});

	it("changes nothing for a tool whose prefix is absent or already a slash", () => {
		expect(resolvePrompt(chip(), "claude", tools({ claude: { command: "claude" } }))).toBe(
			"/refine {{id}}"
		);
		const slash = tools({ claude: { command: "claude", promptPrefix: "/" } });
		expect(resolvePrompt(chip(), "claude", slash)).toBe("/refine {{id}}");
	});

	it("lets an explicit override beat the prefix", () => {
		// The prefix cannot express a skill installed under a different *name*,
		// which is the case the per-chip override exists for.
		const codex = tools({
			codex: { command: "codex", promptPrefix: "$", prompts: { refine: "$ticket-refine {{id}}" } },
		});
		expect(resolvePrompt(chip({ intent: "refine" }), "codex", codex)).toBe(
			"$ticket-refine {{id}}"
		);
	});

	it("rewrites only the first character, never a slash inside the prompt", () => {
		const codex = tools({ codex: { command: "codex", promptPrefix: "$" } });
		const withPath = chip({ prompt: "/meeting report wiki/09_Meetings/{{title}}" });
		expect(resolvePrompt(withPath, "codex", codex)).toBe(
			"$meeting report wiki/09_Meetings/{{title}}"
		);
	});

	it("gives an override no more trust than a note's prompt", () => {
		// An override is device config, but it still reaches a shell, so it goes
		// through the same single-argument quoting (ADR-0004).
		const hostile = tools({
			codex: { command: "codex {{prompt}}", prompts: { refine: 'x"; rm -rf ~; echo "' } },
		});
		const resolved = resolvePrompt(chip({ intent: "refine" }), "codex", hostile);
		const quoted = quoteArg(substitute(resolved, { id: "US00002" }));
		expect(quoted.startsWith('"')).toBe(true);
		expect(quoted.endsWith('"')).toBe(true);
		expect(quoted.slice(1, -1).match(/(?<!\\)"/)).toBeNull();
	});
});

describe("emptyVars", () => {
	it("names the supplied variables that resolve empty", () => {
		expect(emptyVars("/refine {{id}}", { id: "", status: "Backlog" })).toEqual(["id"]);
		expect(emptyVars("/refine {{id}}", { id: "US00002" })).toEqual([]);
	});

	it("ignores variables the caller does not supply", () => {
		// substitute() leaves those literal, which is a visible problem of its own.
		expect(emptyVars("{{nope}}", { id: "US1" })).toEqual([]);
	});

	it("names a repeated variable once", () => {
		expect(emptyVars("{{id}} and {{id}}", { id: " " })).toEqual(["id"]);
	});
});

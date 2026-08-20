/**
 * The chip launch path is the one place where note content reaches a shell, so
 * these are the security tests: a prompt from a synced note must never be able
 * to end its own argument and start a command.
 */
import { describe, expect, it } from "vitest";
import { quoteArg, shellVars, substitute } from "../src/exec";

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

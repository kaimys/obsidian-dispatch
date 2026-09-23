import { describe, expect, it, vi } from "vitest";
import {
	buildReport,
	classifyDeadends,
	closestProperty,
	collectRaw,
	commandSpecs,
	documentedProperties,
	formatReport,
	hasFindings,
	main,
	parseArgs,
	parseFrontmatter,
	parseJson,
	parseMarkdownPaths,
	parseUnresolved,
	templateProperties,
	validateVaultPaths,
} from "../scripts/dispatch/lint-vault.mjs";

const propertyReference = `
## Page types and their properties
| Property | Values |
| --- | --- |
| \`id\` | text |
| \`derived_from\` / \`maintained_by\` | links |
## Enumerations
| not_a_property | ignored |
`;

const rulebook = `---
deadend_prefixes:
  - 01_Sources/
deadend_paths:
  - 00_Start-Here/Home.md
---`;

const raw = {
	unresolved: JSON.stringify([{ link: "Missing", count: "2", sources: "A.md" }]),
	orphans: "image.png\r\nB.md\r\nA.md\r\nB.md\r\n",
	deadends: "01_Sources/Leaf.md\nNeeds a link.md\n00_Start-Here/Home.md\n",
	properties: JSON.stringify([
		{ name: "id", type: "text", count: 2 },
		{ name: "open_test", type: "number", count: 1 },
		{ name: "aliases", type: "multitext", count: 0 },
	]),
};

const inputs = {
	vault: "Dispatch-Wiki",
	propertyReference,
	rulebook,
	templates: ["---\nopen_tests:\nowner:\n---\n"],
	wikiFiles: ["A.md", "B.md", "image.png", "01_Sources/Leaf.md", "Needs a link.md", "00_Start-Here/Home.md"],
};

describe("vault lint parsing", () => {
	it("builds every CLI command with an explicit vault", () => {
		const specs = commandSpecs("Dispatch-Wiki");
		expect(specs.map((item) => item.key)).toEqual(["unresolved", "orphans", "deadends", "properties"]);
		for (const item of specs) expect(item.args).toContain("vault=Dispatch-Wiki");
		expect(() => commandSpecs(" ")).toThrow("required");
	});

	it("parses JSON arrays and rejects malformed or non-array output", () => {
		expect(parseJson("[]", "test")).toEqual([]);
		expect(() => parseJson("{}", "test")).toThrow("expected an array");
		expect(() => parseJson("no", "test")).toThrow("Invalid test JSON");
	});

	it("accepts the CLI's non-JSON clean unresolved response", () => {
		expect(parseUnresolved("No unresolved links found.\n")).toEqual([]);
		expect(parseUnresolved("[]")).toEqual([]);
	});

	it("keeps unique Markdown paths and ignores assets", () => {
		expect(parseMarkdownPaths("b.md\r\na.png\r\na.md\r\nb.md\r\n")).toEqual(["a.md", "b.md"]);
		expect(validateVaultPaths(["a.md", "image.png"], "test", {
			vault: "Dispatch-Wiki", wikiFiles: ["a.md", "image.png"],
		})).toEqual(["a.md", "image.png"]);
		expect(() => validateVaultPaths(["Other.md"], "test", inputs)).toThrow("active vault window");
	});

	it("reads frontmatter, schema tables and template keys", () => {
		expect(parseFrontmatter(rulebook)).toMatchObject({ deadend_prefixes: ["01_Sources/"] });
		expect([...documentedProperties(propertyReference)]).toEqual(["id", "derived_from", "maintained_by"]);
		expect([...templateProperties(inputs.templates)]).toEqual(["open_tests", "owner"]);
	});

	it("classifies only dead ends recorded in the rulebook", () => {
		expect(classifyDeadends(["01_Sources/A.md", "Other.md", "00_Start-Here/Home.md"], parseFrontmatter(rulebook)))
			.toEqual({ findings: ["Other.md"], intentional: ["01_Sources/A.md", "00_Start-Here/Home.md"] });
	});

	it("suggests close declared property names", () => {
		expect(closestProperty("open_test", new Set(["open_tests", "owner"]))).toBe("open_tests");
		expect(closestProperty("completely_different", new Set(["open_tests"]))).toBeNull();
	});

	it("normalizes all finding categories into a stable report", () => {
		const report = buildReport(raw, inputs);
		expect(report.unresolved).toEqual([{ link: "Missing", count: 2, sources: ["A.md"] }]);
		expect(report.orphans).toEqual(["A.md", "B.md"]);
		expect(report.deadends).toEqual({
			findings: ["Needs a link.md"],
			intentional: ["00_Start-Here/Home.md", "01_Sources/Leaf.md"],
		});
		expect(report.properties.undeclared).toEqual([
			{ name: "open_test", type: "number", count: 1, suggestion: "open_tests" },
		]);
		expect(report.properties.inUse.map((item) => item.name)).not.toContain("aliases");
		expect(report.properties.undeclared.map((item) => item.name)).not.toContain("aliases");
		expect(hasFindings(report)).toBe(true);
		expect(formatReport(report)).toContain("Result: findings");
	});

	it("recognizes a clean report even when intentional dead ends remain", () => {
		const report = buildReport({ unresolved: "[]", orphans: "", deadends: "01_Sources/Leaf.md\n", properties: "[]" }, inputs);
		expect(hasFindings(report)).toBe(false);
		expect(formatReport(report)).toContain("Result: clean");
	});
});

describe("vault lint orchestration", () => {
	it("returns distinct clean, findings and operational-error exit codes", () => {
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const runner = (_cli: string, args: string[]) => ({
			status: 0,
			stdout: args[0] === "vault" ? "Dispatch-Wiki\n" : args[0] === "unresolved" ? "[]" : args[0] === "properties" ? "[]" : "",
			stderr: "",
		});
		expect(main(["--vault", "Dispatch-Wiki", "--format", "json"], { runner, inputs })).toBe(0);
		const findingRunner = (_cli: string, args: string[]) => ({
			status: 0,
			stdout: args[0] === "vault" ? "Dispatch-Wiki\n" : args[0] === "unresolved" ? raw.unresolved : args[0] === "properties" ? "[]" : "",
			stderr: "",
		});
		expect(main(["--vault", "Dispatch-Wiki"], { runner: findingRunner, inputs })).toBe(1);
		expect(main(["--vault", "Dispatch-Wiki"], {
			runner: () => ({ status: 1, stdout: "", stderr: "The CLI is unable to find Obsidian" }), inputs,
		})).toBe(2);
		expect(stdout).toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("unable to find Obsidian"));
		stdout.mockRestore();
		stderr.mockRestore();
	});

	it("passes argument arrays to the CLI and returns all output", () => {
		const runner = vi.fn((_cli: string, args: string[]) => ({
			status: 0, stdout: args[0] === "vault" ? "Dispatch-Wiki\n" : `${args[0]} output`, stderr: "",
		}));
		expect(collectRaw("Dispatch-Wiki", { runner, cli: "obsidian" })).toEqual({
			unresolved: "unresolved output",
			orphans: "orphans output",
			deadends: "deadends output",
			properties: "properties output",
		});
		expect(runner).toHaveBeenCalledTimes(12);
		for (const [, args] of runner.mock.calls) expect(args).toContain("vault=Dispatch-Wiki");
	});

	it("surfaces missing executables and stopped Obsidian", () => {
		expect(() => collectRaw("Dispatch-Wiki", {
			runner: () => ({ status: null, stdout: "", stderr: "", error: new Error("ENOENT") }),
		})).toThrow("Could not run obsidian");
		expect(() => collectRaw("Dispatch-Wiki", {
			runner: () => ({ status: 1, stdout: "", stderr: "The CLI is unable to find Obsidian" }),
		})).toThrow("unable to find Obsidian");
	});

	it("refuses output from a different vault", () => {
		expect(() => collectRaw("Dispatch-Wiki", {
			runner: (_cli: string, args: string[]) => ({
				status: 0, stdout: args[0] === "vault" ? "Other\n" : "[]", stderr: "",
			}),
		})).toThrow("active vault window \"Other\"");
	});

	it("fails when the active vault changes between data calls", () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		let dataCalls = 0;
		const runner = (_cli: string, args: string[]) => {
			if (args[0] === "vault") {
				return { status: 0, stdout: dataCalls >= 2 ? "Other\n" : "Dispatch-Wiki\n", stderr: "" };
			}
			dataCalls += 1;
			return { status: 0, stdout: args[0] === "unresolved" || args[0] === "properties" ? "[]" : "", stderr: "" };
		};
		expect(main(["--vault", "Dispatch-Wiki"], { runner, inputs })).toBe(2);
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining('active vault window "Other"'));
		stderr.mockRestore();
	});

	it("fails closed on unknown paths and exit-zero CLI errors", () => {
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const runner = (_cli: string, args: string[]) => ({
			status: 0,
			stdout: args[0] === "vault" ? "Dispatch-Wiki\n" : args[0] === "unresolved" || args[0] === "properties" ? "[]" :
				args[0] === "orphans" ? "Other.md\n" : "",
			stderr: "",
		});
		expect(main(["--vault", "Dispatch-Wiki"], { runner, inputs })).toBe(2);
		expect(stderr).toHaveBeenLastCalledWith(expect.stringContaining("outside Dispatch-Wiki"));

		const errorRunner = (_cli: string, args: string[]) => ({
			status: 0,
			stdout: args[0] === "vault" ? "Dispatch-Wiki\n" : args[0] === "unresolved" || args[0] === "properties" ? "[]" :
				args[0] === "deadends" ? 'Error: Command "deadends" not found.\n' : "",
			stderr: "",
		});
		expect(main(["--vault", "Dispatch-Wiki"], { runner: errorRunner, inputs })).toBe(2);
		expect(stderr).toHaveBeenLastCalledWith(expect.stringContaining('Command "deadends" not found'));
		stdout.mockRestore();
		stderr.mockRestore();
	});

	it("requires the vault and validates output format", () => {
		expect(parseArgs(["--vault", "Dispatch-Wiki"])).toEqual({ vault: "Dispatch-Wiki", wiki: "wiki", format: "text" });
		expect(parseArgs(["--vault", "Other", "--wiki", "vault", "--format", "json"])).toEqual({
			vault: "Other", wiki: "vault", format: "json",
		});
		expect(() => parseArgs([])).toThrow("Usage");
		expect(() => parseArgs(["--vault", "X", "--format", "xml"])).toThrow("text or json");
	});
});

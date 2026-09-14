import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const setup = "plugins/dispatch-setup/skills/dispatch-setup";
const commands = `${setup}/assets/commands`;
const templates = `${setup}/assets/templates`;
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const markdownFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
const inventory = markdownFiles(commands);
const catalogSurfaces = ["docs/skills.md", `${setup}/SKILL.md`, `${commands}/README.md`];

function region(text: string, name: string): string {
	const start = `<!-- ${name}:start -->`;
	const end = `<!-- ${name}:end -->`;
	if (text.split(start).length !== 2 || text.split(end).length !== 2) throw new Error(`Missing or repeated ${name} markers`);
	const from = text.indexOf(start) + start.length;
	const to = text.indexOf(end);
	if (to < from) throw new Error(`Reversed ${name} markers`);
	return text.slice(from, to);
}

function catalogRows(text: string): string[] {
	return [...region(text, "shipped-workflows").matchAll(/^\| `[a-z-]+\.md` \|.*$/gm)].map((m) => m[0].trim());
}

function advertised(text: string): string[] {
	return catalogRows(text).map((row) => /^\| `([a-z-]+\.md)` \|/.exec(row)![1]);
}

function checkInventory(files: string[], rows: string[]): void {
	if (new Set(rows).size !== rows.length) throw new Error("Duplicate workflow row");
	if (JSON.stringify([...files].sort()) !== JSON.stringify([...rows].sort())) throw new Error("Workflow inventory drift");
}

function substitute(text: string, values: Record<string, string>): string {
	return text.replace(/<<([A-Z_]+)>>/g, (_, name: string) => {
		if (!(name in values)) throw new Error(`Missing substitution: ${name}`);
		return values[name]; // Callback preserves $&, dollar prefixes and Windows paths.
	});
}

// Raw, because YAML would read `[version]` as a flow sequence rather than the hint text.
function argumentHint(text: string): string {
	const match = /^argument-hint: (.+)$/m.exec(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "");
	if (!match) throw new Error("Missing argument-hint");
	return match[1];
}

function frontmatter(text: string): Record<string, unknown> {
	const match = /^---\n([\s\S]*?)\n---/.exec(text);
	if (!match) throw new Error("Missing frontmatter");
	return parse(match[1]) as Record<string, unknown>;
}

describe("shipped workflow inventory", () => {
	for (const path of catalogSurfaces) {
		it(`matches actual files in ${path}`, () => checkInventory(inventory, advertised(read(path))));
	}

	it("advertises the same Reads, Writes and authority on every surface", () => {
		const [reference, ...rest] = catalogSurfaces.map((path) => catalogRows(read(path)));
		rest.forEach((surface, i) => expect(surface, catalogSurfaces[i + 1]).toEqual(reference));
	});

	it("detects missing, extra and duplicated advertised workflows", () => {
		const rows = advertised(read("docs/skills.md"));
		expect(() => checkInventory(inventory, rows.slice(1))).toThrow("drift");
		expect(() => checkInventory(inventory, [...rows, "obsolete.md"])).toThrow("drift");
		expect(() => checkInventory(inventory, [...rows, rows[0]])).toThrow("Duplicate");
		expect(() => checkInventory([...inventory, "new-workflow.md"], rows)).toThrow("drift");
	});

	it("does not count optional examples outside the shipped table", () => {
		const text = read("docs/skills.md");
		expect(advertised(`${text}\n| \`optional.md\` | example |`)).toEqual(advertised(text));
		expect(() => advertised(text.replace("<!-- shipped-workflows:end -->", ""))).toThrow("markers");
	});

	it("does not advertise removed command invocations on current product surfaces", () => {
		const paths = [...catalogSurfaces,
			...inventory.map((f) => join(commands, f)), ...markdownFiles("dispatch/workflow").map((f) => join("dispatch/workflow", f))];
		for (const path of paths) expect(read(path), path).not.toMatch(/[/\$]promote\b/);
	});
});

interface SetupFixture {
	values: Record<string, string>;
	board: { columns: { value: string }[]; automations: { set: Record<string, string> }[] };
	milestones: { completedProperty: string };
	extraColumns: string[];
}

describe("starter substitution contract", () => {
	const assets = [...inventory.map((f) => join(commands, f)), ...markdownFiles(templates).map((f) => join(templates, f))];
	const documentation = `${read(`${commands}/README.md`)}\n${read(`${templates}/README.md`)}`;
	const documented = new Set([...documentation.matchAll(/^\| `<<([A-Z_]+)>>` \|/gm)].map((m) => m[1]));

	it("documents every token used by workflow and note assets", () => {
		for (const path of assets) {
			for (const match of read(path).matchAll(/<<([A-Z_]+)>>/g)) expect(documented.has(match[1]), `${path}: ${match[1]}`).toBe(true);
		}
	});

	for (const name of ["solo", "queued"]) {
		it(`substitutes the ${name} setup without changing data or leaving tokens`, () => {
			const fixture = JSON.parse(read(`test/fixtures/workflow-catalog/${name}.json`)) as SetupFixture;
			const columnNames = fixture.board.columns.map((c) => c.value);
			const rendered = new Map(assets.map((path) => [path, substitute(read(path), fixture.values)]));
			for (const [path, text] of rendered) {
				expect(text, path).not.toMatch(/<<[^>]+>>/);
				expect(frontmatter(text), path).toBeTypeOf("object");
			}
			for (const file of markdownFiles(templates)) expect(frontmatter(rendered.get(join(templates, file))!), file).toHaveProperty("owner");
			for (const file of ["ticket-story.md", "ticket-bug.md"]) {
				const fm = frontmatter(rendered.get(join(templates, file))!);
				expect(fm.status).toBe(fixture.values.S_NEW);
				expect(fm).toHaveProperty(fixture.milestones.completedProperty, null);
				expect(fm.open_tests).toBeNull();
				expect(fm.open_findings).toBeNull();
			}
			expect(fixture.board.automations[0].set).toEqual({ [fixture.values.P_COMPLETED]: "{{date}}" });
			expect(fixture.milestones.completedProperty).toBe(fixture.values.P_COMPLETED);
			for (const key of Object.keys(fixture.values).filter((k) => k.startsWith("S_"))) {
				expect(columnNames).toContain(fixture.values[key]);
			}
			for (const extra of fixture.extraColumns) {
				expect(columnNames).toContain(extra);
				expect(Object.entries(fixture.values).filter(([k]) => k.startsWith("S_")).map(([, v]) => v)).not.toContain(extra);
			}
			expect(rendered.get(join(commands, "fix-bug.md"))).toContain(`${fixture.values.WIKI}/${fixture.values.TICKETS}`);
			if (name === "solo") {
				expect(fixture.values.TRACKER).toBe("none");
				expect(fixture.values.CHAT).toBe("none");
				expect(fixture.values.S_READY_DEV).toBe(fixture.values.S_REFINEMENT);
			} else {
				expect(fixture.values.WIKI).toContain("$&");
				expect(fixture.values.S_READY_DEV).not.toBe(fixture.values.S_REFINEMENT);
			}
		});
	}

	it("rejects incomplete maps and preserves shell-looking values literally", () => {
		expect(() => substitute("<<WIKI>>/<<TICKETS>>", { WIKI: "wiki" })).toThrow("TICKETS");
		expect(substitute("<<WIKI>>", { WIKI: "C:\\Team $& vault\\$1" })).toBe("C:\\Team $& vault\\$1");
	});
});

describe("agent stub hand-off examples", () => {
	for (const agent of ["claude", "codex"]) {
		it(`${agent} examples point every workflow at its single body`, () => {
			const example = region(read(`${setup}/SKILL.md`), `${agent}-stub`).match(/```markdown\n([\s\S]*?)\n```/)![1];
			for (const file of inventory) {
				const name = file.slice(0, -3);
				const body = read(join(commands, file));
				const description = frontmatter(body).description as string;
				const hint = argumentHint(body);
				const stub = example.replaceAll("<name>", name).replace("Workflow description", description).replace("<hint>", hint);
				expect(stub).toContain(`dispatch/workflow/${file}`);
				expect(stub).toContain("<ARGS>");
				expect(stub.replace(/^---\n[\s\S]*?\n---/, "")).not.toMatch(/open_questions|open_tests|open_findings|frozen:|<<[A-Z_]+>>/);
				expect(body).not.toContain("$ARGUMENTS");
				expect(frontmatter(stub).description).toBe(description);
				if (agent === "claude") {
					expect(stub).toContain("substitute: $ARGUMENTS");
					expect(argumentHint(stub), file).toBe(hint);
				} else {
					expect(frontmatter(stub).name).toBe(name);
					expect(stub, file).toContain(`invoked with (\`${hint}\`)`);
				}
			}
		});
	}
});

/**
 * `SETTING_INDEX` restates every setting's name and description so Obsidian's
 * settings search (1.13+) can find them, while `display()` keeps doing the
 * rendering for older versions. Two copies of the same list drift, and a
 * drifted copy fails silently — the setting simply stops being findable.
 *
 * So this reads the real `display()` source and holds the two in step. It
 * parses text rather than importing the tab, because `settings-tab.ts` extends
 * `PluginSettingTab`, which only exists inside the app.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SETTING_INDEX } from "../src/settings-index";

const source = readFileSync(fileURLToPath(new URL("../src/settings-tab.ts", import.meta.url)), "utf8");

/** Every `.setName("…")` in display(), split into headings and settings. */
function parseDisplay(): { headings: string[]; settings: string[] } {
	const headings: string[] = [];
	const settings: string[] = [];
	// Each block starts at a `new Setting(` call; a block containing
	// `.setHeading()` opens a group, anything else is a row.
	for (const block of source.split("new Setting(").slice(1)) {
		const name = /\.setName\(\s*"((?:[^"\\]|\\.)*)"/.exec(block)?.[1];
		if (name === undefined) continue;
		const unescaped = name.replace(/\\"/g, '"');
		if (block.slice(0, 300).includes(".setHeading()")) headings.push(unescaped);
		else settings.push(unescaped);
	}
	return { headings, settings };
}

describe("the settings search index matches what display() renders", () => {
	const rendered = parseDisplay();

	it("finds the settings tab source at all", () => {
		// Guards the parser itself: a rename or refactor that breaks the split
		// would otherwise make every assertion below vacuously pass.
		expect(rendered.settings.length).toBeGreaterThan(20);
		expect(rendered.headings.length).toBeGreaterThan(3);
	});

	it("covers every group heading, in order", () => {
		expect(SETTING_INDEX.map((g) => g.heading)).toEqual(rendered.headings);
	});

	it("covers every setting, in order", () => {
		const indexed = SETTING_INDEX.flatMap((g) => g.items.map((i) => i.name));
		expect(indexed).toEqual(rendered.settings);
	});

	it("gives every entry a name", () => {
		for (const group of SETTING_INDEX) {
			for (const item of group.items) expect(item.name.trim()).not.toBe("");
		}
	});

	it("has no duplicate names, which would make a search hit ambiguous", () => {
		const names = SETTING_INDEX.flatMap((g) => g.items.map((i) => i.name));
		expect(new Set(names).size).toBe(names.length);
	});
});

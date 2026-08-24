/**
 * Guards BUG00002.
 *
 * Obsidian 1.13 renders a settings tab from `getSettingDefinitions()` and stops
 * calling `display()` as soon as that array comes back non-empty
 * (`obsidian.d.ts:6633`). Dispatch 0.2.3 implemented it with name/desc metadata
 * only, to feed the settings search, and shipped a settings tab where all 37
 * rows rendered as labels with no input — on every Obsidian 1.13 or later.
 *
 * `obsidianmd/settings-tab/prefer-setting-definitions` recommends exactly that
 * change, so this is a trap the linter walks you back into. Adopting the API is
 * fine, but only as a full port: every row carrying a `control` or `render`, and
 * `minAppVersion` raised to 1.13 (ADR-0017). Partway is the bug.
 *
 * Parses text rather than importing the tab, because `settings-tab.ts` extends
 * `PluginSettingTab`, which only exists inside the app.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../src/settings-tab.ts", import.meta.url)), "utf8");

/** Strips block and line comments, so the warning prose doesn't count as code. */
function code(): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("the settings tab renders through display()", () => {
	it("finds the settings tab source at all", () => {
		// Guards the parser: a rename would otherwise make every assertion vacuous.
		expect(source).toContain("class DispatchSettingTab");
		expect(code()).toContain("display()");
	});

	it("does not implement getSettingDefinitions(), which would suppress display()", () => {
		expect(code()).not.toContain("getSettingDefinitions");
	});

	it("still builds controls, not just names and descriptions", () => {
		// The 0.2.3 symptom was rows with a name and a desc and no control.
		const controls = code().match(/\.add(Text|TextArea|Toggle|Dropdown|Button|Slider)\(/g) ?? [];
		expect(controls.length).toBeGreaterThan(20);
	});
});

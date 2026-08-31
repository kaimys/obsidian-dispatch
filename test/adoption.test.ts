/**
 * The device-config adoption matcher (US00024) has exactly one job: decide
 * whether a same-named `~/.dispatch/*.json` under a different hash exists,
 * and stay silent whenever that isn't unambiguous. These are the cases that
 * make "silent whenever ambiguous" an assertion rather than a claim in prose.
 */
import { describe, expect, it } from "vitest";
import { findAdoptionCandidate } from "../src/adoption";

describe("findAdoptionCandidate", () => {
	it("finds a same-named file under a different hash", () => {
		const files = ["docs-abc12345.json", "Constanze-Obsidian-96d7f2ee.json"];
		expect(findAdoptionCandidate(files, "docs", "docs-e7f737f3.json")).toBe("docs-abc12345.json");
	});

	it("returns null when the vault's own name changed (the docs → Dispatch-Wiki shape)", () => {
		const files = ["docs-e7f737f3.json", "Constanze-Obsidian-96d7f2ee.json"];
		expect(findAdoptionCandidate(files, "Dispatch-Wiki", "Dispatch-Wiki-7df67544.json")).toBeNull();
	});

	it("returns null when nothing matches", () => {
		expect(findAdoptionCandidate(["Constanze-Obsidian-96d7f2ee.json"], "docs", "docs-e7f737f3.json")).toBeNull();
	});

	it("returns null on more than one match, rather than guessing", () => {
		const files = ["docs-abc12345.json", "docs-def67890.json"];
		expect(findAdoptionCandidate(files, "docs", "docs-e7f737f3.json")).toBeNull();
	});

	it("never matches the vault's own current file", () => {
		const files = ["docs-e7f737f3.json"];
		expect(findAdoptionCandidate(files, "docs", "docs-e7f737f3.json")).toBeNull();
	});

	it("does not match a name that merely starts with the same characters", () => {
		const files = ["docs-old-e7f737f3.json"];
		expect(findAdoptionCandidate(files, "docs", "docs-current.json")).toBeNull();
	});
});

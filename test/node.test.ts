/**
 * `src/node.ts` describes the Node API with hand-written signatures rather
 * than `@types/node`, so the compiler cannot tell us when one of them is
 * wrong — it believes whatever the assertion claims. These tests are that
 * missing check: they call the boundary and compare against the real modules.
 *
 * A failure here means a declared signature has drifted from Node's, which the
 * type system will not catch anywhere else in the plugin.
 */
import { basename as realBasename, dirname as realDirname, join as realJoin } from "node:path";
import { homedir as realHomedir, tmpdir as realTmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { basename, dirname, environment, homedir, join, platform, tmpdir } from "../src/node";
import { DEFAULT_LOCAL } from "../src/settings";

describe("path helpers behave like node's", () => {
	it("joins the way path.join does, including multiple segments", () => {
		expect(join("a", "b", "c.json")).toBe(realJoin("a", "b", "c.json"));
		expect(join(homedir(), ".dispatch", "x.json")).toBe(
			realJoin(realHomedir(), ".dispatch", "x.json")
		);
	});

	it("splits the way dirname and basename do", () => {
		const p = realJoin("one", "two", "three.jsonl");
		expect(dirname(p)).toBe(realDirname(p));
		expect(basename(p)).toBe(realBasename(p));
	});
});

describe("os helpers", () => {
	it("return the real home and temp directories", () => {
		expect(homedir()).toBe(realHomedir());
		expect(tmpdir()).toBe(realTmpdir());
	});
});

describe("process access", () => {
	// Read through the `process` module rather than the global; if that import
	// ever stops resolving these degrade to "" and {} instead of throwing,
	// which would silently change DEFAULT_LOCAL rather than fail loudly.
	it("reports the real platform", () => {
		expect(platform()).toBe(process.platform);
		expect(platform()).not.toBe("");
	});

	it("exposes a populated environment", () => {
		expect(Object.keys(environment()).length).toBeGreaterThan(0);
	});

	it("still decides the default tool command per platform", () => {
		// The Windows default is the only launch command that ships; if
		// platform() broke, Windows users would silently get an empty one.
		const command = DEFAULT_LOCAL.tools.claude.command;
		if (process.platform === "win32") expect(command).toContain("claude");
		else expect(command).toBe("");
	});
});

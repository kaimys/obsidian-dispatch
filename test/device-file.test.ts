/**
 * The device file has two writers (US00001, code review finding 2).
 *
 * The plugin reads `~/.dispatch/<vault>-<hash>.json` once at load and writes it
 * back whenever a device setting changes. `meet-fetch.mjs` writes the `google`
 * block of the same file after OAuth consent, and a user pastes a client id
 * into it by hand — both while Obsidian is running. Serialising the copy read
 * at load silently discarded the refresh token the user had just granted, and
 * the next fetch asked for consent again with nothing to explain it.
 *
 * `saveLocal()` is three lines around `mergeDeviceFile`, so these assert the
 * rule itself; the file round-trip is exercised through the real path in the
 * manual test plan (Obsidian open, `--auth`, then change a setting).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL, LocalSettings, mergeDeviceFile } from "../src/settings";

/** What the plugin holds in memory: read at load, before the script wrote. */
const inMemory = (): LocalSettings => ({
	...DEFAULT_LOCAL,
	calendarUrl: "https://calendar.google.com/…/basic.ics",
	repos: { dispatch: "C:/Users/kai/Workspace/obsidian-dispatch" },
	google: { client_id: "123.apps.googleusercontent.com", client_secret: "s3cret" },
});

/** What is on disk after `meet-fetch.mjs --auth` has run. */
const onDisk = (google: unknown) =>
	JSON.stringify({ ...inMemory(), google }, null, 2);

describe("mergeDeviceFile", () => {
	it("keeps a refresh token the script wrote while Obsidian was open", () => {
		const merged = mergeDeviceFile(
			inMemory(),
			onDisk({
				client_id: "123.apps.googleusercontent.com",
				client_secret: "s3cret",
				refresh_token: "1//granted-just-now",
			})
		);
		expect(merged.google.refresh_token).toBe("1//granted-just-now");
	});

	it("keeps a client pasted in by hand, in the console's nested shape", () => {
		// docs/installation.md tells the user to paste the downloaded JSON as it
		// comes, with no "close Obsidian first".
		const merged = mergeDeviceFile(
			inMemory(),
			onDisk({ installed: { client_id: "pasted", client_secret: "by hand" } })
		);
		expect(merged.google).toEqual({ installed: { client_id: "pasted", client_secret: "by hand" } });
	});

	it("does not let the disk copy overwrite what the plugin owns", () => {
		// The settings tab is the only writer of everything else, and its copy is
		// the newer one — only `google` comes back from disk.
		const local = inMemory();
		local.calendarUrl = "https://calendar.google.com/…/changed.ics";
		const merged = mergeDeviceFile(local, onDisk({ refresh_token: "1//token" }));
		expect(merged.calendarUrl).toBe("https://calendar.google.com/…/changed.ics");
		expect(merged.repos).toEqual(local.repos);
	});

	it("leaves the in-memory block alone when the file has none", () => {
		const merged = mergeDeviceFile(inMemory(), JSON.stringify({ repos: {} }));
		expect(merged.google.client_id).toBe("123.apps.googleusercontent.com");
	});

	it("saves anyway when the file is missing or unreadable", () => {
		// Refusing to write would lose the change the user just made, and there
		// is nothing on disk to preserve.
		expect(mergeDeviceFile(inMemory(), null).google.client_secret).toBe("s3cret");
		expect(mergeDeviceFile(inMemory(), "{ not json").google.client_secret).toBe("s3cret");
	});
});

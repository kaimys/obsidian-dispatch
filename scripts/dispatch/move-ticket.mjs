#!/usr/bin/env node
/**
 * Dispatch board automation — push a ticket's status change to GitHub Issues.
 *
 * Wired from the vault's `data.json` as an automation command:
 *
 *   node scripts/dispatch/move-ticket.mjs {{file}} {{from}} {{to}}
 *
 * Dispatch runs it with cwd = the repo root and `{{file}}` = the note's
 * VAULT-relative path. This vault lives at `docs/` inside this repo, so the
 * note is resolved against VAULT_DIR below — get that wrong and every run
 * silently reports "note not found".
 *
 * Mapping. GitHub issues have no columns, only state, so only the two ends of
 * the pipeline have a tracker counterpart:
 *
 *   Done      -> close (completed)
 *   Rejected  -> close (not planned)
 *   anything  -> reopen if the issue is closed, otherwise nothing to do
 *
 * A ticket is linked to its issue through the `discussion:` frontmatter
 * property (the board's discussionProperty) holding the issue URL. A ticket
 * without one is not an error: it is a ticket that has no tracker counterpart,
 * so we say so and exit 0.
 *
 * Prints exactly ONE line — Dispatch surfaces it as the Obsidian notice.
 *
 * Zero dependencies, fully synchronous (so there is no libuv teardown race on
 * Windows), and it never calls process.exit() — it sets process.exitCode.
 *
 * Usage: node scripts/dispatch/move-ticket.mjs <note> <from> <to> [--dry-run]
 */
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/** Vault root, relative to the repo root. */
const VAULT_DIR = "docs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [notePath, from, to] = args.filter((a) => a !== "--dry-run");

main();

function main() {
	if (!notePath || !to) {
		say("move-ticket: usage: move-ticket.mjs <note> <from> <to> [--dry-run]", 1);
		return;
	}

	const file = resolveNote(notePath);
	if (!file) {
		say(`move-ticket: note not found: ${notePath}`, 1);
		return;
	}

	const fm = frontmatter(readFileSync(file, "utf8"));
	const ticket = fm.id || notePath.replace(/^.*[\\/]/, "").replace(/\.md$/, "");
	const issue = issueNumber(fm.discussion);

	if (!issue) {
		say(`${ticket}: no GitHub issue linked — tracker skipped`);
		return;
	}

	const action = plan(to);
	if (!action) {
		say(`${ticket}: ${from || "(none)"} → ${to} has no GitHub counterpart — tracker skipped`);
		return;
	}

	const state = dryRun ? "OPEN" : issueState(issue);
	if (state === null) {
		say(`${ticket}: could not read issue #${issue} — tracker not updated`, 1);
		return;
	}

	if (action.state === state) {
		say(`${ticket}: issue #${issue} already ${state.toLowerCase()} — nothing to do`);
		return;
	}

	if (dryRun) {
		say(`${ticket}: would run \`gh ${action.argv.join(" ")} ${issue}\` (dry run)`);
		return;
	}

	try {
		execFileSync("gh", [...action.argv, String(issue)], { encoding: "utf8", stdio: "pipe" });
		say(`${ticket}: issue #${issue} ${action.done}`);
	} catch (err) {
		const detail = (err.stderr || err.message || "").split("\n")[0].trim();
		say(`${ticket}: GitHub update failed — ${detail}`, 1);
	}
}

/** What the destination column means on GitHub. Null = no counterpart. */
function plan(to) {
	if (to === "Done") {
		return {
			state: "CLOSED",
			done: "closed as completed",
			argv: ["issue", "close", "--reason", "completed"],
		};
	}
	if (to === "Rejected") {
		return {
			state: "CLOSED",
			done: "closed as not planned",
			argv: ["issue", "close", "--reason", "not planned"],
		};
	}
	// Backlog / In progress / Review all mean "still open".
	return { state: "OPEN", done: "reopened", argv: ["issue", "reopen"] };
}

/** OPEN | CLOSED, or null when the issue can't be read. */
function issueState(issue) {
	try {
		const out = execFileSync("gh", ["issue", "view", String(issue), "--json", "state", "-q", ".state"], {
			encoding: "utf8",
			stdio: "pipe",
		});
		return out.trim().toUpperCase() || null;
	} catch {
		return null;
	}
}

/** The note as Dispatch names it is vault-relative; try that, then the raw path. */
function resolveNote(p) {
	for (const candidate of [resolve(VAULT_DIR, p), resolve(p)]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** Flat scalar frontmatter keys — enough to read `id` and `discussion`. */
function frontmatter(content) {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const out = {};
	if (!m) return out;
	for (const line of m[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!kv) continue;
		out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
	}
	return out;
}

/** Issue number out of a github.com issue URL (or a bare `#12` / `12`). */
function issueNumber(discussion) {
	if (!discussion) return null;
	const url = discussion.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
	if (url) return Number(url[1]);
	const bare = discussion.match(/^#?(\d+)$/);
	return bare ? Number(bare[1]) : null;
}

/** One line out, and an exit code Dispatch reads as success or failure. */
function say(message, code = 0) {
	process.stdout.write(message + "\n");
	if (code) process.exitCode = code;
}

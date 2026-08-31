#!/usr/bin/env node
/**
 * Dispatch board automation — push a ticket's status change to GitHub Issues.
 *
 * Wired from the vault's `data.json` as an automation command:
 *
 *   node scripts/dispatch/move-ticket.mjs {{file}} {{from}} {{to}}
 *
 * Dispatch runs it with cwd = the repo root and `{{file}}` = the note's
 * VAULT-relative path. The vault is reached through `wiki`, a git-ignored,
 * repo-relative symlink to wherever it actually lives (ADR-0025) — the note
 * is resolved against VAULT_DIR below, which names that link rather than a
 * location. Get that wrong and every run silently reports "note not found".
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
 * Milestones. The ticket's target version (VERSION_PROPERTY) is mirrored onto
 * the issue as a GitHub milestone of the same name, created on first use:
 *
 *   version_target: v0.3.0  ->  milestone "v0.3.0"
 *
 * Three deliberate choices behind that, each of which looked like a coin toss
 * and is not:
 *
 *  - **Per patch version, not per line.** The board groups v0.3.0/v0.3.1/v0.3.2
 *    into one major.minor column (see `versionKey` in src/parse.ts), GitHub does
 *    not normalize titles at all. The frontmatter value is patch-level and is
 *    what the release tag is named, so the raw value is the milestone title.
 *    One board column can therefore span several milestones — by design.
 *  - **No due date.** Milestones support `due_on`; Dispatch's forecast is a
 *    velocity estimate that renders nothing without data. Writing it here would
 *    publish an internal guess as a public commitment, so `due_on` is left unset
 *    for a human to fill in when a date is actually decided.
 *  - **An empty version never REMOVES a milestone.** Clearing `version_target`
 *    skips the milestone step rather than stripping it. A drag is a cheap
 *    gesture and un-assigning is not reversible from the board; the wiki still
 *    wins, but it wins by being edited, not by a drop erasing tracker state.
 *
 * Closing a milestone when a version ships is NOT this script's job — that is a
 * release action, and it belongs to /release, which already knows the full set
 * of tickets in a version.
 *
 * Prints exactly ONE line — Dispatch surfaces it as the Obsidian notice. Both
 * the state change and the milestone change report into that single line.
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
const VAULT_DIR = "wiki";

/**
 * Frontmatter property holding the target version — the board's
 * `milestones.versionProperty`. Keep the two in step: this script reads the
 * note directly and has no access to the board configuration.
 */
const VERSION_PROPERTY = "version_target";

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

	const info = dryRun ? { state: "OPEN", milestone: null } : issueInfo(issue);
	if (info === null) {
		say(`${ticket}: could not read issue #${issue} — tracker not updated`, 1);
		return;
	}

	// Both steps report into one line, and neither aborts the other: a failed
	// milestone must not hide a successful close, and vice versa.
	const done = [];
	let changed = false;
	let failed = false;

	// ---- 1. issue state
	if (action.state === info.state) {
		done.push(`issue #${issue} already ${info.state.toLowerCase()}`);
	} else if (dryRun) {
		done.push(`would run \`gh ${action.argv.join(" ")} ${issue}\``);
		changed = true;
	} else {
		try {
			execFileSync("gh", [...action.argv, String(issue)], { encoding: "utf8", stdio: "pipe" });
			done.push(`issue #${issue} ${action.done}`);
			changed = true;
		} catch (err) {
			done.push(`state update failed — ${detail(err)}`);
			failed = true;
		}
	}

	// ---- 2. milestone
	// No target version is the common case for an unscheduled ticket, so it is
	// silent rather than reported — and it never clears an existing milestone.
	const wanted = (fm[VERSION_PROPERTY] || "").trim();
	if (wanted && info.milestone === wanted) {
		done.push(`milestone ${wanted} already set`);
	} else if (wanted && dryRun) {
		// "ensure", not "set": a dry run makes no calls at all, so it does not
		// know whether the milestone is already right.
		done.push(`would ensure milestone ${wanted}`);
		changed = true;
	} else if (wanted) {
		const result = applyMilestone(issue, wanted);
		done.push(result.message);
		if (result.failed) failed = true;
		else changed = true;
	}

	say(`${ticket}: ${done.join(", ")}${changed || failed ? "" : " — nothing to do"}`, failed ? 1 : 0);
}

/**
 * Put the issue in the milestone named `title`, creating the milestone if this
 * is the first ticket to target that version.
 *
 * Assignment is attempted BEFORE any lookup: in the steady state the milestone
 * already exists and that is a single call. The first attempt's error is kept,
 * because if creation then fails too, the original message ("not found" vs. a
 * real auth or network failure) is the one worth reporting.
 */
function applyMilestone(issue, title) {
	const assign = () =>
		execFileSync("gh", ["issue", "edit", String(issue), "--milestone", title], {
			encoding: "utf8",
			stdio: "pipe",
		});

	try {
		assign();
		return { failed: false, message: `milestone ${title} set` };
	} catch (err) {
		// Most likely cause: no milestone by that name yet. Create and retry.
		const first = detail(err);
		if (!createMilestone(title)) {
			return { failed: true, message: `milestone ${title} not set — ${first}` };
		}
		try {
			assign();
			return { failed: false, message: `milestone ${title} created and set` };
		} catch (retry) {
			return { failed: true, message: `milestone ${title} created but not set — ${detail(retry)}` };
		}
	}
}

/**
 * Create an open milestone with no due date. `--method POST` is explicit: with
 * `gh api`, adding a field silently flips the method, and a mistake there is
 * the difference between reading the milestone list and writing to it.
 */
function createMilestone(title) {
	try {
		execFileSync("gh", ["api", "--method", "POST", "repos/{owner}/{repo}/milestones", "-f", `title=${title}`], {
			encoding: "utf8",
			stdio: "pipe",
		});
		return true;
	} catch {
		return false;
	}
}

/** First line of whatever gh complained about. */
function detail(err) {
	return (err.stderr || err.message || "").split("\n")[0].trim();
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
	// Backlog / Refinement / In progress / Review all mean "still open".
	return { state: "OPEN", done: "reopened", argv: ["issue", "reopen"] };
}

/**
 * `{ state: "OPEN" | "CLOSED", milestone: <title> | null }`, or null when the
 * issue can't be read.
 *
 * One call for both, deliberately: knowing the current milestone is what lets
 * the common "already correct" case cost nothing extra.
 */
function issueInfo(issue) {
	try {
		const out = execFileSync("gh", ["issue", "view", String(issue), "--json", "state,milestone"], {
			encoding: "utf8",
			stdio: "pipe",
		});
		const data = JSON.parse(out);
		const state = String(data.state || "").toUpperCase();
		if (!state) return null;
		return { state, milestone: data.milestone?.title || null };
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

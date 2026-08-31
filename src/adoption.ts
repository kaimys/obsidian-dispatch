/**
 * A vault that keeps its name but moves orphans its device-local settings —
 * `localSettingsPath()` (`main.ts`) keys the file on the vault's absolute
 * path, so the old file is simply left behind under a stale hash. This finds
 * it: a same-named `~/.dispatch/<name>-<hash>.json` under a different hash
 * than the vault's own (missing) file.
 *
 * Zero or multiple matches return null — a safe, narrow trigger for a plugin
 * to offer adoption from, not an exhaustive recovery search. Ambiguity is
 * left for a human to resolve rather than guessed at (US00024).
 */
export function findAdoptionCandidate(
	files: string[],
	currentName: string,
	currentBasename: string
): string | null {
	const escaped = currentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^${escaped}-[0-9a-f]+\\.json$`);
	const matches = files.filter((f) => f !== currentBasename && pattern.test(f));
	return matches.length === 1 ? matches[0] : null;
}

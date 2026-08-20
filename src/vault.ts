/**
 * The typed edge of the Obsidian API.
 *
 * `metadataCache.frontmatter` and the `processFrontMatter` callback are both
 * typed `any`, so every read and write of a note's properties would otherwise
 * spread untyped values through the plugin. These two wrappers are the only
 * place that `any` is allowed to exist.
 */
import type { App, CachedMetadata, TFile } from "obsidian";

/** A note's frontmatter, as unknown values rather than `any`. */
export function frontmatterOf(app: App, file: TFile): Record<string, unknown> {
	return frontmatterIn(app.metadataCache.getFileCache(file));
}

/** Same, for an already-fetched cache entry. */
export function frontmatterIn(cache: CachedMetadata | null): Record<string, unknown> {
	// The API types frontmatter as `any`; the declared return type is what
	// gives every caller unknown values instead.
	return cache?.frontmatter ?? {};
}

/** Edit a note's frontmatter with the values typed. */
export function updateFrontmatter(
	app: App,
	file: TFile,
	edit: (frontmatter: Record<string, unknown>) => void
): Promise<void> {
	return app.fileManager.processFrontMatter(file, edit);
}

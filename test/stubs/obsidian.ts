/**
 * Minimal stand-in for the `obsidian` module.
 *
 * Obsidian ships its API only inside the app, so anything importing it is
 * unloadable in a test process. This stub provides the handful of values our
 * modules import at module scope. It deliberately does NOT emulate behaviour:
 * logic that needs the real API belongs behind the ports in `test/harness.ts`,
 * not in a fake Obsidian.
 */
import { load } from "js-yaml";

export class TFile {
	path = "";
	basename = "";
	extension = "md";
	name = "";
}

export class TFolder {
	path = "";
	children: unknown[] = [];
}

export class Notice {
	constructor(public message: string) {}
	hide(): void {}
}

export class Modal {
	contentEl = {} as HTMLElement;
	open(): void {}
	close(): void {}
}

export class ItemView {
	constructor(public leaf: unknown) {}
}

export class Menu {
	addItem(): this {
		return this;
	}
	showAtMouseEvent(): void {}
}

export type App = unknown;
export type WorkspaceLeaf = unknown;

export function parseYaml(text: string): unknown {
	return load(text);
}

export function setIcon(): void {}

export function debounce<T extends (...args: never[]) => unknown>(fn: T): T {
	return fn;
}

export function requestUrl(): never {
	throw new Error("requestUrl is not available in tests — parse fixtures directly");
}

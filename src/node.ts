/**
 * The typed edge of the Node API.
 *
 * Companion to `vault.ts`, which does the same job for Obsidian's untyped
 * frontmatter (ADR-0015): one module owns a boundary, so the rest of the
 * source never handles a value the type system cannot describe.
 *
 * Why this exists at all. A desktop-only plugin legitimately uses
 * `child_process`, `fs`, `os` and `path`, but their types come from
 * `@types/node`, a devDependency. Any tool that type-checks this source
 * without it — the community-directory review scanner does exactly that,
 * supplying Obsidian's typings but not Node's — sees every one of those
 * imports as unresolved, every value from them as `any`, and reports ~60
 * unsafe-any violations spread across four modules. The code is fine; the
 * report is not, and the report is what people read.
 *
 * So the imports are narrowed here, once, into hand-written interfaces that
 * describe exactly the calls Dispatch makes. Callers get a real type either
 * way, and the untyped surface is this file rather than the whole plugin.
 *
 * The trade: these signatures are asserted, not checked against the real
 * `@types/node` ones, so a wrong signature here is a wrong signature
 * everywhere. Keep them minimal and literal — describe only the overloads
 * actually used, and prefer adding a parameter here over widening a type.
 */
import { exec as nodeExec, spawn as nodeSpawn } from "child_process";
import {
	appendFileSync as nodeAppendFileSync,
	existsSync as nodeExistsSync,
	mkdirSync as nodeMkdirSync,
	readdirSync as nodeReaddirSync,
	readFileSync as nodeReadFileSync,
	unlinkSync as nodeUnlinkSync,
	watch as nodeWatch,
	writeFileSync as nodeWriteFileSync,
} from "fs";
import { homedir as nodeHomedir, tmpdir as nodeTmpdir } from "os";
import { basename as nodeBasename, dirname as nodeDirname, join as nodeJoin } from "path";
import * as nodeProcess from "process";

// ------------------------------------------------------------------ types

/** The handle returned by `spawn`, as far as a detached launch needs it. */
export interface SpawnedProcess {
	on(event: "error", listener: (err: Error) => void): void;
	unref(): void;
}

/** Only the options a chip launch sets. */
export interface SpawnOptions {
	shell: boolean;
	cwd: string;
	detached: boolean;
	stdio: "ignore";
	env?: Record<string, string | undefined>;
}

/** Only the options a hook run sets. */
export interface ExecOptions {
	cwd: string;
	timeout: number;
}

/** The watcher returned by `fs.watch`; Dispatch only ever closes it. */
export interface FileWatcher {
	close(): void;
}

// -------------------------------------------------------------- functions

/** Spawn a detached process. */
export const spawn = nodeSpawn as unknown as (
	command: string,
	options: SpawnOptions
) => SpawnedProcess;

/** Run a command to completion and hand back its output. */
export const exec = nodeExec as unknown as (
	command: string,
	options: ExecOptions,
	callback: (err: Error | null, stdout: string, stderr: string) => void
) => void;

export const existsSync = nodeExistsSync as unknown as (path: string) => boolean;

export const readFileSync = nodeReadFileSync as unknown as (
	path: string,
	encoding: "utf8"
) => string;

export const writeFileSync = nodeWriteFileSync as unknown as (
	path: string,
	data: string,
	encoding?: "utf8"
) => void;

export const appendFileSync = nodeAppendFileSync as unknown as (
	path: string,
	data: string
) => void;

export const mkdirSync = nodeMkdirSync as unknown as (
	path: string,
	options: { recursive: boolean }
) => void;

/** Basenames only, like the real function with no options argument. */
export const readdirSync = nodeReaddirSync as unknown as (path: string) => string[];

export const unlinkSync = nodeUnlinkSync as unknown as (path: string) => void;

/** Watch a single file. The listener takes no arguments Dispatch uses. */
export const watch = nodeWatch as unknown as (
	path: string,
	listener: () => void
) => FileWatcher;

/*
 * The assertions below look redundant HERE and are load-bearing ELSEWHERE.
 * With `@types/node` installed, `join` and friends already have exactly these
 * signatures, so the rule is right that the assertion changes nothing. Without
 * it — the case this whole module exists for — the same expressions are `any`,
 * and the assertion is the only thing giving callers a type. Removing them
 * would quietly restore the ~60 unsafe-any reports in the directory review.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- redundant with @types/node, essential without it; see the note above. */
export const homedir = nodeHomedir as unknown as () => string;
export const tmpdir = nodeTmpdir as unknown as () => string;

export const join = nodeJoin as unknown as (...parts: string[]) => string;
export const dirname = nodeDirname as unknown as (path: string) => string;
export const basename = nodeBasename as unknown as (path: string) => string;
/* eslint-enable @typescript-eslint/no-unnecessary-type-assertion -- back to normal checking below. */

// ---------------------------------------------------------------- process

/**
 * Read through the `process` MODULE rather than the global: the global trips
 * `obsidianmd/no-global-this`, and esbuild marks every Node builtin external,
 * so this import behaves exactly like the ones above. Only the two members
 * Dispatch actually needs are described.
 */
interface NodeProcess {
	platform: string;
	env: Record<string, string | undefined>;
}

const proc = nodeProcess as unknown as NodeProcess | undefined;

/** "win32" | "darwin" | "linux" | … — empty when there is no process object. */
export function platform(): string {
	return proc?.platform ?? "";
}

/** The current environment, or an empty map outside Node. */
export function environment(): Record<string, string | undefined> {
	return proc?.env ?? {};
}

/**
 * The zero-configuration entry point.
 *
 * A board with no source folders is a dead end: the plugin cannot guess which
 * folder holds tickets or which property carries the status, and the honest
 * answer ("configure it in settings") leaves someone who just installed from
 * the community directory staring at a settings tab full of fields whose
 * meaning depends on a vault convention they may not have yet.
 *
 * So the empty board explains what setup involves and offers to hand the whole
 * job to an agent. The launch has to work on a device with NO configuration at
 * all, which shapes everything here: no repo alias (the working directory falls
 * back to the vault folder), the default tool, and a prompt that tells the
 * agent how to install the skill if it is missing.
 */
import { Notice, setIcon } from "obsidian";
import { launchSetup } from "./chips";
import type DispatchPlugin from "./main";
import type { LocalSettings } from "./settings";

/** The Claude Code commands that install the setup skill. */
export const INSTALL_COMMANDS = [
	"/plugin marketplace add kaimys/obsidian-dispatch",
	"/plugin install dispatch-setup",
];

/**
 * The setup prompt, as ONE line — a chip prompt reaches the shell as a single
 * quoted argument, so it can hold no newlines.
 *
 * It names the vault because an agent started in a repo cannot guess where the
 * vault is, and it carries its own install instructions so the button also
 * works for someone who installed Claude Code five minutes ago and has never
 * heard of the skill.
 */
export function setupPrompt(vaultPath: string): string {
	const where = vaultPath ? `My Obsidian vault is at ${vaultPath}.` : "Ask me where my Obsidian vault is.";
	return (
		`Set up the Dispatch Obsidian plugin for this project using the dispatch-setup skill. ${where} ` +
		`If that skill is not available, run ${INSTALL_COMMANDS[0]} and then ${INSTALL_COMMANDS[1]} first, and follow it from there.`
	);
}

export interface SetupLaunchState {
	/** The tool the button would launch. */
	tool: string;
	canLaunch: boolean;
	/** Why it cannot launch, phrased for the panel. Empty when it can. */
	blocked: string;
}

/**
 * Whether the setup button can actually start an agent on this device.
 *
 * Only Windows ships a default launch command, so on macOS and Linux this is
 * routinely blocked until someone fills one in — which is why the panel always
 * offers the copy-the-prompt path as an equal alternative rather than a
 * fallback bolted on for errors.
 */
export function setupLaunchState(
	tools: LocalSettings["tools"],
	defaultTool: string,
	vaultPath: string
): SetupLaunchState {
	const tool = defaultTool || "claude";
	if (!vaultPath) {
		return {
			tool,
			canLaunch: false,
			blocked: "This vault is not a normal folder on disk, so there is nowhere to start an agent.",
		};
	}
	if (!tools[tool]?.command.trim()) {
		return {
			tool,
			canLaunch: false,
			blocked: `No launch command for "${tool}" on this device. Add one under Settings → Dispatch → This device — or copy the prompt and paste it into an agent you already have open.`,
		};
	}
	return { tool, canLaunch: true, blocked: "" };
}

/** The unconfigured board: what setup means, and two ways to get it done. */
export function renderSetupPanel(root: HTMLElement, plugin: DispatchPlugin): void {
	const vaultPath = plugin.getVaultBasePath();
	const prompt = setupPrompt(vaultPath);
	const launch = setupLaunchState(plugin.local.tools, plugin.shared.chips.defaultTool, vaultPath);

	const panel = root.createDiv({ cls: "dispatch-setup" });
	panel.createDiv({ cls: "dispatch-setup-title", text: "Dispatch isn't configured yet" });
	panel.createEl("p", {
		cls: "dispatch-setup-lead",
		text:
			"The board is a view over your notes: it groups them into columns by a frontmatter property, " +
			"and a drag writes that property back. To draw anything it needs to know which folder holds " +
			"your tickets and which status values are your columns.",
	});

	// ---- the agent path
	const card = panel.createDiv({ cls: "dispatch-setup-card" });
	const heading = card.createDiv({ cls: "dispatch-setup-card-title" });
	const icon = heading.createSpan({ cls: "dispatch-setup-icon" });
	setIcon(icon, "sparkles");
	heading.createSpan({ text: "Let an agent set it up" });

	card.createEl("p", {
		text:
			"The dispatch-setup skill reads your vault first and turns setup into a short confirmation " +
			"rather than a questionnaire: it finds the folders that look like tickets, collects the status " +
			"values you already use and proposes them as columns, then writes the shared board config and " +
			"this device's private config, scaffolds ticket templates and the workflow commands your chips " +
			"will call, and verifies the whole result before you open the board again.",
	});
	card.createEl("p", {
		cls: "dispatch-setup-muted",
		text: "It runs in Claude Code. If the skill isn't installed yet, run these there first:",
	});
	card.createEl("pre", { cls: "dispatch-setup-code", text: INSTALL_COMMANDS.join("\n") });

	const actions = card.createDiv({ cls: "dispatch-setup-actions" });
	const run = actions.createEl("button", {
		cls: "mod-cta",
		text: `Set up with ${launch.tool}`,
	});
	if (launch.canLaunch) {
		run.addEventListener("click", () => launchSetup(plugin, prompt));
	} else {
		run.disabled = true;
		run.addClass("dispatch-setup-disabled");
	}

	const copy = actions.createEl("button", { text: "Copy the prompt" });
	copy.addEventListener("click", () => {
		void navigator.clipboard.writeText(prompt).then(
			() => new Notice("Dispatch: setup prompt copied — paste it into your agent."),
			() => new Notice("Dispatch: could not access the clipboard.")
		);
	});

	if (launch.canLaunch) {
		card.createDiv({
			cls: "dispatch-setup-hint",
			text: `Starts in ${vaultPath}. Tell it where your code repository is when it asks.`,
		});
	} else {
		card.createDiv({ cls: "dispatch-setup-hint", text: launch.blocked });
	}

	// ---- the manual path
	const manual = panel.createEl("p", { cls: "dispatch-setup-manual" });
	manual.createSpan({ text: "Rather do it yourself? In " });
	manual.createEl("strong", { text: "Settings → Dispatch" });
	manual.createSpan({
		text:
			", point “Source folders” at the folder holding your tickets and list your status values as " +
			"columns. Every other field has a working default, and the ⚠ panel on this board will tell " +
			"you about notes that don't fit once cards appear.",
	});
}

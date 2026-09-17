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
 * back to the vault folder), whichever agents this device can start, and a
 * prompt that says how to install the skill if it is missing.
 */
import { Notice, setIcon } from "obsidian";
import { launchSetup } from "./chips";
import { toolChoices, toolDisplayName } from "./exec";
import type DispatchPlugin from "./main";
import type { LocalSettings } from "./settings";

/**
 * How each agent installs the setup skill — the README's commands. The panel
 * shows both and the prompt names both: the skill installs into either agent,
 * and nothing here knows which one the user has.
 */
export const INSTALL_ROUTES: { agent: string; commands: string[] }[] = [
	{
		agent: "Claude Code",
		commands: ["/plugin marketplace add kaimys/obsidian-dispatch", "/plugin install dispatch-setup"],
	},
	{
		agent: "Codex",
		commands: [
			"codex plugin marketplace add kaimys/obsidian-dispatch",
			"codex plugin add dispatch-setup@dispatch",
		],
	},
];

/**
 * The setup prompt, as ONE line — a chip prompt reaches the shell as a single
 * quoted argument, so it can hold no newlines.
 *
 * It names the vault because an agent started in a repo cannot guess where the
 * vault is. It is neutral about the agent because **Copy the prompt** cannot
 * know which one receives it: if the skill is missing, it names both install
 * routes and asks for a new session once the skill is in, instead of telling
 * the agent to run one agent's slash commands.
 */
export function setupPrompt(vaultPath: string): string {
	const where = vaultPath ? `My Obsidian vault is at ${vaultPath}.` : "Ask me where my Obsidian vault is.";
	const routes = INSTALL_ROUTES.map(
		(route) => `in ${route.agent} with ${route.commands.join(" and then ")}`
	).join(", ");
	return (
		`Set up the Dispatch Obsidian plugin for this project using the dispatch-setup skill. ${where} ` +
		`If that skill is not available, it has to be installed first — ${routes}. ` +
		`Tell me that, and to start a new session with this prompt once it is installed.`
	);
}

export interface SetupLaunchState {
	/**
	 * The agent the button names, and the one the launch is pinned to. Empty when
	 * several are offered — the confirmation dialog asks which — or none is.
	 */
	tool: string;
	/** The button's text. */
	label: string;
	canLaunch: boolean;
	/** Why it cannot launch, phrased for the panel. Empty when it can. */
	blocked: string;
}

/**
 * Whether the setup button can actually start an agent on this device, and
 * which one it promises.
 *
 * It offers what a chip launch offers — every tool with a launch command, the
 * shared default first (`toolChoices`) — so a device that can only start Codex
 * gets a working button instead of one blocked on a missing `claude`. With
 * several, the confirmation dialog asks which one (ADR-0021). With
 * confirmations off there is no dialog to ask in, so the button names the one
 * agent a click will start rather than promising a choice nobody is shown.
 *
 * Only Windows ships a default launch command, so on macOS and Linux this is
 * routinely blocked until someone fills one in — which is why the panel always
 * offers the copy-the-prompt path as an equal alternative rather than a
 * fallback bolted on for errors.
 */
export function setupLaunchState(
	tools: LocalSettings["tools"],
	defaultTool: string,
	vaultPath: string,
	confirmBeforeRun = true
): SetupLaunchState {
	const choices = toolChoices({ label: "Set up Dispatch", prompt: "" }, tools, defaultTool);
	const offered = confirmBeforeRun ? choices : choices.slice(0, 1);
	const tool = offered.length === 1 ? offered[0] : "";
	const label = tool ? `Set up with ${toolDisplayName(tool)}` : "Set up with an agent";
	if (!vaultPath) {
		return {
			tool,
			label,
			canLaunch: false,
			blocked: "This vault is not a normal folder on disk, so there is nowhere to start an agent.",
		};
	}
	if (offered.length === 0) {
		return {
			tool,
			label,
			canLaunch: false,
			blocked:
				'No agent has a launch command on this device. Add a "claude" or "codex" launch command under ' +
				"Settings → Dispatch → This device — or copy the prompt and paste it into an agent you already have open.",
		};
	}
	return { tool, label, canLaunch: true, blocked: "" };
}

/** The unconfigured board: what setup means, and two ways to get it done. */
export function renderSetupPanel(root: HTMLElement, plugin: DispatchPlugin): void {
	const vaultPath = plugin.getVaultBasePath();
	const prompt = setupPrompt(vaultPath);
	const launch = setupLaunchState(
		plugin.local.tools,
		plugin.shared.chips.defaultTool,
		vaultPath,
		plugin.local.confirmBeforeRun
	);

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
		text: "It runs in Claude Code or Codex. If the skill isn't installed yet, install it there first:",
	});
	for (const route of INSTALL_ROUTES) {
		card.createDiv({ cls: "dispatch-setup-muted dispatch-setup-agent", text: route.agent });
		card.createEl("pre", { cls: "dispatch-setup-code", text: route.commands.join("\n") });
	}

	const actions = card.createDiv({ cls: "dispatch-setup-actions" });
	const run = actions.createEl("button", { cls: "mod-cta", text: launch.label });
	if (launch.canLaunch) {
		run.addEventListener("click", () => launchSetup(plugin, prompt, launch.tool));
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

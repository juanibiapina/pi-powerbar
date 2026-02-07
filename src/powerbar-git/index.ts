/**
 * Powerbar Git Producer
 *
 * Shows the current git branch.
 * Segment ID: "git-branch"
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "fs";
import { join } from "path";

function getGitBranch(cwd: string): string | undefined {
	try {
		const head = readFileSync(join(cwd, ".git", "HEAD"), "utf-8").trim();
		if (head.startsWith("ref: refs/heads/")) {
			return head.slice(16);
		}
		// Detached HEAD — show short hash
		return head.slice(0, 8);
	} catch {
		return undefined;
	}
}

function emitBranch(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const branch = getGitBranch(ctx.cwd);
	if (branch) {
		pi.events.emit("powerbar:update", {
			id: "git-branch",
			text: branch,
			icon: "⎇",
			color: "muted",
		});
	} else {
		pi.events.emit("powerbar:update", {
			id: "git-branch",
			text: undefined,
		});
	}
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "git-branch", label: "Git Branch" });

	pi.on("session_start", async (_event, ctx) => {
		emitBranch(pi, ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		emitBranch(pi, ctx);
	});

	// Refresh after bash commands (user may have changed branches)
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "bash") {
			emitBranch(pi, ctx);
		}
	});
}

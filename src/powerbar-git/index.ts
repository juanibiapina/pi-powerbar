/**
 * Powerbar Git Producer
 *
 * Shows the current git branch.
 * Segment ID: "git-branch"
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findGitDir(cwd: string): string | undefined {
	let directory = resolve(cwd);

	while (true) {
		const dotGit = join(directory, ".git");
		try {
			if (statSync(dotGit).isDirectory()) return dotGit;

			const pointer = readFileSync(dotGit, "utf-8").trim();
			if (pointer.startsWith("gitdir:")) {
				return resolve(directory, pointer.slice("gitdir:".length).trim());
			}
		} catch {
			// Keep looking in parent directories.
		}

		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

function getGitBranch(cwd: string): string | undefined {
	const gitDir = findGitDir(cwd);
	if (!gitDir) return undefined;

	try {
		const head = readFileSync(join(gitDir, "HEAD"), "utf-8").trim();
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
	let gitWatcher: FSWatcher | undefined;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

	pi.events.emit("powerbar:register-segment", { id: "git-branch", label: "Git Branch" });

	function stopWatching(): void {
		gitWatcher?.close();
		gitWatcher = undefined;
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = undefined;
	}

	function startWatching(ctx: ExtensionContext): void {
		stopWatching();
		if (!ctx.hasUI) return;

		const gitDir = findGitDir(ctx.cwd);
		if (!gitDir) return;

		try {
			gitWatcher = watch(gitDir, { persistent: false }, (_event, filename) => {
				if (filename && filename.toString() !== "HEAD") return;
				if (refreshTimer) clearTimeout(refreshTimer);
				refreshTimer = setTimeout(() => emitBranch(pi, ctx), 25);
				refreshTimer.unref();
			});
			gitWatcher.on("error", stopWatching);
		} catch {
			stopWatching();
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		emitBranch(pi, ctx);
		startWatching(ctx);
	});

	// Refresh after bash commands and start watching repositories created during the session.
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "bash") {
			emitBranch(pi, ctx);
			if (!gitWatcher) startWatching(ctx);
		}
	});

	pi.on("session_shutdown", async () => {
		stopWatching();
	});
}

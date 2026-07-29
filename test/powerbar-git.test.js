import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import createExtension from "../src/powerbar-git/index.ts";

function createPi() {
	const listeners = new Map();
	const emitted = [];
	const pi = {
		events: {
			emit(event, payload) {
				emitted.push({ event, payload });
			},
		},
		on(event, handler) {
			const handlers = listeners.get(event) ?? [];
			handlers.push(handler);
			listeners.set(event, handlers);
		},
	};

	async function fire(event, payload, ctx) {
		for (const handler of listeners.get(event) ?? []) {
			await handler(payload, ctx);
		}
	}

	return { pi, emitted, fire };
}

function branchUpdate(emitted) {
	return emitted.findLast(
		(entry) => entry.event === "powerbar:update" && entry.payload?.id === "git-branch",
	)?.payload;
}

test("finds the branch when pi starts in a repository subdirectory", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-powerbar-git-"));
	try {
		mkdirSync(join(root, ".git"));
		writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/feature/nested\n");
		const nested = join(root, "packages", "app");
		mkdirSync(nested, { recursive: true });

		const { pi, emitted, fire } = createPi();
		createExtension(pi);
		emitted.length = 0;
		await fire("session_start", {}, { cwd: nested });

		assert.deepEqual(branchUpdate(emitted), {
			id: "git-branch",
			text: "feature/nested",
			icon: "⎇",
			color: "muted",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("resolves a worktree-style .git file", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-powerbar-worktree-"));
	try {
		const worktree = join(root, "worktree");
		const gitDir = join(root, "git-data", "worktrees", "example");
		mkdirSync(worktree, { recursive: true });
		mkdirSync(gitDir, { recursive: true });
		writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
		writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/worktree-branch\n");

		const { pi, emitted, fire } = createPi();
		createExtension(pi);
		emitted.length = 0;
		await fire("session_start", {}, { cwd: worktree });

		assert.equal(branchUpdate(emitted)?.text, "worktree-branch");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

import assert from "node:assert/strict";
import test from "node:test";
import createExtension from "../dist/powerbar-sub/index.js";

function createPi() {
	const listeners = new Map();
	const emitted = [];
	const pi = {
		events: {
			on(event, handler) {
				const handlers = listeners.get(event) ?? [];
				handlers.push(handler);
				listeners.set(event, handlers);
			},
			emit(event, payload) {
				emitted.push({ event, payload });
				for (const handler of listeners.get(event) ?? []) {
					handler(payload);
				}
			},
		},
	};
	return { pi, emitted };
}

function usage(provider, hourly = 1, weekly = 9) {
	return {
		provider,
		displayName: `${provider} plan`,
		windows: [
			{ label: "5h", usedPercent: hourly, resetDescription: "1h" },
			{ label: "Week", usedPercent: weekly, resetDescription: "2d" },
		],
	};
}

function powerbarSubUpdates(emitted) {
	return emitted.filter(
		(entry) =>
			entry.event === "powerbar:update" && ["sub-hourly", "sub-weekly"].includes(entry.payload?.id),
	);
}

function hasDelete(update) {
	return update.payload?.text === undefined && update.payload?.bar === undefined;
}

test("emits segments for the current provider on update-current", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("sub-core:update-current", { state: { provider: "anthropic", usage: usage("anthropic", 7, 14) } });

	assert.deepEqual(
		powerbarSubUpdates(emitted).map((u) => [u.payload.id, u.payload.text, u.payload.suffix, u.payload.bar]),
		[
			["sub-hourly", "5h 1h", "7%", 7],
			["sub-weekly", "Week 2d", "14%", 14],
		],
	);
});

test("ignores sub-core:update-all entirely (TTL filter would lie about the current provider)", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("sub-core:update-current", { state: { provider: "anthropic", usage: usage("anthropic", 5, 12) } });
	emitted.length = 0;

	pi.events.emit("sub-core:update-all", {
		state: { provider: "anthropic", entries: [{ provider: "codex", usage: usage("codex", 99, 99) }] },
	});
	pi.events.emit("sub-core:update-all", { state: { provider: "anthropic", entries: [] } });
	pi.events.emit("sub-core:update-all", {
		state: { provider: "anthropic", entries: [{ provider: "anthropic", usage: usage("anthropic", 50, 60) }] },
	});

	assert.deepEqual(powerbarSubUpdates(emitted), []);
});

test("clears segments when update-current carries no usage", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("sub-core:update-current", { state: { provider: "anthropic", usage: usage("anthropic", 5, 12) } });
	emitted.length = 0;

	pi.events.emit("sub-core:update-current", { state: { provider: "anthropic" } });

	const updates = powerbarSubUpdates(emitted);
	assert.equal(updates.length, 2);
	assert.equal(updates.every(hasDelete), true);
});

test("clears segments when update-current usage has no windows", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("sub-core:update-current", { state: { provider: "anthropic", usage: usage("anthropic", 5, 12) } });
	emitted.length = 0;

	pi.events.emit("sub-core:update-current", {
		state: { provider: "anthropic", usage: { provider: "anthropic", windows: [] } },
	});

	const updates = powerbarSubUpdates(emitted);
	assert.equal(updates.length, 2);
	assert.equal(updates.every(hasDelete), true);
});

test("sub-core:ready with empty state clears segments; later update-current re-fills", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("sub-core:ready", { state: {} });
	const readyUpdates = powerbarSubUpdates(emitted);
	assert.equal(readyUpdates.length, 2);
	assert.equal(readyUpdates.every(hasDelete), true);
	emitted.length = 0;

	pi.events.emit("sub-core:update-current", { state: { provider: "anthropic", usage: usage("anthropic", 7, 14) } });
	assert.deepEqual(
		powerbarSubUpdates(emitted).map((u) => [u.payload.id, u.payload.text, u.payload.suffix]),
		[
			["sub-hourly", "5h 1h", "7%"],
			["sub-weekly", "Week 2d", "14%"],
		],
	);
});

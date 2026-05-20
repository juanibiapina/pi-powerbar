import assert from "node:assert/strict";
import test from "node:test";
import createExtension from "../src/powerbar-sub/index.ts";

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

function usage(hourly = 1, weekly = 9) {
	return {
		provider: "anthropic",
		displayName: "Claude Plan",
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

test("emits segments when provider detected and usage present", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("usage-core:update-current", { state: { provider: "anthropic", usage: usage(7, 14) } });

	assert.deepEqual(
		powerbarSubUpdates(emitted).map((u) => [u.payload.id, u.payload.text, u.payload.suffix, u.payload.bar]),
		[
			["sub-hourly", "5h 1h", "7%", 7],
			["sub-weekly", "Week 2d", "14%", 14],
		],
	);
});

test("clears segments when no provider (e.g. Bedrock model)", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	// First show some usage.
	pi.events.emit("usage-core:update-current", { state: { provider: "anthropic", usage: usage(5, 12) } });
	emitted.length = 0;

	// Switch to non-detected model.
	pi.events.emit("usage-core:update-current", { state: {} });

	const updates = powerbarSubUpdates(emitted);
	assert.equal(updates.length, 2);
	assert.equal(updates.every(hasDelete), true);
});

test("clears segments when provider detected but no usage", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("usage-core:update-current", { state: { provider: "anthropic" } });

	const updates = powerbarSubUpdates(emitted);
	assert.equal(updates.length, 2);
	assert.equal(updates.every(hasDelete), true);
});

test("clears segments when usage has empty windows", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("usage-core:update-current", {
		state: { provider: "anthropic", usage: { provider: "anthropic", displayName: "Claude Plan", windows: [] } },
	});

	const updates = powerbarSubUpdates(emitted);
	assert.equal(updates.length, 2);
	assert.equal(updates.every(hasDelete), true);
});

test("ready with empty state clears segments; later update re-fills", () => {
	const { pi, emitted } = createPi();
	createExtension(pi);
	emitted.length = 0;

	pi.events.emit("usage-core:ready", { state: {} });
	const readyUpdates = powerbarSubUpdates(emitted);
	assert.equal(readyUpdates.length, 2);
	assert.equal(readyUpdates.every(hasDelete), true);
	emitted.length = 0;

	pi.events.emit("usage-core:update-current", { state: { provider: "anthropic", usage: usage(7, 14) } });
	assert.deepEqual(
		powerbarSubUpdates(emitted).map((u) => [u.payload.id, u.payload.text, u.payload.suffix]),
		[
			["sub-hourly", "5h 1h", "7%"],
			["sub-weekly", "Week 2d", "14%"],
		],
	);
});

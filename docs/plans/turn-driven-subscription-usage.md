# Turn-Driven Subscription Usage Plan

## Decision

Remove recurring subscription refresh timers. `pi-usage` resolves usage on `session_start`, `model_select`, and `turn_end`. Powerbar continues to consume `usage-core:*` events.

Put freshness, cross-process exclusion, retries, and stale fallback behind one deep coordinator interface in `pi-usage`. Every Pi process owned by the same OS account on one machine shares the coordinator state, regardless of `PI_CODING_AGENT_DIR`, project, or package installation. Those processes observe these guarantees per provider:

1. A result inside the provider freshness window returns immediately as fresh cache.
2. A stale result starts one endpoint request when refresh is allowed.
3. Concurrent callers wait and return the winner's new result.
4. `Retry-After` and fallback backoff prevent every process from calling early.
5. Last-good data returns as explicitly stale only when refresh cannot complete.
6. No last-good data returns as unavailable.

A lock alone is insufficient because it prevents concurrent requests but permits sequential request bursts. The coordinator must enforce freshness both before and after lease acquisition.

This plan replaces the fixed `powerbar:tick` proposal. Idle sessions do not fetch or repaint. Coordination covers every Pi process owned by the same OS account on one machine, including processes with different agent directories. Cross-user and cross-machine coordination are out of scope because subscription credentials and cached usage are user-specific.

## Goal

Reimplement the subscription path inherited from `pi-sub` so dozens of local Pi processes can request current usage after turns without endpoint request bursts or stale-first responses.

When refresh is eligible, the caller waits for coordinated fresh data. Stale cache is used only during backoff, fetch failure, or bounded coordination failure.

## Current state

### `pi-usage`

- Resolves usage on `session_start`, `model_select`, and `turn_end`.
- Also runs a 60-second `setInterval` in every process.
- Uses a 60-second cache freshness window.
- Stores cache and backoff separately per provider.
- Uses one global `cache.lock`, so unrelated providers block each other.
- Treats a lock as stale after 5 seconds, while provider work can take 10 seconds.
- Waits 3 seconds for another owner before returning no result.
- Starts a 5-second polling interval even when `fs.watch` succeeds.
- Keeps endpoint errors inside `UsageSnapshot`, which weakens the distinction between data and failure.
- Emits no freshness metadata when it retains an old in-memory result.
- Documents `PI_USAGE_REFRESH_MINUTES`, but does not implement it.

### `pi-powerbar`

- Loads `pi-usage` as a sibling extension.
- `powerbar-sub` renders `usage-core:ready` and `usage-core:update-current` events.
- Other segments already use precise agent or filesystem events and require no change.
- `powerbar-sub` displays fetch-time `resetDescription` instead of recalculating from `resetAt`.

### Verified baseline

- `pi-usage`: 38 tests pass after `npm ci`.
- `pi-powerbar`: 26 tests pass.
- Both check commands require an environment that can execute the generic Biome binary on NixOS.

## Architecture

```text
session_start | model_select | turn_end
                    │
                    ▼
         pi-usage extension adapter
         - detect provider
         - request current usage
         - emit resolved state
                    │
                    ▼
            usage coordinator
         - freshness policy
         - per-provider lease
         - shared retry deadline
         - last-good persistence
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
 shared provider files   provider adapter
 across Pi processes          │
                              ▼
                    subscription endpoint

UsageResolution
      │
      ▼
usage-core:update-current
      │
      ▼
powerbar-sub ──▶ powerbar:update ──▶ powerbar core
```

### Module responsibilities

| Module | Responsibility |
|---|---|
| `pi-usage` extension adapter | React to Pi lifecycle events, detect the provider, call the coordinator, and emit resolved state. |
| Usage coordinator | Decide freshness, coordinate one local-process endpoint call per provider, enforce retry deadlines, persist last-good data, and return explicit outcomes. |
| Provider adapter | Authenticate, call one provider endpoint or CLI, parse the response, enforce a bounded duration, and report success or failure. |
| Filesystem implementation | Resolve one per-user machine-local state directory independent of Pi configuration, then persist provider state and leases atomically. |
| `powerbar-sub` | Convert usage results into segments and format relative reset text at each lifecycle update. |
| Powerbar core | Store and render segment updates; it owns no subscription timer or fetch policy. |

The coordinator is the deep module. Replace the current caller-visible sequence of `getGoodUsage`, `fetchWithCache`, and `watchCache` with one operation:

```typescript
interface UsageCoordinator {
  resolve(
    provider: ProviderName,
    policy: ProviderRefreshPolicy,
    fetcher: () => Promise<ProviderFetchResult>,
  ): Promise<UsageResolution>;
}
```

Filesystem and lease helpers remain internal. Tests use temporary directories. Provider adapters form a real seam because multiple production adapters and test adapters satisfy one fetch interface.

## Data contracts

### Provider policy

```typescript
interface ProviderRefreshPolicy {
  freshForMs: number;
  defaultBackoffMs: number;
  maxFetchMs: number;
}
```

- `freshForMs` is the minimum interval between successful calls for one provider and same-user machine-wide state.
- `defaultBackoffMs` applies when failure has no valid `Retry-After`.
- `maxFetchMs` bounds endpoint work and determines lease duration.

Preserve the current 60-second freshness window initially. Store policy per provider so known-sensitive endpoints can use longer windows. Lifecycle events and model changes must not bypass freshness or backoff.

### Provider result

```typescript
type ProviderFetchResult =
  | { ok: true; usage: UsageSnapshot }
  | { ok: false; error: UsageError; retryAfterMs?: number };
```

A failed fetch is not usage. Only successful snapshots replace last-good data.

### Resolution result

```typescript
type UsageResolution =
  | {
      availability: "available";
      freshness: "fresh" | "stale";
      source: "cache" | "endpoint";
      usage: UsageSnapshot;
      fetchedAt: number;
      observedAt: number;
      staleReason?: "backoff" | "fetch-failed" | "lease-timeout";
      retryAt?: number;
      error?: UsageError;
    }
  | {
      availability: "unavailable";
      observedAt: number;
      reason: "no-cache" | "no-credentials" | "backoff" | "fetch-failed" | "lease-timeout";
      retryAt?: number;
      error?: UsageError;
    };
```

Cached does not mean stale. Cache inside `freshForMs` is fresh. Stale means refresh was due but could not produce new data.

## Shared filesystem state

Resolve one state root from the OS user cache location, never from `getAgentDir()`:

- Linux: `${XDG_CACHE_HOME:-$HOME/.cache}/pi-usage`
- macOS: `$HOME/Library/Caches/pi-usage`
- Windows: `%LOCALAPPDATA%\\pi-usage`

All same-user Pi processes on the machine resolve the same root even when they use different `PI_CODING_AGENT_DIR` values. Create the directory with user-only permissions and files with user-only read/write permissions.

Use one versioned state file and one lease file per provider under that root:

```text
provider-anthropic.json
provider-anthropic.lock
provider-codex.json
provider-codex.lock
```

Provider state contains:

- last successful snapshot and `fetchedAt`;
- optional absolute `retryAt`;
- the failure that created the retry deadline;
- a schema version.

A lease contains:

- random owner token;
- process ID for diagnosis;
- `acquiredAt`;
- absolute `expiresAt`;
- a schema version.

Acquire through exclusive file creation. Write state through a process-unique temporary file followed by atomic rename. Release only when the stored token matches the owner.

Lease duration must exceed enforced provider duration plus margin, with a minimum of 30 seconds. An operation bounded at 10 seconds must never lose its lease after 5 seconds.

During migration only, each process may offer legacy state from its current agent directory. Merge under the provider lease: retain the successful snapshot with the newest `fetchedAt` and the future retry deadline with the latest `retryAt`. Never replace newer machine-wide state with older legacy state. Mark or remove a legacy file only after the machine-wide write succeeds. Runtime resolution must stop consulting agent-directory state after migration.

## Resolution flow

For each request:

1. Read provider state.
2. Return last-good data as fresh cache when it is inside `freshForMs`.
3. During active `retryAt`, return last-good data as stale backoff or unavailable when no last-good data exists.
4. Attempt the provider lease.
5. After acquisition, re-read state and repeat freshness and retry checks.
6. If still eligible, call the provider adapter and await its bounded result.
7. On success, atomically replace last-good data, clear retry state, release the lease, and return fresh endpoint data.
8. On failure, preserve last-good data, persist absolute `retryAt`, release the lease, and return stale or unavailable with failure metadata.
9. A non-owner waits for state change or lease release until the owner's bounded deadline.
10. After owner completion, it returns the winner's fresh data or shared failure outcome.
11. An abandoned expired lease may be acquired once more.
12. A bounded coordination timeout returns stale or unavailable; it never grants permission to fetch without a lease.

The hard invariant is: no endpoint call without the provider lease.

## Lifecycle and event behavior

### `session_start`

Detect the selected provider, resolve through the coordinator, and emit `usage-core:ready` with the result.

### `model_select`

Resolve the newly selected provider through normal freshness and retry policy. Remove force behavior that bypasses shared protection.

### `turn_end`

Resolve the current provider. If refresh is eligible, wait for the lease owner and emit the newest result rather than stale data first.

### Removed behavior

- Remove the recurring 60-second refresh interval.
- Remove `turn_start` context retention used only by that interval.
- Remove persistent cache watching and unconditional 5-second polling.
- Remove obsolete `session_switch` casts if the installed Pi interface no longer emits that event.
- Keep bounded endpoint and lease-wait timeouts; they are request-scoped, not recurring timers.

Extend `UsageCoreState` additively with resolution metadata. Emit a resolution after every lifecycle request, even when the snapshot is unchanged. `observedAt` lets `powerbar-sub` recalculate relative reset text after each turn.

`powerbar-sub` must:

1. Accept `resetAt` from rate windows.
2. Format relative text from `resetAt` and `observedAt`.
3. Fall back to `resetDescription` for compatibility.
4. Keep last-good segments visible for stale outcomes.
5. Clear segments for unavailable outcomes.
6. Add no timer and make no direct endpoint call.

A stale visual marker is deferred. Freshness metadata remains available for that future choice.

## Out of scope

- Idle subscription refresh or countdown repaint.
- Any timer in powerbar.
- Changes to token, context, model, provider, or Git triggers.
- Cross-machine coordination.
- A daemon process.
- Historical usage storage.
- Manual force that bypasses freshness or retry protection.
- A stale-data visual redesign.

## Alternatives rejected

### Fixed shared timer

It wakes every process while idle and combines presentation timing with endpoint eligibility.

### Return stale immediately and refresh in the background

It violates the selected behavior for eligible requests. Concurrent callers should wait for the coordinated fresh result.

### Lock without freshness

It serializes callers but permits one endpoint call after another. Freshness supplies the request-rate limit.

### Global lock

Unrelated providers do not protect the same endpoint and must refresh independently.

### Fetch after lock timeout

Timeout does not grant ownership. The caller must return stale or unavailable unless it safely acquires an expired lease.

### Persistent cache watcher

Turn-driven callers read shared state when active. Idle display staleness is accepted.

### Merge `pi-usage` into powerbar core

Provider credentials, fetching, persistence, and retries form an independent deep module. Powerbar consumes its event interface.

## Repository changes

### `juanibiapina/pi-usage`

- Replace or supersede `src/cache.ts` with the coordinator implementation.
- Add one platform-aware state-root resolver that never reads `getAgentDir()` and accepts an injected directory only for tests.
- Add policy, fetch-result, resolution, and event types in `src/types.ts`.
- Update `src/provider.ts` and provider adapters to return discriminated results.
- Store provider policy in `src/registry.ts` or provider metadata.
- Simplify `index.ts` to lifecycle-triggered resolution and event emission.
- Replace shallow cache tests with coordinator-interface tests.
- Add real child-process concurrency fixtures.
- Make `README.md` authoritative for freshness, lease, retry, and result behavior.
- Correct the unsupported `PI_USAGE_REFRESH_MINUTES` claim.

### `juanibiapina/pi-powerbar`

- Update `powerbar-sub` to consume resolution metadata and `resetAt`.
- Expand subscription adapter tests.
- Require the new `pi-usage` version in `package.json` and lockfile.
- Keep README details limited to powerbar integration and link to `pi-usage` for coordination behavior.
- Update stale architecture text in `PROMPT.md`.

## Implementation phases

### 1. Coordinator behavior is executable

Write failing tests for fresh cache, stale eligible cache, backoff, success, failure, unavailable state, lease expiry, and provider independence. Add two-coordinator and real child-process contention tests.

**Outcome:** Current defects fail through the intended coordinator interface.

### 2. One deep coordinator owns local coordination

Implement versioned provider state, per-provider leases, atomic writes, repeated checks under lease, bounded waiting, abandoned-lease recovery, and explicit outcomes. Remove caller access to shallow cache and lock operations.

**Outcome:** Callers cannot bypass endpoint protection accidentally.

### 3. Provider adapters report bounded outcomes

Convert providers to discriminated success and failure results, preserve valid `Retry-After`, enforce `maxFetchMs`, and associate refresh policy with each provider.

**Outcome:** Every provider satisfies one fetch interface.

### 4. `pi-usage` becomes turn-driven

Resolve on `session_start`, `model_select`, and `turn_end`; remove recurring refresh, persistent watch, and force paths; migrate existing cache/backoff state; emit explicit metadata after each resolution.

**Outcome:** Idle processes make no subscription calls, while active processes share one protected result.

### 5. Powerbar consumes resolved state

Release `pi-usage`, update the powerbar dependency, format `resetAt` after each lifecycle result, preserve stale data, clear unavailable data, and leave all other producers unchanged.

**Outcome:** Subscription segments update after turns without a powerbar timer.

### 6. Documentation and rollout are complete

Update both READMEs and changelogs, remove obsolete architecture claims, document same-machine scope, and define restart requirements for mixed old/new processes.

**Outcome:** One source documents each interface and operating rule.

## Test strategy

### Coordinator tests

Use temporary directories and an injected clock. Prove:

- fresh cache skips the fetcher;
- stale eligible cache returns endpoint data;
- stale backoff returns explicit stale data;
- missing cache during backoff returns unavailable;
- failure preserves last-good data and writes retry state;
- success replaces last-good data and clears retry state;
- concurrent same-provider callers fetch once and all receive fresh data;
- sequential callers inside `freshForMs` fetch once;
- different providers do not share leases;
- active work retains its lease for its full bounded duration;
- abandoned leases recover safely;
- old owners cannot release successor leases;
- malformed files do not bypass ownership;
- legacy state migrates without data loss.

### Extension tests

Prove lifecycle resolution, no idle calls, no recurring timer, no freshness bypass on model selection, and explicit metadata after each request.

### Cross-process tests

Use at least 20 child processes with different temporary `PI_CODING_AGENT_DIR` values, one injected machine-state directory, and a counting local HTTP endpoint. Prove one same-provider request, shared successful output, shared `Retry-After`, zero calls during retry, provider independence, and crash recovery after lease expiry.

### Powerbar tests

Prove fresh and stale display, unavailable clearing, `resetAt` formatting from `observedAt`, unchanged-update suppression, and absence of timer or tick behavior.

## Release strategy

1. Release the new `@juanibiapina/pi-usage` implementation first.
2. Use a pre-release when mixed-version lock safety is unresolved.
3. Require the new version from powerbar rather than a range that admits the timer implementation.
4. Release powerbar after cross-process and local Pi verification.
5. Require all local Pi processes to restart after upgrade unless mixed-version behavior is implemented and tested.

## Skills to use

- `tdd` — drive coordinator and lifecycle changes through red-green-refactor.
- `testing` — design deterministic filesystem, concurrency, child-process, and endpoint-count tests.
- `deep-modules` — replace shallow cache operations with one coordinator interface.
- `vocabulary` — keep module, interface, seam, adapter, depth, and locality terminology consistent.
- `documentation` — maintain one source of truth across both repositories.
- `changelog` — load before editing either changelog.
- `reproducible-locally` — prove endpoint limits with child processes and local Pi sessions.
- `git-commit` — commit each repository after checks pass.
- `open-pr` — open coordinated pull requests and link issue #36.

## Acceptance criteria

- No recurring subscription refresh or cache-poll timer remains.
- Resolution runs on `session_start`, `model_select`, and `turn_end`.
- Idle Pi processes make zero subscription endpoint calls.
- Production state is outside every Pi agent directory and resolves identically for same-user processes on one machine.
- Child processes with different `PI_CODING_AGENT_DIR` values share freshness, retry, and lease state.
- Each provider has an independent lease.
- Fresh cache returns without an endpoint call.
- Stale eligible requests wait for and return the coordinated fresh result.
- Concurrent same-provider requests invoke the endpoint exactly once.
- No caller fetches without lease ownership.
- Success updates last-good state and clears retry state.
- `Retry-After` creates one shared absolute provider deadline.
- No call occurs before that deadline.
- Failures without `Retry-After` use provider fallback backoff.
- Stale and unavailable results are explicit.
- Active operations cannot lose leases before their enforced timeout.
- A 20-process same-provider test produces one endpoint call and one shared result.
- Powerbar subscription segments update after turns and format `resetAt` at `observedAt`.
- Other powerbar producers retain their current triggers.
- Both repositories' tests and checks pass.
- The old fixed-clock plan is removed.
- The published HTML page is regenerated from this plan.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sequential request burst after lock release | Check `freshForMs` before and after lease acquisition. |
| Active request loses lease | Derive expiry from enforced `maxFetchMs` plus margin. |
| Owner crashes | Recover token-safe after absolute lease expiry. |
| Waiter returns stale too early | Wait for owner state through its bounded deadline. |
| One provider blocks another | Use provider-specific state and lease files. |
| `429` triggers a process storm | Persist shared `retryAt` before releasing the lease. |
| Failure replaces good data | Persist only successful snapshots as last-good. |
| Turn-end resolution adds latency | Enforce provider and coordination deadlines. |
| Idle display remains stale | Accept it and refresh on the next lifecycle event. |
| Old and new lock schemes overlap | Implement a migration bridge or require process restart. |
| Credentials run on several machines | Document local scope and design network coordination separately. |

## Dependencies

- Pi lifecycle events and shared in-process event bus.
- One OS user cache directory shared by all local Pi processes and independent of `getAgentDir()`.
- Atomic exclusive file creation and rename.
- Provider adapters with enforced maximum durations.
- Correct `Retry-After` parsing for seconds and HTTP-date forms.
- Existing `resetAt` values in usage windows.
- Existing powerbar segment equality suppression.

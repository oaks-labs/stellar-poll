# StellarPoll Contract Compatibility & Migration Guide

This guide details the schema transition between **StellarPoll v1** (the initial yellow-belt learning challenge prototype) and **StellarPoll v2** (the current production-grade release), along with backward-compatibility guarantees and migration procedures.

---

## 1. Schema Changes (v1 vs v2)

### 1.1 `Poll` Data Structure

| Field | v1 Schema | v2 Schema | Rationale |
|---|---|---|---|
| `id` | `u32` | `u32` | Unchanged |
| `question` | `String` (unbounded) | `String` (3–280 bytes) | Prevents storage exhaustion attacks |
| `options` | `Vec<String>` (2–10) | `Vec<String>` (2–10, each 1–100 bytes) | Enforces bounded option sizes |
| `votes` | `Vec<u32>` | `Vec<u32>` | Unchanged |
| `creator` | `Address` | `Address` | Unchanged |
| `total_votes` | `u32` | `u32` | Unchanged |
| `active` | `bool` | `bool` | Unchanged |
| `start_time` | *None* | `u64` | Scheduled voting window support |
| `end_time` | *None* | `u64` | Automated expiry support |
| `allowlist` | *None* | `Vec<Address>` (max 50) | Optional restricted voter memberships |

---

## 2. Compatibility Matrix

| Feature | Legacy v1 Contract | Upgraded v2 Contract | SDK Compatibility Behavior |
|---|---|---|---|
| `create_poll` | Supported | Supported | Forward-compatible: `create_poll` in v2 defaults timestamps to `0` and allowlist to empty. |
| `create_poll_advanced` | *Unsupported* | Supported | Used for scheduled or allowlisted community polls. |
| `get_poll` | Returns v1 struct | Returns v2 struct | The TypeScript SDK safely normalizes missing `start_time`, `end_time`, and `allowlist` fields with sensible defaults (`0`, `0`, `[]`). |
| `get_poll_page` | *Unsupported* | Supported | If `get_poll_page` fails on a legacy contract, the SDK falls back to a reverse sequential fetch automatically. |
| Storage TTL | *Not renewed* | `extend_ttl` invoked | Legacy contracts will eventually expire unless updated. |

---

## 3. Migration & Reset Plan

Because Soroban smart contracts store serialized XDR types in persistent ledger keys, existing data stored under an old `Poll` struct cannot be deserialized into a new Rust struct with required additional fields without a migration hook or a clean contract redeployment.

### Scenario A: Starting with a Fresh Deployment (Recommended)
1. Deploy the new contract WASM via the frontend UI by clicking **Deploy New Poll Contract**.
2. The UI automatically uploads the new bytecode, computes the contract ID, confirms creation on-chain, and stores the new ID in `localStorage`.
3. Share the newly generated contract address with your community or set `VITE_STELLAR_CONTRACT_ID` in your environment.

### Scenario B: Preserving an Existing Deployed v1 Contract
If your community currently relies on an already-deployed v1 contract:
1. **Do not click "Deploy New Poll Contract"**.
2. Click **Switch Contract Instance** in the Contract Setup panel and enter your existing `C...` address.
3. The TypeScript SDK detects legacy schema shapes and falls back to safe defaults, allowing you to view and conclude ongoing polls.
4. Once ongoing polls conclude, migrate the community to a v2 deployment for future polls to benefit from bounded inputs, automatic TTL extensions, and pagination.

### Scenario C: Clearing Stale Local State
If a user's browser has an obsolete or deleted testnet contract stored in `localStorage`:
1. Click the **Reset** button in the Contract Setup card.
2. This clears `stellar_live_poll_contract_id` and `stellar_poll_pending_tx`.
3. Deploy a new instance or input an active contract address.

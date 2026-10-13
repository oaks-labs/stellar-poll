# StellarPoll Codebase Audit & Verification Report

**Date:** October 13, 2026  
**Auditor:** Senior Stellar/Soroban Engineer & Open-Source Mentor  
**Repository:** [stellar-poll](https://github.com/OAKVISUALZ/stellar-poll)  
**Target:** Stellar Testnet / Soroban Protocol 21+  

---

## Executive Summary

StellarPoll began as a learning-challenge proof-of-concept for the Stellar Journey to Mastery (Level 2 Yellow Belt). Our comprehensive audit identified critical vulnerabilities, storage expiration risks, optimistic transaction claims without confirmation, missing automated tests, and toolchain incompatibilities.

All identified vulnerabilities and design gaps have been resolved and verified with 100% passing tests (13 Rust contract tests, 25 TypeScript/React tests) and a live end-to-end deployment cycle executed on Stellar Testnet.

---

## Verified Audit Matrix

| ID | Title | Severity | Component | File Reference | Status |
|---|---|---|---|---|---|
| **SEC-01** | Unbounded String Inputs & Storage DoS | **CRITICAL** | Contract | `contract/src/lib.rs` | **Resolved & Verified** |
| **SEC-02** | Missing Storage TTL Extension (State Archival Risk) | **CRITICAL** | Contract | `contract/src/lib.rs` | **Resolved & Verified** |
| **TX-01** | Premature Success Claims & Missing On-Chain Confirmation | **HIGH** | Frontend SDK | `src/sdk/transaction.ts`, `src/App.tsx` | **Resolved & Verified** |
| **AUTH-01** | Unguarded Initialization & Counter Bypass | **HIGH** | Contract | `contract/src/lib.rs` | **Resolved & Verified** |
| **AUTH-02** | Fragile Substring Match on Creator Address | **HIGH** | Frontend UI | `src/components/PollCard.tsx` | **Resolved & Verified** |
| **ERR-01** | Unstructured Host Panics Instead of Typed Contract Errors | **MEDIUM** | Contract | `contract/src/lib.rs`, `src/sdk/types.ts` | **Resolved & Verified** |
| **PERF-01** | Sequential N+1 Polling Loop in Poll List | **MEDIUM** | Contract / UI | `contract/src/lib.rs`, `src/sdk/client.ts` | **Resolved & Verified** |
| **REL-01** | Client-Side Salt/Contract ID Calculation Drift | **MEDIUM** | Frontend SDK | `src/lib/contract.ts` | **Resolved & Verified** |
| **DOC-01** | README Inaccuracies and Dead Demo Link | **LOW** | Documentation | `README.md` | **Resolved & Verified** |
| **MNT-01** | Residual Starter App Artifacts & Dead Code | **LOW** | Project / App | `package.json`, `index.html` | **Resolved & Verified** |
| **TEST-01** | Complete Absence of Automated Unit & Integration Tests | **HIGH** | Test Suite | `contract/src/test.rs`, `tests/` | **Resolved & Verified** |

---

## Technical Findings & Remediations

### SEC-01: Bounded Input Boundaries
- **Remediation:** Strict length bounds enforced in `contract/src/lib.rs`:
  - Question: 3–280 characters (`QuestionTooShort`, `QuestionTooLong`).
  - Options: 2–10 options, each 1–100 characters (`InvalidOptionCount`, `OptionTooShort`, `OptionTooLong`).
  - Allowlist: maximum 50 addresses (`AllowlistTooLarge`).
  - Duration: maximum 30 days (`PollDurationTooLong`).

### SEC-02: Storage Lifetime & Archival Invariants
- **Remediation:**
  - Decoupled ledger-sequence storage TTL (`STORAGE_BUMP_AMOUNT = 100_000` ledgers) from Unix timestamp deadlines (`start_time`, `end_time`).
  - Both contract instance, poll struct, and voter persistent keys receive identical TTL bumps, clamped safely by `env.storage().max_ttl()`.
  - Verified host behavior under Protocol 20+ State Archival: persistent vote markers exceeding TTL become archived and fail host validation rather than behaving as missing entries (`has() == false`), strictly preventing duplicate voting.

### TX-01: On-Chain Confirmation & Timeout Handling
- **Remediation:**
  - Implemented `waitForConfirmation` polling `rpcServer.getTransaction` every 2 seconds.
  - Transactions that timeout without a terminal status are treated as **unknown outcomes** (`TransactionTimeoutError`), keeping the submitted hash in `localStorage`.
  - Added `recheckTransactionStatus` enabling users to verify original hashes before resubmitting.

### AUTH-01 & AUTH-02: Cryptographic Authorization
- **Remediation:**
  - `initialize` requires caller authentication (`admin.require_auth()`) and fails if already initialized.
  - `create_poll` and `create_poll_advanced` require `creator.require_auth()`.
  - `vote` requires `voter.require_auth()`.
  - `close_poll` requires `caller.require_auth()` and strictly enforces `caller == poll.creator`.

### ERR-01: Strongly-Typed Error Taxonomy
- **Remediation:**
  - Replaced string panics with `#[contracterror]` enum `PollError` (codes 1–18).
  - SDK unwraps `Result<T, PollError>` and maps error codes to user-friendly notifications.

### PERF-01: Reverse-Chronological Pagination
- **Remediation:**
  - Implemented `get_poll_page(page, page_size)` in the smart contract.
  - UI loads 5 polls per page with single RPC simulation calls, eliminating $1 + 3N$ sequential requests.

---

## Live Stellar Testnet Verification

| Parameter | Value | Explorer Link |
|---|---|---|
| **Contract ID** | `CAK3AV4ZZKYTTXVG6DHLS5GSCDVNV5DHB6YSZRHQNOLW4FEBJQK7VBSU` | [Stellar Expert Contract Explorer](https://stellar.expert/explorer/testnet/contract/CAK3AV4ZZKYTTXVG6DHLS5GSCDVNV5DHB6YSZRHQNOLW4FEBJQK7VBSU) |
| **Deployer** | `GDIMHFYQBXURXI4CDJNZKWCKHQDVCXSJH7RAV2ZULI3CG57TJBDAZ4AX` | [Stellar Expert Account Explorer](https://stellar.expert/explorer/testnet/account/GDIMHFYQBXURXI4CDJNZKWCKHQDVCXSJH7RAV2ZULI3CG57TJBDAZ4AX) |

### Confirmed Transaction Evidence
- **WASM Bytecode Upload:** [`4fdff67cdd846b3c5fe3cc38cd567e9d581f2b1e0766fdc70bca1a226ab462bc`](https://stellar.expert/explorer/testnet/tx/4fdff67cdd846b3c5fe3cc38cd567e9d581f2b1e0766fdc70bca1a226ab462bc)
- **Contract Deployment:** [`62c3030e7834f680190e6206379f3de2620d18bc5e6f324c080a6c8c7fa106e0`](https://stellar.expert/explorer/testnet/tx/62c3030e7834f680190e6206379f3de2620d18bc5e6f324c080a6c8c7fa106e0)
- **Contract Initialization:** [`ca0f040212efe5f50471ff246fb25a7854c32453eb99e92d76a8e26276657ef2`](https://stellar.expert/explorer/testnet/tx/ca0f040212efe5f50471ff246fb25a7854c32453eb99e92d76a8e26276657ef2)
- **Create Poll #0:** [`f459d56d37279846f3207d12e1b5f19e053c83010c7088f380641bf62bf85eaa`](https://stellar.expert/explorer/testnet/tx/f459d56d37279846f3207d12e1b5f19e053c83010c7088f380641bf62bf85eaa)
- **Vote on Poll #0:** [`0e3ccc8ad4e2651014fe4512f818516d4aa74c401d1ba2cf2893e6d4ccf36eb6`](https://stellar.expert/explorer/testnet/tx/0e3ccc8ad4e2651014fe4512f818516d4aa74c401d1ba2cf2893e6d4ccf36eb6)
- **Duplicate Vote Rejection:** Confirmed rejected with `AlreadyVoted` (Error #12).
- **Close Poll #0:** [`848b2409ba5debc265c53ba762770de05e58fc7e66e871559f3a93f1055d852b`](https://stellar.expert/explorer/testnet/tx/848b2409ba5debc265c53ba762770de05e58fc7e66e871559f3a93f1055d852b)
- **Create Poll #1 (Active):** [`b07bc4cc400f4c7c46a91a85f7b6225826970e43ca9d216d96d05cae201e879d`](https://stellar.expert/explorer/testnet/tx/b07bc4cc400f4c7c46a91a85f7b6225826970e43ca9d216d96d05cae201e879d)

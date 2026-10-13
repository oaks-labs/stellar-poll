# StellarPoll Release Checklist & Maintainer Guide

This document defines the release standards, security reviews, and verification steps required before cutting a new release of StellarPoll.

---

## 1. Pre-Release Quality Gates

Every pull request and release candidate must pass all automated quality gates:

- [ ] **Contract Tests**: `cargo test --manifest-path contract/Cargo.toml` passes with 0 failures.
- [ ] **Release WASM Compilation**:
  ```bash
  cargo build --manifest-path contract/Cargo.toml --release --target wasm32-unknown-unknown
  ```
  Produces an optimized `.wasm` binary under 15 KB.
- [ ] **Frontend Linting**: `npm run lint` (`oxlint`) reports 0 errors and 0 warnings.
- [ ] **Frontend & SDK Tests**: `npm run test` (`vitest run`) passes 100% of unit and component tests.
- [ ] **TypeScript Typecheck & Build**: `npm run build` (`tsc -b && vite build`) succeeds with 0 type errors.

---

## 2. On-Chain Verification Checklist (Stellar Testnet)

Before tagging a version or updating public demo instances:

- [ ] Fund a fresh testnet wallet using Friendbot (`curl "https://friendbot.stellar.org?addr=<KEY>"`).
- [ ] Deploy the compiled `public/live_poll.wasm` to Stellar Testnet.
- [ ] Verify contract initialization and check that calling `initialize` a second time reverts with `AlreadyInitialized`.
- [ ] Create a standard public poll with 3 options; verify event emission on Stellar Expert.
- [ ] Create a restricted poll with a single-wallet allowlist; verify non-whitelisted wallet cannot vote.
- [ ] Cast votes from two distinct funded testnet wallets; verify vote tallies update only upon on-chain transaction confirmation.
- [ ] Attempt a duplicate vote from the same wallet; verify contract rejects with `AlreadyVoted`.
- [ ] Close the poll using the creator wallet; verify non-creators cannot close the poll.

---

## 3. Dependency & Environment Hygiene

- [ ] Ensure `.env.example` contains no real private keys, secret seeds (`S...`), or production secrets.
- [ ] Verify that `package-lock.json` and `contract/Cargo.lock` are committed and clean.
- [ ] Verify that transitive dependencies do not execute unpinned shell scripts on Windows (`--ignore-scripts` maintained).
- [ ] Pin critical cryptographic libraries (e.g. `ed25519-dalek = "=2.2.0"`) to avoid upstream breaking changes.

---

## 4. Release Tagging & Changelog Procedure

1. Update version in `package.json` and `contract/Cargo.toml`.
2. Re-compile release WASM and copy to `public/live_poll.wasm`.
3. Draft release notes summarizing:
   - Features added
   - Bug fixes
   - Breaking contract schema or SDK changes
   - Testnet deployment address
4. Create an annotated git tag:
   ```bash
   git tag -a v0.2.0 -m "Release v0.2.0: Bounded inputs, pagination, and typed SDK"
   git push origin v0.2.0
   ```

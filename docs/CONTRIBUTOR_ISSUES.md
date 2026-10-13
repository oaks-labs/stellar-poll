# StellarPoll Contributor Roadmap: Draft Issues

This document contains 12 genuine, fully-scoped future issues grounded in actual codebase architecture and community needs. Maintainers can copy and file these directly on GitHub to onboard open-source contributors.

---

### Issue #1 [DEFERRED - Design Incomplete]: Token-Weighted Voting with Balance Snapshotting / Escrow Locking

- **Status:** **DEFERRED pending architecture design**.
- **Problem & User Benefit:** Community DAOs often desire voting power proportional to token holdings rather than pure 1-wallet-1-vote.
- **Architectural Blocker / Rationale for Deferral:**
  - Simple spot balance checking at vote time (`token.balance(&voter)`) is fundamentally insecure:
    1. **Double-Voting via Transfers**: Voter A votes with 10,000 tokens, transfers tokens to Voter B, and Voter B votes again with the same tokens.
    2. **Flash-Loan Vulnerability**: Voters can borrow tokens via DeFi liquidity pools within a transaction, cast an outsized vote, and repay the loan in the same ledger.
  - This issue is strictly deferred until a formal **balance snapshot mechanism** (recording balances at a fixed past ledger) or a **token escrow locking contract** (locking tokens until poll closes) is designed and specified.
- **Dependencies:** SEP-41 Token Standard, Escrow / Snapshot architecture design.
- **Estimated Difficulty:** **High** (requires dedicated escrow/snapshot infrastructure).

---

### Issue #2: Ranked-Choice / Instant-Runoff Voting (IRV)

- **Problem & User Benefit:** When community polls feature multiple candidate options (e.g. hackathon winners or multi-option proposals), plurality voting leads to vote-splitting. Ranked-choice voting allows voters to express prioritized preferences.
- **Relevant Files & Current Behavior:**
  - `contract/src/lib.rs`: `vote` accepts a single `option_index: u32`.
  - `src/components/PollCard.tsx`: Options are selected via single radio/click buttons.
- **Scope & Non-Goals:**
  - Scope: Allow submitting an ordered preference vector `Vec<u32>` of option indices. Implement an instant-runoff tally algorithm that reallocates votes until an option achieves a majority (>50%).
  - Non-Goals: Multi-seat Single Transferable Vote (STV).
- **Dependencies:** Pure algorithmic computation in Rust and TypeScript SDK.
- **Testable Acceptance Criteria:**
  1. Voters submit preference lists `[2, 0, 1]`.
  2. Duplicate ranks in a single ballot are rejected.
  3. If no option wins majority on first preferences, lowest-ranked option is eliminated and secondary preferences reallocated until a winner emerges.
- **Required Verification:**
  - Unit tests in `contract/src/test.rs` simulating a 3-round runoff election.
- **Estimated Difficulty:** **High** (requires algorithmic state management while staying well within Soroban CPU budget).

---

### Issue #3: Two-Phase Commit-Reveal Scheme for Anti-Bandwagon Voting (Non-Anonymous)

- **Problem & User Benefit:** Displaying live tallies in real-time can introduce herd mentality, tactical bandwagon voting, or premature concession. A commit-reveal scheme hides vote choices until the poll closes.
- **Design Transparency Note:**
  - **Commit-reveal is NOT anonymous or encrypted.** It temporarily blinds choices during the active voting phase. Once the reveal phase occurs, all ballots, voter addresses, and choices are permanently and publicly visible on the Stellar ledger.
- **Relevant Files & Current Behavior:**
  - `contract/src/lib.rs`: Votes immediately update `poll.votes` and publish `VOTE` events.
  - `src/components/PollCard.tsx`: Displays live percentage progress bars.
- **Scope & Non-Goals:**
  - Scope: Two-phase polling:
    1. *Commit Phase*: Voter submits `hash(option_index, salt, voter_address)`.
    2. *Reveal Phase*: After closing, voter submits `option_index` and `salt`. Contract verifies hash against stored commitment and increments tally.
  - Non-Goals: Zero-Knowledge proofs or permanent ballot privacy.
- **Dependencies:** `env.crypto().sha256()`.
- **Testable Acceptance Criteria:**
  1. Tallies remain unrecorded and invisible during the commit phase.
  2. Submissions in reveal phase that don't match the commitment hash are rejected.
  3. Ballots submitted after commit phase deadline are rejected.
- **Required Verification:**
  - Contract test in `contract/src/test.rs` executing complete commit-reveal cycle and testing mismatched salt rejection.
- **Estimated Difficulty:** **Medium-High** (two distinct contract calls and lifecycle phases).

---

### Issue #4: CSV & JSON Poll Results Export with Cryptographic Audit Proofs

- **Problem & User Benefit:** Community managers, DAO admins, and auditors need to download poll results for external reports, spreadsheets, or discord announcements with verified transaction links.
- **Relevant Files & Current Behavior:**
  - `src/components/PollCard.tsx`: Displays results in UI only.
- **Scope & Non-Goals:**
  - Scope: Add an "Export Results" dropdown on `PollCard.tsx` generating:
    - `.csv`: Option names, vote counts, percentages, and total votes.
    - `.json`: Full poll record, contract ID, start/end timestamps, creator address, and Stellar Expert explorer URLs.
  - Non-Goals: Server-side PDF generation.
- **Dependencies:** Native browser Blob and URL APIs.
- **Testable Acceptance Criteria:**
  1. Clicking "Export CSV" triggers a download with valid CSV formatting.
  2. Clicking "Export JSON" produces valid JSON matching the `Poll` interface.
- **Required Verification:**
  - Vitest test asserting exported blob structure and field correctness.
- **Estimated Difficulty:** **Low** (pure frontend enhancement).

---

### Issue #5: Decentralized Poll Tagging and Category Filtering

- **Problem & User Benefit:** As communities create numerous polls, finding relevant polls by category (e.g. `#governance`, `#community`, `#development`, `#treasury`) is difficult.
- **Relevant Files & Current Behavior:**
  - `contract/src/lib.rs`: `Poll` struct lacks categorization fields.
  - `src/components/PollList.tsx`: Filters only by status (`open`, `scheduled`, `closed`).
- **Scope & Non-Goals:**
  - Scope: Add a `tag: Symbol` field to `Poll` (e.g. `symbol_short!("GOV")`). Add category filter buttons in `PollList.tsx`.
  - Non-Goals: Arbitrary free-text regex indexing on-chain.
- **Dependencies:** Contract struct update and SDK parameter extension.
- **Testable Acceptance Criteria:**
  1. Creator can pick from predefined categories or enter an 8-character symbol tag.
  2. `PollList.tsx` displays category filter pills.
  3. Selecting a category displays matching polls.
- **Required Verification:**
  - Contract test for tag storage and frontend test for tag filtering.
- **Estimated Difficulty:** **Medium** (contract and UI coordination).

---

### Issue #6: Real-Time Soroban RPC Event Streaming (`watchEvents`)

- **Problem & User Benefit:** Polling every 20 seconds introduces latency and consumes redundant network bandwidth when no new votes have been submitted.
- **Relevant Files & Current Behavior:**
  - `src/components/PollList.tsx`: Uses `setInterval` to refresh all polls every 20 seconds.
  - `src/sdk/client.ts`: Does not listen to Soroban events.
- **Scope & Non-Goals:**
  - Scope: Implement `client.watchEvents(callback)` using `SorobanRpc.Server.getEvents`. When a `VOTE` or `CREATE` event arrives, update the corresponding poll state reactively.
  - Non-Goals: Centralized WebSocket backend.
- **Dependencies:** Soroban RPC `getEvents`.
- **Testable Acceptance Criteria:**
  1. When an on-chain vote transaction confirms, `watchEvents` receives the event within 1 ledger (~5s) and triggers UI re-render without waiting for timer.
  2. Ledger cursor advances properly so duplicate events are not reprocessed.
- **Required Verification:**
  - Vitest test mocking `getEvents` stream and testing subscriber callback invocation.
- **Estimated Difficulty:** **Medium** (handling ledger paging and cursor state).

---

### Issue #7: Albedo and WalletConnect / Mobile QR Code Wallet Integrations

- **Problem & User Benefit:** Mobile users without desktop browser extensions cannot currently connect to vote on polls.
- **Relevant Files & Current Behavior:**
  - `src/lib/stellar.ts`: `StellarWalletsKit.init({ modules: defaultModules() })` defaults to desktop extension prompts.
  - `src/components/WalletConnection.tsx`: Recommends Freighter.
- **Scope & Non-Goals:**
  - Scope: Configure Albedo and WalletConnect modules in `StellarWalletsKit` so users on iOS/Android can connect using deep-links or QR codes.
  - Non-Goals: Building custom wallet apps.
- **Dependencies:** `@creit.tech/stellar-wallets-kit` companion packages.
- **Testable Acceptance Criteria:**
  1. Wallet modal presents Albedo and WalletConnect options.
  2. Mobile browsers can initiate transaction signing via mobile wallet apps.
- **Required Verification:**
  - Manual mobile testing and module initialization unit test in Vitest.
- **Estimated Difficulty:** **Low-Medium** (configuration and testing).

---

### Issue #8: Multi-Option Checkbox Voting (Approval Voting)

- **Problem & User Benefit:** For multi-candidate approvals or approving budget line items, voters need to select "all options that apply" (Approval Voting) rather than being restricted to a single choice.
- **Relevant Files & Current Behavior:**
  - `contract/src/lib.rs`: `vote` takes a single `option_index: u32`.
  - `src/components/PollCard.tsx`: Clicking an option immediately submits a single vote.
- **Scope & Non-Goals:**
  - Scope: Add `vote_multiple(voter, poll_id, option_indices: Vec<u32>)` in contract. Tally each selected option by 1 while marking voter as having voted.
  - Non-Goals: Score voting (1 to 5 stars).
- **Dependencies:** Contract function extension.
- **Testable Acceptance Criteria:**
  1. Voter submits `[0, 2]`; tallies for both options increment by 1.
  2. Duplicate indices in the input vector (e.g. `[0, 0]`) are rejected.
  3. Voter cannot vote a second time.
- **Required Verification:**
  - Contract test in `test.rs` asserting multiple option increments and duplicate index validation.
- **Estimated Difficulty:** **Medium**.

---

### Issue #9: Decentralized IPFS / Arweave Proposal Metadata Support

- **Problem & User Benefit:** Detailed proposals often contain multi-paragraph background explanations, rationale, and links that would be expensive to store directly in Soroban contract storage.
- **Relevant Files & Current Behavior:**
  - `contract/src/lib.rs`: `question` is limited to 280 characters.
  - `src/components/PollCreator.tsx`: Only single-line question input.
- **Scope & Non-Goals:**
  - Scope: Add an optional `metadata_cid: Option<String>` to `create_poll_advanced` (max 64 bytes for IPFS CIDv1 or Arweave transaction ID). In `PollCard.tsx`, fetch and render rich markdown description if present.
  - Non-Goals: Operating centralized IPFS pinners.
- **Dependencies:** Public IPFS gateway (`https://dweb.link/ipfs/`).
- **Testable Acceptance Criteria:**
  1. Creator can enter a proposal description or CID.
  2. Poll card renders formatted markdown proposal text fetched from the CID.
  3. If CID fails to load, gracefully fall back to displaying the question title only.
- **Required Verification:**
  - Component test testing CID resolution and graceful fallback.
- **Estimated Difficulty:** **Medium**.

---

### Issue #10: Multi-Network Switcher (Testnet / Mainnet / Futurenet)

- **Problem & User Benefit:** Production deployments require running on Stellar Mainnet, while developers need Testnet or Futurenet testing without editing code.
- **Relevant Files & Current Behavior:**
  - `src/lib/contract.ts`: Hardcoded to `RPC_URL = "https://soroban-testnet.stellar.org"`.
  - `src/lib/stellar.ts`: Hardcoded to Testnet passphrase.
- **Scope & Non-Goals:**
  - Scope: Add a network switcher dropdown in the header allowing switching between Testnet, Mainnet, and Futurenet. Scope local storage keys per network.
  - Non-Goals: Supporting private non-Stellar networks.
- **Dependencies:** `@stellar/stellar-sdk` Networks configuration.
- **Testable Acceptance Criteria:**
  1. Selecting "Mainnet" updates the RPC URL and network passphrase.
  2. Wallet connection prompts wallet to switch network or alerts if mismatched.
  3. Contract ID storage is partitioned by network (`stellar_poll_contract_id_testnet`, etc.).
- **Required Verification:**
  - Vitest test asserting configuration switching and storage key partitioning.
- **Estimated Difficulty:** **Low-Medium**.

---

### Issue #11: Embeddable Poll Widget (`/embed/:id` & NPM Component Package)

- **Problem & User Benefit:** Community websites, blog posts, and DAO dashboards want to embed active polls directly into their pages.
- **Relevant Files & Current Behavior:**
  - `src/components/PollCard.tsx`: Integrated only inside `App.tsx`.
- **Scope & Non-Goals:**
  - Scope: Provide an isolated URL route (`/?embed=1&poll=:id`) rendering a clean, borderless Poll Card suitable for `iframe` embedding.
  - Non-Goals: Full headless CMS integrations.
- **Dependencies:** Responsive iframe messaging.
- **Testable Acceptance Criteria:**
  1. Navigating to `/?embed=1&poll=0` renders only the Poll Card without headers/footers.
  2. Wallet connection and voting work inside the iframe context.
- **Required Verification:**
  - Vitest component test asserting embed mode hides outer layout elements.
- **Estimated Difficulty:** **Medium**.

---

### Issue #12: Automated Contract Storage Archival Monitoring & Warning Banner

- **Problem & User Benefit:** In Soroban, persistent entries that are not extended will eventually be archived. Communities need advance warning before a long-running poll expires.
- **Relevant Files & Current Behavior:**
  - `src/sdk/client.ts`: Reads poll data but does not inspect ledger entry live TTL.
  - `src/components/PollCard.tsx`: No expiration warning.
- **Scope & Non-Goals:**
  - Scope: Use `rpcServer.getLedgerEntries` to inspect the `liveUntilLedgerSeq` of the poll's persistent entry. If remaining ledgers < 10,000 (~14 hours), display a warning banner with a button for any user to extend TTL.
  - Non-Goals: Operating background automated bot daemons.
- **Dependencies:** Soroban RPC `getLedgerEntries`.
- **Testable Acceptance Criteria:**
  1. SDK checks `liveUntilLedgerSeq` during poll query.
  2. If TTL is critically low, `PollCard.tsx` displays "Expiring soon: 4 hours left" with an "Extend Lifetime" action.
- **Required Verification:**
  - Unit test mocking ledger entry response with low TTL and verifying warning display.
- **Estimated Difficulty:** **Medium**.

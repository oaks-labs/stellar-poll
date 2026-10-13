# StellarPoll

> An open-source, decentralized polling toolkit built on Stellar Soroban smart contracts.

[![CI](https://github.com/oaks-labs/stellar-poll/actions/workflows/ci.yml/badge.svg)](https://github.com/oaks-labs/stellar-poll/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Stellar Protocol](https://img.shields.io/badge/Stellar-Protocol%2021+-blue.svg)](https://stellar.org)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)

StellarPoll provides Stellar communities, DAOs, and developer teams with a reliable, verifiable on-chain voting toolkit. It eliminates off-chain manipulation through smart-contract-enforced one-wallet-one-vote invariants, lifecycle timestamps, bounded storage guarantees, and a reusable typed TypeScript SDK.

---

## Key Features

- **On-Chain Cryptographic Voting**: Votes are signed by voter wallets, verified on-chain, and recorded immutably on the Stellar ledger.
- **Strict Invariant Enforcement**:
  - One vote per wallet per poll (`AlreadyVoted` prevention).
  - Creator-only poll closing permissions.
  - Bounded input limits (questions: 3–280 chars; options: 2–10, each 1–100 chars) preventing storage abuse.
- **Dynamic Poll Lifecycles**:
  - `Scheduled`: Opens automatically at a specified Unix timestamp.
  - `Open`: Accepts votes from eligible participants.
  - `Closed`: Terminated automatically upon deadline or manually by the creator.
- **Restricted Voter Allowlists**: Optional bounded allowlists (up to 50 addresses) for council elections, committee approvals, or private governance.
- **Paginated Discovery**: Reverse-chronological pagination (`get_poll_page`) eliminating N+1 sequential RPC loops and rate limits.
- **Stable, Shareable Poll Links**: Direct navigation and fresh-browser support via `?network=testnet&contract=<id>&poll=<id>` URL parameters without requiring prior local storage or connected wallet.
- **Reusable TypeScript SDK**: Standalone, typed SDK (`src/sdk/`) decoupling read queries from wallet-signed mutations.

---

## System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   React 19 Frontend                    │
│   (PollCreator, PollList, PollCard, ContractSetup)    │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                  StellarPoll Client SDK                │
│    (Read Queries, Tx Submissions, Confirmation Loop)   │
└──────────────┬───────────────────────────┬─────────────┘
               │ (Direct Queries)          │ (Sign Calls)
               │                           │
┌──────────────▼────────────┐  ┌───────────▼─────────────┐
│    Soroban RPC Server     │  │   Stellar Wallets Kit   │
│ (https://soroban-testnet) │  │  (Freighter / Albedo)   │
└──────────────┬────────────┘  └───────────┬─────────────┘
               │                           │
┌──────────────▼───────────────────────────▼─────────────┐
│          Soroban Smart Contract (LivePoll)             │
│   - Instance Storage: NEXT_ID, ADMIN                   │
│   - Persistent Storage: (POLL, id), (VOTED, id, voter) │
│   - Time Invariants: start_time, end_time              │
│   - Auth Invariants: creator auth, voter auth          │
└────────────────────────────────────────────────────────┘
```

For detailed protocol semantics and storage layouts, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Tech Stack

- **Smart Contract**: Rust, `soroban-sdk v21`, `wasm32-unknown-unknown`
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4
- **Wallet Connection**: `@creit.tech/stellar-wallets-kit v2.5`
- **Stellar Interaction**: `@stellar/stellar-sdk v16`
- **Testing**: `soroban-sdk::testutils` (Rust), `vitest` + `happy-dom` (TypeScript)
- **Linting**: `oxlint`

---

## Prerequisites

- [Node.js](https://nodejs.org/) v20+ or v22+
- [Rust](https://rustup.rs/) v1.80+ with the `wasm32-unknown-unknown` target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- A Stellar wallet extension such as [Freighter](https://www.freighter.app/) set to **Testnet** mode.

---

## Quickstart & Setup

### 1. Clone the repository
```bash
git clone https://github.com/OAKVISUALZ/stellar-poll.git
cd stellar-poll
```

### 2. Install dependencies
```bash
# Note: Use --ignore-scripts to avoid platform-specific postinstall shell scripts
npm install --ignore-scripts
```

### 3. Build & Test the Smart Contract
```bash
cd contract
cargo test
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/live_poll.wasm ../public/live_poll.wasm
cd ..
```

### 4. Run the Quality Verification Suite
```bash
# Linting
npm run lint

# TypeScript SDK & Component Tests
npm run test

# Type Checking & Web App Build
npm run build
```

### 5. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Verified Stellar Testnet Deployment

A live, verified `LivePoll` contract instance is deployed on Stellar Testnet:

- **Contract ID**: `CAK3AV4ZZKYTTXVG6DHLS5GSCDVNV5DHB6YSZRHQNOLW4FEBJQK7VBSU`
- **Deployer Public Key**: `GDIMHFYQBXURXI4CDJNZKWCKHQDVCXSJH7RAV2ZULI3CG57TJBDAZ4AX`
- **WASM Upload Tx**: [`4fdff67cdd846b3c5fe3cc38cd567e9d581f2b1e0766fdc70bca1a226ab462bc`](https://stellar.expert/explorer/testnet/tx/4fdff67cdd846b3c5fe3cc38cd567e9d581f2b1e0766fdc70bca1a226ab462bc)
- **Contract Deploy Tx**: [`62c3030e7834f680190e6206379f3de2620d18bc5e6f324c080a6c8c7fa106e0`](https://stellar.expert/explorer/testnet/tx/62c3030e7834f680190e6206379f3de2620d18bc5e6f324c080a6c8c7fa106e0)
- **Initialize Tx**: [`ca0f040212efe5f50471ff246fb25a7854c32453eb99e92d76a8e26276657ef2`](https://stellar.expert/explorer/testnet/tx/ca0f040212efe5f50471ff246fb25a7854c32453eb99e92d76a8e26276657ef2)
- **Create Poll #0 Tx**: [`f459d56d37279846f3207d12e1b5f19e053c83010c7088f380641bf62bf85eaa`](https://stellar.expert/explorer/testnet/tx/f459d56d37279846f3207d12e1b5f19e053c83010c7088f380641bf62bf85eaa)
- **Vote Poll #0 Tx**: [`0e3ccc8ad4e2651014fe4512f818516d4aa74c401d1ba2cf2893e6d4ccf36eb6`](https://stellar.expert/explorer/testnet/tx/0e3ccc8ad4e2651014fe4512f818516d4aa74c401d1ba2cf2893e6d4ccf36eb6)
- **Close Poll #0 Tx**: [`848b2409ba5debc265c53ba762770de05e58fc7e66e871559f3a93f1055d852b`](https://stellar.expert/explorer/testnet/tx/848b2409ba5debc265c53ba762770de05e58fc7e66e871559f3a93f1055d852b)
- **Create Poll #1 Tx**: [`b07bc4cc400f4c7c46a91a85f7b6225826970e43ca9d216d96d05cae201e879d`](https://stellar.expert/explorer/testnet/tx/b07bc4cc400f4c7c46a91a85f7b6225826970e43ca9d216d96d05cae201e879d)

### Deploying Your Own Instance

1. Obtain testnet XLM via the [Stellar Testnet Faucet](https://friendbot.stellar.org/):
   ```bash
   curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
   ```
2. Open the application, connect your Freighter wallet, and click **Deploy New Poll Contract**.
3. Alternatively, paste `CAK3AV4ZZKYTTXVG6DHLS5GSCDVNV5DHB6YSZRHQNOLW4FEBJQK7VBSU` under **Connect to Existing Contract**.

---

## TypeScript SDK Usage

The extracted SDK allows external apps, bots, or scripts to interact with StellarPoll contracts:

```typescript
import { StellarPollClient } from "./sdk";

// 1. Initialize client with verified Testnet contract
const client = new StellarPollClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CAK3AV4ZZKYTTXVG6DHLS5GSCDVNV5DHB6YSZRHQNOLW4FEBJQK7VBSU",
});

// 2. Verify contract interface before querying
await client.verifyContractInterface();

// 3. Read-only query (no wallet required)
const total = await client.getPollCount();
const page = await client.getPollPage(0, 5); // Newest 5 polls

// 4. Vote with a connected wallet signer
await client.vote(walletSigner, {
  pollId: 1,
  optionIndex: 0,
});
```

See [examples/quickstart.ts](examples/quickstart.ts) for an end-to-end integration script. You can run it directly with:

```bash
npm run example:quickstart
```

---

## Smart Contract Functions

| Function | Parameters | Authorization | Description |
|---|---|---|---|
| `initialize` | `admin: Option<Address>` | `admin.require_auth()` | Initializes contract counter and admin metadata. |
| `create_poll` | `creator, question, options` | `creator.require_auth()` | Creates a standard open public poll. |
| `create_poll_advanced` | `creator, question, options, start_time, end_time, allowlist` | `creator.require_auth()` | Creates a scheduled, expiring, or allowlisted poll. |
| `vote` | `voter, poll_id, option_index` | `voter.require_auth()` | Casts a single vote on an active poll. |
| `close_poll` | `caller, poll_id` | `caller.require_auth()` | Closes an active poll (creator only). |
| `get_poll` | `poll_id` | None (Read-only) | Retrieves full poll data. |
| `get_poll_page` | `page, page_size` | None (Read-only) | Retrieves paginated polls (newest first). |
| `get_poll_status` | `poll_id` | None (Read-only) | Returns dynamic status (`Scheduled`, `Open`, `Closed`). |
| `get_results` | `poll_id` | None (Read-only) | Returns vector of vote counts. |
| `has_voted` | `poll_id, voter` | None (Read-only) | Checks if a wallet has voted on a poll. |
| `get_poll_count` | None | None (Read-only) | Returns total polls created. |

---

## Documentation

- [Architecture & Design](docs/ARCHITECTURE.md)
- [Compatibility & Migration Plan](docs/MIGRATION.md)
- [Release Checklist & Maintainer Guide](docs/RELEASE_CHECKLIST.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

---

## License

This project is licensed under the [MIT License](LICENSE).

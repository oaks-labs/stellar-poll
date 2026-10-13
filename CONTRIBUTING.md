# Contributing to StellarPoll

Thank you for your interest in contributing to StellarPoll! We welcome pull requests, bug reports, and suggestions from developers across the Stellar and Soroban ecosystem.

---

## 1. Prerequisites

Ensure you have the following installed on your machine:
- [Node.js](https://nodejs.org/) v20 or v22+
- [Rust](https://rustup.rs/) v1.80+
- The `wasm32-unknown-unknown` Rust target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- A Stellar wallet (such as [Freighter](https://www.freighter.app/)) set to **Testnet** mode.

---

## 2. Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/OAKVISUALZ/stellar-poll.git
   cd stellar-poll
   ```

2. **Install frontend dependencies:**
   *(Note: Use `--ignore-scripts` to prevent platform-specific postinstall failures on Windows).*
   ```bash
   npm install --ignore-scripts
   ```

3. **Verify the Smart Contract:**
   ```bash
   cd contract
   cargo test
   cargo build --release --target wasm32-unknown-unknown
   cp target/wasm32-unknown-unknown/release/live_poll.wasm ../public/live_poll.wasm
   cd ..
   ```

4. **Run the local development server:**
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173`.

---

## 3. Running Quality Checks

Before submitting a pull request, run all verification steps:

```bash
# 1. Lint the frontend codebase
npm run lint

# 2. Run TypeScript unit and component tests
npm run test

# 3. Typecheck and build the web application
npm run build

# 4. Run Rust smart contract tests
cargo test --manifest-path contract/Cargo.toml
```

All four commands must exit with code 0.

---

## 4. Pull Request Guidelines

1. **Branch Naming**: Use descriptive branch names:
   - `feat/feature-name`
   - `fix/bug-description`
   - `docs/documentation-update`
2. **Commit Messages**: Write clear, imperative commit messages (e.g. `feat: add paginated poll discovery`).
3. **Tests**: Any new contract logic or SDK functionality must include corresponding tests.
4. **Documentation**: Update the README or architecture documentation if contract schemas, SDK methods, or environment variables change.

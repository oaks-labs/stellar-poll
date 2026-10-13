/**
 * StellarPoll SDK Integration Example
 * Demonstrates verifying the contract interface, querying live polls on Stellar Testnet,
 * and handling contract error codes.
 */

import { StellarPollClient, PollErrorCode, PollContractError } from "../src/sdk";
import type { WalletSigner } from "../src/sdk";

// Verified LivePoll contract deployed on Stellar Testnet
export const VERIFIED_TESTNET_CONTRACT_ID =
  "CAK3AV4ZZKYTTXVG6DHLS5GSCDVNV5DHB6YSZRHQNOLW4FEBJQK7VBSU";

async function main() {
  const contractId =
    process.env.STELLAR_POLL_CONTRACT_ID || VERIFIED_TESTNET_CONTRACT_ID;

  // 1. Configure client for Stellar Testnet
  const client = new StellarPollClient({
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId,
  });

  console.log(`Connecting to StellarPoll contract: ${contractId}`);

  // 2. Confirm contract interface before executing queries
  const verifiedMethods = await client.verifyContractInterface();
  console.log(`Verified StellarPoll contract interface: [${verifiedMethods.join(", ")}]`);

  // 3. Read-Only Queries (propagates RPC, simulation, and decoding failures)
  const totalPolls = await client.getPollCount();
  console.log(`Total polls created: ${totalPolls}`);

  if (totalPolls > 0) {
    const recentPolls = await client.getPollPage(0, 5);
    for (const poll of recentPolls) {
      const status = await client.getPollStatus(poll.id);
      const results = await client.getResults(poll.id);
      console.log(`\nPoll #${poll.id}: "${poll.question}" [Status: ${status}, Active: ${poll.active}]`);
      console.log(`Creator: ${poll.creator}`);
      console.log(`Total Votes: ${poll.totalVotes}`);
      poll.options.forEach((opt, idx) => {
        const count = results[idx] ?? 0;
        console.log(`  [${idx}] ${opt} - ${count} votes`);
      });
    }

    // 4. Check duplicate-vote protection for the deployer wallet on Poll #0
    const deployerAddress = "GDIMHFYQBXURXI4CDJNZKWCKHQDVCXSJH7RAV2ZULI3CG57TJBDAZ4AX";
    const alreadyVoted = await client.hasVoted(0, deployerAddress);
    console.log(`\nHas ${deployerAddress} voted on Poll #0? ${alreadyVoted}`);

    // Demonstrate contract rejection when an already-voted or closed poll is invoked
    const demoSigner: WalletSigner = {
      publicKey: deployerAddress,
      signTransaction: async (xdrStr) => ({ signedTxXdr: xdrStr }),
    };

    try {
      await client.vote(demoSigner, {
        pollId: 0,
        optionIndex: 0,
      });
    } catch (err) {
      if (err instanceof PollContractError) {
        if (err.code === PollErrorCode.AlreadyVoted) {
          console.log(`Verified contract duplicate-vote guard: [Error #${err.code}] ${err.message}`);
        } else if (err.code === PollErrorCode.PollClosed) {
          console.log(`Verified contract closed-poll guard: [Error #${err.code}] ${err.message}`);
        } else {
          console.log(`Verified contract guard: [Error #${err.code}] ${err.message}`);
        }
      } else {
        throw err;
      }
    }
  }
}

async function runWithRetry(maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await main();
      return;
    } catch (err) {
      // Do not retry contract interface or validation failures
      if (
        err instanceof PollContractError ||
        (err instanceof Error && err.message.includes("does not implement the StellarPoll interface"))
      ) {
        throw err;
      }
      if (attempt === maxRetries) {
        throw err;
      }
      console.warn(`Transient RPC request failed (attempt ${attempt}/${maxRetries}), retrying in 2s...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

runWithRetry().catch((err) => {
  console.error("Quickstart error:", err);
  process.exit(1);
});

export { main };

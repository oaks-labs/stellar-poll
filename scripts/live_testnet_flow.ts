import * as fs from "node:fs";
import * as path from "node:path";
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Address,
  hash,
  StrKey,
  xdr,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";
import {
  StellarPollClient,
  PollContractError,
  PollErrorCode,
  waitForConfirmation,
  type WalletSigner,
} from "../src/sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

function computeContractId(salt: Buffer, deployerPublicKey: string): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      contractIdPreimage:
        xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new xdr.ContractIdPreimageFromAddress({
            address: Address.fromString(deployerPublicKey).toScAddress(),
            salt,
          })
        ),
    })
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

async function fundWithFriendbot(publicKey: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Friendbot funding failed (${res.status}): ${text}`);
  }
}

async function main() {
  const rpcServer = new SorobanRpc.Server(RPC_URL);
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  console.log(`1. Generated Testnet Keypair: ${publicKey}`);
  console.log("   Funding account via Stellar Testnet Friendbot...");
  await fundWithFriendbot(publicKey);
  console.log("   Account funded.");

  // Load compiled WASM
  const wasmPath = path.resolve(process.cwd(), "public", "live_poll.wasm");
  const wasmBuf = fs.readFileSync(wasmPath);
  const wasmHashBuf = hash(wasmBuf);

  // Upload WASM
  console.log(`2. Uploading WASM (${wasmBuf.length} bytes)...`);
  const account1 = await rpcServer.getAccount(publicKey);
  const uploadTx = new TransactionBuilder(account1, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.uploadContractWasm({ wasm: wasmBuf }))
    .setTimeout(300)
    .build();

  const preparedUpload = await rpcServer.prepareTransaction(uploadTx);
  preparedUpload.sign(keypair);
  const uploadSend = await rpcServer.sendTransaction(preparedUpload);
  if (uploadSend.status === "ERROR") {
    throw new Error(`Upload transaction failed to send: ${JSON.stringify(uploadSend)}`);
  }
  await waitForConfirmation(rpcServer, uploadSend.hash);
  console.log(`   WASM Uploaded! Tx Hash: ${uploadSend.hash}`);

  // Instantiate Contract
  const salt = hash(Buffer.from(publicKey + Date.now().toString()));
  const contractId = computeContractId(salt, publicKey);
  console.log(`3. Deploying contract instance ${contractId}...`);

  const account2 = await rpcServer.getAccount(publicKey);
  const createTx = new TransactionBuilder(account2, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(publicKey),
        wasmHash: wasmHashBuf,
        salt,
      })
    )
    .setTimeout(300)
    .build();

  const preparedCreate = await rpcServer.prepareTransaction(createTx);
  preparedCreate.sign(keypair);
  const createSend = await rpcServer.sendTransaction(preparedCreate);
  if (createSend.status === "ERROR") {
    throw new Error(`Contract creation failed to send: ${JSON.stringify(createSend)}`);
  }
  await waitForConfirmation(rpcServer, createSend.hash);
  console.log(`   Contract Deployed! Contract ID: ${contractId}`);
  console.log(`   Deploy Tx Hash: ${createSend.hash}`);

  // Configure SDK Client & Signer
  const client = new StellarPollClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    contractId,
  });

  const signer: WalletSigner = {
    publicKey,
    signTransaction: async (xdrStr) => {
      const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK_PASSPHRASE);
      tx.sign(keypair);
      return { signedTxXdr: tx.toXDR(), signerAddress: publicKey };
    },
  };

  // Verify Contract Interface
  console.log("4. Verifying deployed contract interface...");
  const methods = await client.verifyContractInterface();
  console.log(`   Verified methods: ${methods.join(", ")}`);

  // Initialize Contract
  console.log("5. Initializing contract...");
  const initRes = await client.initialize(signer);
  console.log(`   Initialized! Tx Hash: ${initRes.hash}`);

  // Create Poll #0
  console.log("6. Creating Poll #0 on Testnet...");
  const createPollRes = await client.createPoll(signer, {
    question: "Should StellarPoll adopt Soroban Protocol 21 state archival best practices?",
    options: ["Yes, adopt", "No, revise", "Abstain"],
  });
  console.log(`   Created Poll #${createPollRes.pollId}! Tx Hash: ${createPollRes.hash}`);

  // Vote on Poll #0
  console.log("7. Casting vote on Poll #0 (option 0)...");
  const voteRes = await client.vote(signer, {
    pollId: createPollRes.pollId,
    optionIndex: 0,
  });
  console.log(`   Vote confirmed! Tx Hash: ${voteRes.hash}`);

  // Verify Poll #0 state & results
  const pollAfterVote = await client.getPoll(0);
  const hasVoted = await client.hasVoted(0, publicKey);
  console.log(`   Poll #0 totalVotes=${pollAfterVote?.totalVotes}, votes=${JSON.stringify(pollAfterVote?.votes)}, hasVoted=${hasVoted}`);

  // Attempt Duplicate Vote on Poll #0 -> Must Reject with AlreadyVoted (#12)
  console.log("8. Attempting duplicate vote on Poll #0 (expecting AlreadyVoted #12 rejection)...");
  let duplicateRejectionCode: number | null = null;
  let duplicateRejectionMessage = "";
  try {
    await client.vote(signer, {
      pollId: 0,
      optionIndex: 1,
    });
    throw new Error("Expected duplicate vote to fail, but it succeeded!");
  } catch (err) {
    if (err instanceof PollContractError && err.code === PollErrorCode.AlreadyVoted) {
      duplicateRejectionCode = err.code;
      duplicateRejectionMessage = err.message;
      console.log(`   Duplicate vote rejected by contract as expected: [Error #${err.code}] ${err.message}`);
    } else {
      throw err;
    }
  }

  // Close Poll #0
  console.log("9. Closing Poll #0...");
  const closeRes = await client.closePoll(signer, 0);
  console.log(`   Poll #0 closed! Tx Hash: ${closeRes.hash}`);

  const pollAfterClose = await client.getPoll(0);
  console.log(`   Poll #0 status=${pollAfterClose?.status}, active=${pollAfterClose?.active}`);

  // Also create an open Poll #1 so examples/quickstart.ts can inspect both an open and closed poll
  console.log("10. Creating open Poll #1 for SDK quickstart inspection...");
  const createPoll1Res = await client.createPoll(signer, {
    question: "Which ecosystem feature should StellarPoll prioritize next?",
    options: ["Multi-choice polls", "CSV export", "Webhook indexer"],
  });
  console.log(`    Created Poll #${createPoll1Res.pollId}! Tx Hash: ${createPoll1Res.hash}`);

  const summary = {
    network: "testnet",
    rpcUrl: RPC_URL,
    deployerPublicKey: publicKey,
    contractId,
    transactions: {
      wasmUpload: uploadSend.hash,
      contractDeploy: createSend.hash,
      initialize: initRes.hash,
      createPoll0: createPollRes.hash,
      votePoll0: voteRes.hash,
      duplicateVoteRejection: {
        errorCode: duplicateRejectionCode,
        errorMessage: duplicateRejectionMessage,
      },
      closePoll0: closeRes.hash,
      createPoll1: createPoll1Res.hash,
    },
  };

  console.log("\n=== LIVE TESTNET VERIFICATION SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("Live testnet flow failed:", err);
  process.exit(1);
});

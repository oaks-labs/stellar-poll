import {
  xdr,
  hash,
  StrKey,
  Address,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  Networks,
} from "@stellar/stellar-sdk";
import { Server as SorobanRpcServer } from "@stellar/stellar-sdk/rpc";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import {
  StellarPollClient,
  type Poll,
  type PollStatus,
  type WalletSigner,
  waitForConfirmation,
  storePendingTx,
  clearPendingTx,
  parseRpcError,
  isValidStellarAddress,
  TransactionTimeoutError,
  recheckTransactionStatus,
} from "../sdk";

export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const CONTRACT_KEY = "stellar_live_poll_contract_id";

export const rpcServer = new SorobanRpcServer(RPC_URL);

let cachedWasm: Buffer | null = null;

export async function signWallet(
  xdrStr: string,
  opts?: { networkPassphrase?: string; address?: string }
): Promise<{ signedTxXdr: string; signerAddress?: string }> {
  return StellarWalletsKit.signTransaction(xdrStr, {
    networkPassphrase: opts?.networkPassphrase ?? NETWORK_PASSPHRASE,
    address: opts?.address,
  });
}

export function getSigner(publicKey: string): WalletSigner {
  return {
    publicKey,
    signTransaction: (xdrStr, opts) => signWallet(xdrStr, opts),
  };
}

async function getWasm(): Promise<Buffer> {
  if (cachedWasm) return cachedWasm;
  const res = await fetch("/live_poll.wasm");
  if (!res.ok) throw new Error("Failed to load contract WASM file from /live_poll.wasm");
  const buf = await res.arrayBuffer();
  cachedWasm = Buffer.from(buf);
  return cachedWasm;
}

export function computeContractId(salt: Buffer, deployerAddress: string): string {
  const networkId = hash(Buffer.from(NETWORK_PASSPHRASE));
  const addr = Address.fromString(deployerAddress);

  const preimageFromAddr = new xdr.ContractIdPreimageFromAddress({
    address: addr.toScAddress(),
    salt: salt,
  });

  const contractIdPreimage =
    xdr.ContractIdPreimage.contractIdPreimageFromAddress(preimageFromAddr);

  const hashPreimageContractId = new xdr.HashIdPreimageContractId({
    networkId,
    contractIdPreimage,
  });

  const hashPreimage =
    xdr.HashIdPreimage.envelopeTypeContractId(hashPreimageContractId);

  const contractIdBytes = hash(hashPreimage.toXDR());
  return StrKey.encodeContract(contractIdBytes);
}

export async function deployContract(
  deployerAddress: string
): Promise<{ contractId: string; hash: string }> {
  const wasm = await getWasm();
  const wasmHashBuf = Buffer.from(hash(wasm));

  // Step 1: Upload WASM bytecode
  const account1 = await rpcServer.getAccount(deployerAddress);
  const uploadTx = new TransactionBuilder(account1, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(300)
    .build();

  const preparedUpload = await rpcServer.prepareTransaction(uploadTx);
  const { signedTxXdr: signedUpload } = await signWallet(
    preparedUpload.toXDR(),
    { address: deployerAddress }
  );
  const uploaded = TransactionBuilder.fromXDR(signedUpload, NETWORK_PASSPHRASE);
  const uploadResult = await rpcServer.sendTransaction(uploaded);

  if (uploadResult.status === "ERROR") {
    throw parseRpcError(new Error("Contract bytecode upload failed on submission"));
  }

  storePendingTx({
    hash: uploadResult.hash,
    operation: "deploy",
    description: "Uploading contract bytecode",
    timestamp: Date.now(),
    network: "testnet",
    contractId: "",
    walletAddress: deployerAddress,
  });
  await waitForConfirmation(rpcServer, uploadResult.hash);
  clearPendingTx({
    network: "testnet",
    contractId: "",
    walletAddress: deployerAddress,
  });

  // Step 2: Instantiate contract instance
  const salt = hash(Buffer.from(deployerAddress + Date.now().toString()));
  const contractId = computeContractId(salt, deployerAddress);

  const account2 = await rpcServer.getAccount(deployerAddress);
  const createTx = new TransactionBuilder(account2, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(deployerAddress),
        wasmHash: wasmHashBuf,
        salt,
      })
    )
    .setTimeout(300)
    .build();

  const preparedCreate = await rpcServer.prepareTransaction(createTx);
  const { signedTxXdr: signedCreate } = await signWallet(
    preparedCreate.toXDR(),
    { address: deployerAddress }
  );
  const created = TransactionBuilder.fromXDR(signedCreate, NETWORK_PASSPHRASE);
  const createResult = await rpcServer.sendTransaction(created);

  if (createResult.status === "ERROR") {
    throw parseRpcError(new Error("Contract creation failed on submission"));
  }

  storePendingTx({
    hash: createResult.hash,
    operation: "deploy",
    description: `Deploying contract instance ${contractId.slice(0, 8)}...`,
    timestamp: Date.now(),
    network: "testnet",
    contractId,
    walletAddress: deployerAddress,
  });
  await waitForConfirmation(rpcServer, createResult.hash);
  clearPendingTx({
    network: "testnet",
    contractId,
    walletAddress: deployerAddress,
  });

  storeContractId(contractId);
  return { contractId, hash: createResult.hash };
}

export function getStoredContractId(): string | null {
  return localStorage.getItem(CONTRACT_KEY);
}

export function storeContractId(contractId: string): void {
  localStorage.setItem(CONTRACT_KEY, contractId);
}

export function clearContractId(): void {
  localStorage.removeItem(CONTRACT_KEY);
}

export function getPollClient(contractId: string): StellarPollClient {
  return new StellarPollClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    contractId,
  });
}

export async function initializeContract(
  contractId: string,
  publicKey: string
): Promise<{ hash: string }> {
  const client = getPollClient(contractId);
  return client.initialize(getSigner(publicKey));
}

export async function createPollOnChain(
  contractId: string,
  publicKey: string,
  question: string,
  options: string[],
  startTime = 0,
  endTime = 0,
  allowlist: string[] = []
): Promise<{ hash: string; pollId: number }> {
  const client = getPollClient(contractId);
  return client.createPoll(getSigner(publicKey), {
    question,
    options,
    startTime,
    endTime,
    allowlist,
  });
}

export async function voteOnPoll(
  contractId: string,
  publicKey: string,
  pollId: number,
  optionIndex: number
): Promise<{ hash: string }> {
  const client = getPollClient(contractId);
  return client.vote(getSigner(publicKey), {
    pollId,
    optionIndex,
  });
}

export async function closePollOnChain(
  contractId: string,
  publicKey: string,
  pollId: number
): Promise<{ hash: string }> {
  const client = getPollClient(contractId);
  return client.closePoll(getSigner(publicKey), pollId);
}

export async function getPollData(
  contractId: string,
  pollId: number
): Promise<Poll | null> {
  const client = getPollClient(contractId);
  return client.getPoll(pollId);
}

export async function getPollStatus(
  contractId: string,
  pollId: number
): Promise<PollStatus> {
  const client = getPollClient(contractId);
  return client.getPollStatus(pollId);
}

export async function getPollResults(
  contractId: string,
  pollId: number
): Promise<number[]> {
  const client = getPollClient(contractId);
  return client.getResults(pollId);
}

export async function hasVotedOnPoll(
  contractId: string,
  pollId: number,
  voter: string
): Promise<boolean> {
  const client = getPollClient(contractId);
  return client.hasVoted(pollId, voter);
}

export async function getPollCount(contractId: string): Promise<number> {
  const client = getPollClient(contractId);
  return client.getPollCount();
}

export async function getPollPage(
  contractId: string,
  page: number,
  pageSize = 5
): Promise<Poll[]> {
  const client = getPollClient(contractId);
  return client.getPollPage(page, pageSize);
}

export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export { isValidStellarAddress, TransactionTimeoutError, recheckTransactionStatus };
export type { Poll, PollStatus };

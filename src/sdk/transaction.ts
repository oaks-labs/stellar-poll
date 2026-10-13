import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { PollErrorCode, PollContractError } from "./types";

import type { PendingTransaction, PendingTxScope } from "./types";
export type { PendingTransaction, PendingTxScope };

export interface PendingTxResult {
  tx: PendingTransaction;
  isTimedOut: boolean;
}

export class TransactionTimeoutError extends Error {
  public readonly txHash: string;
  public readonly timeoutSeconds: number;

  constructor(txHash: string, timeoutSeconds: number) {
    super(
      `Transaction outcome unknown: confirmation timed out after ${timeoutSeconds} seconds (hash: ${txHash}). Recheck the transaction hash on-chain before resubmitting.`
    );
    this.name = "TransactionTimeoutError";
    this.txHash = txHash;
    this.timeoutSeconds = timeoutSeconds;
  }
}

export type TransactionOutcome =
  | { status: "SUCCESS"; response: SorobanRpc.Api.GetSuccessfulTransactionResponse }
  | { status: "FAILED"; response: SorobanRpc.Api.GetFailedTransactionResponse }
  | { status: "NOT_FOUND" };

export async function recheckTransactionStatus(
  rpcServer: SorobanRpc.Server,
  txHash: string
): Promise<TransactionOutcome> {
  const resp = await rpcServer.getTransaction(txHash);
  if (resp.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    return { status: "SUCCESS", response: resp };
  }
  if (resp.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
    return { status: "FAILED", response: resp };
  }
  return { status: "NOT_FOUND" };
}

const PENDING_TX_STORAGE_PREFIX = "stellar_poll_pending_tx";
export const DEFAULT_PENDING_TX_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function getScopedStorageKey(network: string, contractId?: string, walletAddress?: string): string {
  const c = contractId || "nocontract";
  const w = walletAddress || "nowallet";
  return `${PENDING_TX_STORAGE_PREFIX}:${network}:${c}:${w}`;
}

export function storePendingTx(tx: PendingTransaction): void {
  try {
    const key = getScopedStorageKey(tx.network, tx.contractId, tx.walletAddress);
    localStorage.setItem(key, JSON.stringify(tx));
    localStorage.setItem(`${PENDING_TX_STORAGE_PREFIX}:last_active_key`, key);
  } catch {
    // Ignore localStorage errors
  }
}

export function getPendingTx(
  scope?: PendingTxScope,
  timeoutMs = DEFAULT_PENDING_TX_TIMEOUT_MS
): PendingTxResult | null {
  try {
    let key: string | null = null;
    if (scope && scope.network) {
      key = getScopedStorageKey(scope.network, scope.contractId, scope.walletAddress);
    } else {
      key = localStorage.getItem(`${PENDING_TX_STORAGE_PREFIX}:last_active_key`);
    }

    if (!key) return null;

    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const tx = JSON.parse(raw) as PendingTransaction;

    // Strict scope verification
    if (scope) {
      if (scope.network && tx.network !== scope.network) return null;
      if (scope.contractId && tx.contractId && tx.contractId !== scope.contractId) return null;
      if (scope.walletAddress && tx.walletAddress && tx.walletAddress !== scope.walletAddress) return null;
    }

    const elapsed = Date.now() - tx.timestamp;
    if (elapsed > timeoutMs) {
      // Do not automatically delete or mark as failed; outcome is unknown until rechecked
      return { tx, isTimedOut: true };
    }

    return { tx, isTimedOut: false };
  } catch {
    return null;
  }
}

export function clearPendingTx(scope?: PendingTxScope): void {
  try {
    if (scope && scope.network) {
      const key = getScopedStorageKey(scope.network, scope.contractId, scope.walletAddress);
      localStorage.removeItem(key);
    } else {
      const lastKey = localStorage.getItem(`${PENDING_TX_STORAGE_PREFIX}:last_active_key`);
      if (lastKey) {
        localStorage.removeItem(lastKey);
        localStorage.removeItem(`${PENDING_TX_STORAGE_PREFIX}:last_active_key`);
      }
    }
  } catch {
    // Ignore localStorage errors
  }
}

export async function waitForConfirmation(
  rpcServer: SorobanRpc.Server,
  txHash: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const resp = await rpcServer.getTransaction(txHash);

    if (resp.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return resp;
    }

    if (resp.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed on-chain (hash: ${txHash})`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new TransactionTimeoutError(txHash, maxAttempts * (intervalMs / 1000));
}

export function parseRpcError(err: unknown): Error {
  if (err instanceof TransactionTimeoutError || err instanceof PollContractError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);

  // Check for User Wallet Denials
  if (
    message.toLowerCase().includes("rejected") ||
    message.toLowerCase().includes("denied") ||
    message.toLowerCase().includes("user declined")
  ) {
    return new Error("Transaction rejected in wallet. Please approve the request to continue.");
  }

  // Check for Insufficient balance
  if (
    message.toLowerCase().includes("insufficient") ||
    message.toLowerCase().includes("low balance") ||
    message.toLowerCase().includes("fee")
  ) {
    return new Error("Insufficient XLM balance for transaction fee. Please fund your wallet via Friendbot.");
  }

  // Check for network passphrase mismatch
  if (message.toLowerCase().includes("network") && message.toLowerCase().includes("mismatch")) {
    return new Error("Wallet network mismatch. Please ensure Freighter is set to Testnet mode.");
  }

  // Check for Contract error codes: Error(Contract, #<code>)
  const contractErrMatch = message.match(/Error\(Contract,\s*#?(\d+)\)/);
  if (contractErrMatch) {
    const code = Number(contractErrMatch[1]) as PollErrorCode;
    if ((Object.values(PollErrorCode) as number[]).includes(code)) {
      return new PollContractError(code);
    }
  }

  // Check for panic messages
  if (message.includes("already voted")) {
    return new PollContractError(PollErrorCode.AlreadyVoted);
  }
  if (message.includes("poll is closed")) {
    return new PollContractError(PollErrorCode.PollClosed);
  }
  if (message.includes("invalid option index")) {
    return new PollContractError(PollErrorCode.InvalidOptionIndex);
  }
  if (message.includes("only creator")) {
    return new PollContractError(PollErrorCode.NotAuthorized);
  }

  return err instanceof Error ? err : new Error(message);
}

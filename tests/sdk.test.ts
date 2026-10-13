import { describe, it, expect, beforeEach } from "vitest";
import {
  validateQuestion,
  validateOptions,
  validateTimeRange,
  validateAllowlist,
  validateCreatePollParams,
  isValidStellarAddress,
  isValidStellarContractAddress,
  MAX_POLL_DURATION_SECS,
} from "../src/sdk/validation";
import {
  PollContractError,
  PollErrorCode,
} from "../src/sdk/types";
import {
  parseRpcError,
  storePendingTx,
  getPendingTx,
  clearPendingTx,
  waitForConfirmation,
  recheckTransactionStatus,
  TransactionTimeoutError,
} from "../src/sdk/transaction";
import { StellarPollClient } from "../src/sdk/client";

describe("SDK Input Validation", () => {
  it("accepts valid question lengths", () => {
    expect(() => validateQuestion("Is Soroban ready?")).not.toThrow();
  });

  it("rejects questions that are too short", () => {
    expect(() => validateQuestion("No")).toThrowError(PollContractError);
    try {
      validateQuestion("No");
    } catch (e) {
      expect((e as PollContractError).code).toBe(PollErrorCode.QuestionTooShort);
    }
  });

  it("rejects questions that exceed 280 characters", () => {
    const longQ = "a".repeat(281);
    expect(() => validateQuestion(longQ)).toThrowError(PollContractError);
    try {
      validateQuestion(longQ);
    } catch (e) {
      expect((e as PollContractError).code).toBe(PollErrorCode.QuestionTooLong);
    }
  });

  it("validates option counts strictly between 2 and 10", () => {
    expect(() => validateOptions(["Only One"])).toThrowError(PollContractError);
    expect(() =>
      validateOptions([
        "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11",
      ])
    ).toThrowError(PollContractError);

    const valid = validateOptions(["  Alpha  ", "Beta"]);
    expect(valid).toEqual(["Alpha", "Beta"]);
  });

  it("rejects empty option strings", () => {
    expect(() => validateOptions(["Yes", "   "])).toThrowError(PollContractError);
    try {
      validateOptions(["Yes", ""]);
    } catch (e) {
      expect((e as PollContractError).code).toBe(PollErrorCode.OptionTooShort);
    }
  });

  it("rejects option strings exceeding 100 characters", () => {
    const longOpt = "x".repeat(101);
    expect(() => validateOptions(["Option A", longOpt])).toThrowError(PollContractError);
    try {
      validateOptions(["Option A", longOpt]);
    } catch (e) {
      expect((e as PollContractError).code).toBe(PollErrorCode.OptionTooLong);
    }
  });

  it("validates timestamp intervals and duration boundaries", () => {
    expect(() => validateTimeRange(100, 200)).not.toThrow();
    expect(() => validateTimeRange(200, 100)).toThrowError(PollContractError);
    expect(() => validateTimeRange(100, 100)).toThrowError(PollContractError);

    // Duration exceeding 30 days
    const start = 1_000;
    const tooLong = start + MAX_POLL_DURATION_SECS + 1;
    expect(() => validateTimeRange(start, tooLong)).toThrowError(PollContractError);
    try {
      validateTimeRange(start, tooLong);
    } catch (e) {
      expect((e as PollContractError).code).toBe(PollErrorCode.PollDurationTooLong);
    }
  });

  it("validates Stellar public keys and contract addresses", () => {
    const validVoterKey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    expect(isValidStellarAddress(validVoterKey)).toBe(true);
    expect(isValidStellarAddress("not-a-key")).toBe(false);

    const validContractKey = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    expect(isValidStellarContractAddress(validContractKey)).toBe(true);
    expect(isValidStellarContractAddress("GDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")).toBe(false);

    expect(validateAllowlist([validVoterKey])).toEqual([validVoterKey]);
    expect(() => validateAllowlist(["invalid-address"])).toThrow();
  });

  it("validates complete CreatePollParams correctly", () => {
    const params = {
      question: "Should we adopt this proposal?",
      options: ["Yes", "No"],
      startTime: 0,
      endTime: 0,
      allowlist: [],
    };
    const validated = validateCreatePollParams(params);
    expect(validated.question).toBe("Should we adopt this proposal?");
    expect(validated.options).toEqual(["Yes", "No"]);
  });
});

describe("SDK Error Parser", () => {
  it("translates user wallet rejections into friendly error messages", () => {
    const err = parseRpcError(new Error("User declined transaction signature"));
    expect(err.message).toContain("rejected in wallet");
  });

  it("translates low balance into faucet instructions", () => {
    const err = parseRpcError(new Error("insufficient balance for transaction fee"));
    expect(err.message).toContain("Friendbot");
  });

  it("parses contract error codes correctly", () => {
    const err = parseRpcError(new Error("HostError: Error(Contract, #12)"));
    expect(err).toBeInstanceOf(PollContractError);
    expect((err as PollContractError).code).toBe(PollErrorCode.AlreadyVoted);

    const closedErr = parseRpcError(new Error("Error(Contract, #9)"));
    expect((closedErr as PollContractError).code).toBe(PollErrorCode.PollClosed);

    const durationErr = parseRpcError(new Error("Error(Contract, #18)"));
    expect((durationErr as PollContractError).code).toBe(PollErrorCode.PollDurationTooLong);
  });
});

describe("Scoped Pending Transaction Tracking", () => {
  const TEST_NETWORK = "testnet";
  const TEST_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const TEST_WALLET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and retrieves scoped pending transactions", () => {
    expect(getPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: TEST_WALLET })).toBeNull();

    storePendingTx({
      hash: "abc123hash",
      operation: "vote",
      description: "Voting on poll #1",
      timestamp: Date.now(),
      network: TEST_NETWORK,
      contractId: TEST_CONTRACT,
      walletAddress: TEST_WALLET,
    });

    const stored = getPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: TEST_WALLET });
    expect(stored).not.toBeNull();
    expect(stored?.tx.hash).toBe("abc123hash");
    expect(stored?.tx.operation).toBe("vote");
    expect(stored?.isTimedOut).toBe(false);

    clearPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: TEST_WALLET });
    expect(getPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: TEST_WALLET })).toBeNull();
  });

  it("rejects mismatched networks, contracts, or wallets", () => {
    storePendingTx({
      hash: "tx_hash_scoped",
      operation: "create",
      description: "Creating poll",
      timestamp: Date.now(),
      network: TEST_NETWORK,
      contractId: TEST_CONTRACT,
      walletAddress: TEST_WALLET,
    });

    // Mismatched network returns null
    expect(getPendingTx({ network: "mainnet", contractId: TEST_CONTRACT, walletAddress: TEST_WALLET })).toBeNull();

    // Mismatched wallet returns null
    expect(getPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: "GOTHERWALLET" })).toBeNull();

    // Mismatched contract returns null
    expect(getPendingTx({ network: TEST_NETWORK, contractId: "COTHERCONTRACT", walletAddress: TEST_WALLET })).toBeNull();
  });

  it("treats timed-out pending transactions (> 5 minutes) as unknown outcome and preserves hash for recheck", () => {
    const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
    storePendingTx({
      hash: "tx_old_timeout",
      operation: "vote",
      description: "Old pending vote",
      timestamp: sixMinutesAgo,
      network: TEST_NETWORK,
      contractId: TEST_CONTRACT,
      walletAddress: TEST_WALLET,
    });

    const result = getPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: TEST_WALLET });
    expect(result).not.toBeNull();
    expect(result?.isTimedOut).toBe(true);
    expect(result?.tx.hash).toBe("tx_old_timeout");

    // Hash remains stored so user can recheck original transaction before resubmitting
    const secondCheck = getPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: TEST_WALLET });
    expect(secondCheck?.tx.hash).toBe("tx_old_timeout");

    // Cleared only once resolved or dismissed
    clearPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: TEST_WALLET });
    expect(getPendingTx({ network: TEST_NETWORK, contractId: TEST_CONTRACT, walletAddress: TEST_WALLET })).toBeNull();
  });

  it("throws TransactionTimeoutError with original hash on polling timeout and supports recheckTransactionStatus", async () => {
    const mockRpc = {
      getTransaction: async () => ({ status: "NOT_FOUND" }),
    };

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      waitForConfirmation(mockRpc as any, "hash_timeout_123", 2, 10)
    ).rejects.toThrowError(TransactionTimeoutError);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await waitForConfirmation(mockRpc as any, "hash_timeout_123", 2, 10);
    } catch (err) {
      expect(err).toBeInstanceOf(TransactionTimeoutError);
      expect((err as TransactionTimeoutError).txHash).toBe("hash_timeout_123");
    }

    // Recheck original hash when still not found
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notFoundOutcome = await recheckTransactionStatus(mockRpc as any, "hash_timeout_123");
    expect(notFoundOutcome.status).toBe("NOT_FOUND");

    // Recheck original hash when it subsequently confirms on-chain
    const confirmedRpc = {
      getTransaction: async () => ({ status: "SUCCESS", ledger: 12345 }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const successOutcome = await recheckTransactionStatus(confirmedRpc as any, "hash_timeout_123");
    expect(successOutcome.status).toBe("SUCCESS");
  });
});

describe("Client Initialization & Error Propagation", () => {
  it("instantiates client with valid config", () => {
    const client = new StellarPollClient({
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    });

    expect(client.config.contractId).toBe(
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
    );
    expect(client.rpcServer).toBeDefined();
  });

  it("propagates RPC and interface errors in getPollCount rather than defaulting to zero", async () => {
    const badClient = new StellarPollClient({
      rpcUrl: "https://127.0.0.1:1", // unreachable RPC
      networkPassphrase: "Test SDF Network ; September 2015",
      contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    });

    await expect(badClient.getPollCount()).rejects.toThrow();
  });
});

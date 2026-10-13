import { Client } from "@stellar/stellar-sdk/contract";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import {
  PollContractError,
  PollErrorCode,
  type CreatePollParams,
  type Poll,
  type PollStatus,
  type StellarPollConfig,
  type VoteParams,
  type WalletSigner,
} from "./types";
import { validateCreatePollParams } from "./validation";
import {
  parseRpcError,
  storePendingTx,
  clearPendingTx,
  waitForConfirmation,
  TransactionTimeoutError,
  recheckTransactionStatus,
  type TransactionOutcome,
} from "./transaction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContractClient = Client & Record<string, (...args: any[]) => Promise<any>>;

function unwrapSimulationResult<T>(res: unknown): T {
  if (res && typeof res === "object") {
    const maybeResult = res as {
      isErr?: () => boolean;
      unwrapErr?: () => unknown;
      unwrap?: () => T;
    };
    if (typeof maybeResult.isErr === "function" && maybeResult.isErr()) {
      const errVal =
        typeof maybeResult.unwrapErr === "function" ? maybeResult.unwrapErr() : res;
      const code =
        typeof errVal === "number"
          ? errVal
          : errVal && typeof errVal === "object" && "code" in errVal
            ? Number((errVal as { code: unknown }).code)
            : NaN;
      if (
        !Number.isNaN(code) &&
        (Object.values(PollErrorCode) as number[]).includes(code)
      ) {
        throw new PollContractError(code as PollErrorCode);
      }
      throw new Error(`Contract error result: ${JSON.stringify(errVal)}`);
    }
    if (typeof maybeResult.unwrap === "function") {
      return maybeResult.unwrap();
    }
  }
  return res as T;
}

function parsePollRecord(r: Record<string, unknown>, fallbackId: number): Poll {
  if (
    typeof r.question !== "string" ||
    !Array.isArray(r.options) ||
    !Array.isArray(r.votes) ||
    typeof r.active !== "boolean"
  ) {
    throw new Error(
      `Failed to decode Poll struct for poll #${fallbackId}: missing required fields.`
    );
  }

  const active = r.active;
  const startTime = Number(r.start_time ?? 0);
  const endTime = Number(r.end_time ?? 0);
  const now = Math.floor(Date.now() / 1000);

  let status: PollStatus = "open";
  if (!active) {
    status = "closed";
  } else if (startTime > 0 && now < startTime) {
    status = "scheduled";
  } else if (endTime > 0 && now > endTime) {
    status = "closed";
  }

  const allowlist = Array.isArray(r.allowlist)
    ? (r.allowlist as unknown[]).map(String)
    : [];

  return {
    id: Number(r.id ?? fallbackId),
    question: r.question,
    options: (r.options as unknown[]).map(String),
    votes: (r.votes as unknown[]).map(Number),
    creator: String(r.creator ?? ""),
    totalVotes: Number(r.total_votes ?? 0),
    active,
    startTime,
    endTime,
    allowlist,
    status,
  };
}

export class StellarPollClient {
  public readonly config: StellarPollConfig;
  public readonly rpcServer: SorobanRpc.Server;

  constructor(config: StellarPollConfig) {
    this.config = config;
    this.rpcServer = new SorobanRpc.Server(config.rpcUrl);
  }

  private async getReadOnlyClient(): Promise<AnyContractClient> {
    const client = await Client.from({
      rpcUrl: this.config.rpcUrl,
      networkPassphrase: this.config.networkPassphrase,
      contractId: this.config.contractId,
    });
    return client as AnyContractClient;
  }

  private async getSigningClient(signer: WalletSigner): Promise<AnyContractClient> {
    const client = await Client.from({
      rpcUrl: this.config.rpcUrl,
      networkPassphrase: this.config.networkPassphrase,
      contractId: this.config.contractId,
      publicKey: signer.publicKey,
      signTransaction: (xdr: string) =>
        signer.signTransaction(xdr, {
          networkPassphrase: this.config.networkPassphrase,
          address: signer.publicKey,
        }),
    });
    return client as AnyContractClient;
  }

  // ==========================================
  // INTERFACE VERIFICATION & READ-ONLY QUERIES
  // ==========================================

  /**
   * Verifies that the configured contract exposes the StellarPoll WASM interface
   * before executing queries or mutations. Throws if the contract is missing
   * required methods (e.g., if pointed at a token SAC or unrelated contract).
   */
  public async verifyContractInterface(): Promise<string[]> {
    try {
      const client = await this.getReadOnlyClient();
      const requiredMethods = [
        "get_poll_count",
        "get_poll",
        "create_poll",
        "vote",
        "close_poll",
      ];
      const missing = requiredMethods.filter(
        (fn) => typeof client[fn] !== "function"
      );
      if (missing.length > 0) {
        throw new Error(
          `Contract ${this.config.contractId} does not implement the StellarPoll interface (missing methods: ${missing.join(", ")}).`
        );
      }
      return requiredMethods;
    } catch (err) {
      throw parseRpcError(err);
    }
  }

  public async getPollCount(): Promise<number> {
    try {
      const client = await this.getReadOnlyClient();
      if (typeof client.get_poll_count !== "function") {
        throw new Error(
          `Contract ${this.config.contractId} does not expose get_poll_count.`
        );
      }
      const tx = await client.get_poll_count();
      if (tx.result === undefined || tx.result === null || Number.isNaN(Number(tx.result))) {
        throw new Error("Failed to decode u32 result from get_poll_count simulation.");
      }
      return Number(tx.result);
    } catch (err) {
      throw parseRpcError(err);
    }
  }

  public async getPoll(pollId: number): Promise<Poll | null> {
    try {
      const client = await this.getReadOnlyClient();
      if (typeof client.get_poll !== "function") {
        throw new Error(
          `Contract ${this.config.contractId} does not expose get_poll.`
        );
      }
      const tx = await client.get_poll({ poll_id: pollId });
      const r = unwrapSimulationResult<Record<string, unknown>>(tx.result);
      if (!r || typeof r !== "object") {
        throw new Error(`Invalid poll record decoded for poll #${pollId}.`);
      }
      return parsePollRecord(r, pollId);
    } catch (err) {
      const parsed = parseRpcError(err);
      if (
        parsed instanceof PollContractError &&
        parsed.code === PollErrorCode.PollNotFound
      ) {
        return null;
      }
      throw parsed;
    }
  }

  public async getPollStatus(pollId: number): Promise<PollStatus> {
    try {
      const client = await this.getReadOnlyClient();
      if (typeof client.get_poll_status !== "function") {
        const poll = await this.getPoll(pollId);
        if (!poll) {
          throw new PollContractError(PollErrorCode.PollNotFound);
        }
        return poll.status;
      }
      const tx = await client.get_poll_status({ poll_id: pollId });
      const unwrapped = unwrapSimulationResult<unknown>(tx.result);
      if (unwrapped && typeof unwrapped === "object" && "tag" in unwrapped) {
        const tag = String((unwrapped as { tag: unknown }).tag).toLowerCase();
        if (tag === "scheduled") return "scheduled";
        if (tag === "open") return "open";
        if (tag === "closed") return "closed";
      }
      const res = Number(unwrapped);
      if (res === 0) return "scheduled";
      if (res === 1) return "open";
      if (res === 2) return "closed";
      throw new Error(`Unexpected poll status value: ${JSON.stringify(unwrapped)}`);
    } catch (err) {
      throw parseRpcError(err);
    }
  }

  public async getResults(pollId: number): Promise<number[]> {
    try {
      const client = await this.getReadOnlyClient();
      if (typeof client.get_results !== "function") {
        throw new Error(
          `Contract ${this.config.contractId} does not expose get_results.`
        );
      }
      const tx = await client.get_results({ poll_id: pollId });
      const unwrapped = unwrapSimulationResult<unknown>(tx.result);
      if (!Array.isArray(unwrapped)) {
        throw new Error(`Failed to decode results array for poll #${pollId}.`);
      }
      return (unwrapped as number[]).map(Number);
    } catch (err) {
      throw parseRpcError(err);
    }
  }

  public async hasVoted(pollId: number, voter: string): Promise<boolean> {
    try {
      const client = await this.getReadOnlyClient();
      if (typeof client.has_voted !== "function") {
        throw new Error(
          `Contract ${this.config.contractId} does not expose has_voted.`
        );
      }
      const tx = await client.has_voted({ poll_id: pollId, voter });
      if (typeof tx.result !== "boolean") {
        throw new Error(`Failed to decode boolean result from has_voted.`);
      }
      return tx.result;
    } catch (err) {
      throw parseRpcError(err);
    }
  }

  public async getPollPage(page: number, pageSize = 5): Promise<Poll[]> {
    const client = await this.getReadOnlyClient();
    if (typeof client.get_poll_page !== "function") {
      // Fallback for legacy v1 contracts that lack get_poll_page
      return this.getPollPageFallback(page, pageSize);
    }

    try {
      const tx = await client.get_poll_page({
        page,
        page_size: pageSize,
      });

      if (!Array.isArray(tx.result)) {
        throw new Error("Failed to decode poll page vector from contract simulation.");
      }

      return (tx.result as Array<Record<string, unknown>>).map((r, i) =>
        parsePollRecord(r, i)
      );
    } catch (err) {
      throw parseRpcError(err);
    }
  }

  private async getPollPageFallback(page: number, pageSize: number): Promise<Poll[]> {
    const total = await this.getPollCount();
    if (total === 0) return [];

    const offset = page * pageSize;
    if (offset >= total) return [];

    const startIndex = total - 1 - offset;
    const polls: Poll[] = [];

    for (let i = startIndex; i >= 0 && polls.length < pageSize; i--) {
      const p = await this.getPoll(i);
      if (p) polls.push(p);
    }

    return polls;
  }

  public async recheckTransaction(txHash: string): Promise<TransactionOutcome> {
    return recheckTransactionStatus(this.rpcServer, txHash);
  }

  // ==========================================
  // WALLET-SIGNED CONTRACT MUTATIONS
  // ==========================================

  public async initialize(
    signer: WalletSigner,
    admin?: string
  ): Promise<{ hash: string }> {
    const network = this.config.networkPassphrase.includes("Public")
      ? "mainnet"
      : this.config.networkPassphrase.includes("Future")
        ? "futurenet"
        : "testnet";

    try {
      const client = await this.getSigningClient(signer);
      const tx = await client.initialize({ admin: admin ?? signer.publicKey });
      const sent = await tx.signAndSend();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = (sent as any).sendTransactionResponse as
        | { hash: string }
        | undefined;
      const hash = resp?.hash ?? "";

      if (hash) {
        storePendingTx({
          hash,
          operation: "initialize",
          description: "Initializing Live Poll contract",
          timestamp: Date.now(),
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
        await waitForConfirmation(this.rpcServer, hash);
        clearPendingTx({
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
      }

      return { hash };
    } catch (err) {
      const parsed = parseRpcError(err);
      if (!(parsed instanceof TransactionTimeoutError)) {
        clearPendingTx({
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
      }
      throw parsed;
    }
  }

  public async createPoll(
    signer: WalletSigner,
    params: CreatePollParams
  ): Promise<{ hash: string; pollId: number }> {
    const validated = validateCreatePollParams(params);
    const network = this.config.networkPassphrase.includes("Public")
      ? "mainnet"
      : this.config.networkPassphrase.includes("Future")
        ? "futurenet"
        : "testnet";

    try {
      const client = await this.getSigningClient(signer);

      // Call create_poll_advanced
      const tx = await client.create_poll_advanced({
        creator: signer.publicKey,
        question: validated.question,
        options: validated.options,
        start_time: validated.startTime,
        end_time: validated.endTime,
        allowlist: validated.allowlist,
      });

      const sent = await tx.signAndSend();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = (sent as any).sendTransactionResponse as
        | { hash: string }
        | undefined;
      const hash = resp?.hash ?? "";

      const unwrappedId = unwrapSimulationResult<unknown>(tx.result);
      const simulatedPollId =
        typeof unwrappedId === "number" ? unwrappedId : Number(unwrappedId ?? 0);

      if (hash) {
        storePendingTx({
          hash,
          operation: "create",
          description: `Creating poll "${validated.question}"`,
          timestamp: Date.now(),
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
        await waitForConfirmation(this.rpcServer, hash);
        clearPendingTx({
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
      }

      return {
        hash,
        pollId: simulatedPollId,
      };
    } catch (err) {
      const parsed = parseRpcError(err);
      if (!(parsed instanceof TransactionTimeoutError)) {
        clearPendingTx({
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
      }
      throw parsed;
    }
  }

  public async vote(
    signer: WalletSigner,
    params: VoteParams
  ): Promise<{ hash: string }> {
    const network = this.config.networkPassphrase.includes("Public")
      ? "mainnet"
      : this.config.networkPassphrase.includes("Future")
        ? "futurenet"
        : "testnet";

    try {
      const client = await this.getSigningClient(signer);
      const tx = await client.vote({
        voter: signer.publicKey,
        poll_id: params.pollId,
        option_index: params.optionIndex,
      });

      const sent = await tx.signAndSend();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = (sent as any).sendTransactionResponse as
        | { hash: string }
        | undefined;
      const hash = resp?.hash ?? "";

      if (hash) {
        storePendingTx({
          hash,
          operation: "vote",
          description: `Voting on poll #${params.pollId}`,
          timestamp: Date.now(),
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
        await waitForConfirmation(this.rpcServer, hash);
        clearPendingTx({
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
      }

      return { hash };
    } catch (err) {
      const parsed = parseRpcError(err);
      if (!(parsed instanceof TransactionTimeoutError)) {
        clearPendingTx({
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
      }
      throw parsed;
    }
  }

  public async closePoll(
    signer: WalletSigner,
    pollId: number
  ): Promise<{ hash: string }> {
    const network = this.config.networkPassphrase.includes("Public")
      ? "mainnet"
      : this.config.networkPassphrase.includes("Future")
        ? "futurenet"
        : "testnet";

    try {
      const client = await this.getSigningClient(signer);
      const tx = await client.close_poll({
        caller: signer.publicKey,
        poll_id: pollId,
      });

      const sent = await tx.signAndSend();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = (sent as any).sendTransactionResponse as
        | { hash: string }
        | undefined;
      const hash = resp?.hash ?? "";

      if (hash) {
        storePendingTx({
          hash,
          operation: "close",
          description: `Closing poll #${pollId}`,
          timestamp: Date.now(),
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
        await waitForConfirmation(this.rpcServer, hash);
        clearPendingTx({
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
      }

      return { hash };
    } catch (err) {
      const parsed = parseRpcError(err);
      if (!(parsed instanceof TransactionTimeoutError)) {
        clearPendingTx({
          network,
          contractId: this.config.contractId,
          walletAddress: signer.publicKey,
        });
      }
      throw parsed;
    }
  }
}

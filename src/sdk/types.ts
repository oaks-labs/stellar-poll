export type PollStatus = "scheduled" | "open" | "closed";

export interface Poll {
  id: number;
  question: string;
  options: string[];
  votes: number[];
  creator: string;
  totalVotes: number;
  active: boolean;
  startTime: number;
  endTime: number;
  allowlist: string[];
  status: PollStatus;
}

export interface CreatePollParams {
  question: string;
  options: string[];
  startTime?: number;
  endTime?: number;
  allowlist?: string[];
}

export interface VoteParams {
  pollId: number;
  optionIndex: number;
}

export interface StellarPollConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
}

export interface WalletSigner {
  publicKey: string;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

export interface PendingTransaction {
  hash: string;
  operation: "deploy" | "create" | "vote" | "close" | "initialize";
  description: string;
  timestamp: number;
  network: string;
  contractId: string;
  walletAddress: string;
}

export interface PendingTxScope {
  network: string;
  contractId?: string;
  walletAddress?: string;
}

export const PollErrorCode = {
  AlreadyInitialized: 1,
  NotInitialized: 2,
  InvalidOptionCount: 3,
  QuestionTooShort: 4,
  QuestionTooLong: 5,
  OptionTooShort: 6,
  OptionTooLong: 7,
  PollNotFound: 8,
  PollClosed: 9,
  PollNotStarted: 10,
  InvalidOptionIndex: 11,
  AlreadyVoted: 12,
  NotAuthorized: 13,
  PollAlreadyClosed: 14,
  InvalidTimeRange: 15,
  AllowlistTooLarge: 16,
  NotAllowedToVote: 17,
  PollDurationTooLong: 18,
  Unknown: 999,
} as const;

export type PollErrorCode = (typeof PollErrorCode)[keyof typeof PollErrorCode];

export const POLL_ERROR_MESSAGES: Record<PollErrorCode, string> = {
  [PollErrorCode.AlreadyInitialized]: "Contract has already been initialized.",
  [PollErrorCode.NotInitialized]: "Contract has not been initialized yet.",
  [PollErrorCode.InvalidOptionCount]: "Poll must have between 2 and 10 options.",
  [PollErrorCode.QuestionTooShort]: "Question must be at least 3 characters long.",
  [PollErrorCode.QuestionTooLong]: "Question must not exceed 280 characters.",
  [PollErrorCode.OptionTooShort]: "Option cannot be empty.",
  [PollErrorCode.OptionTooLong]: "Option must not exceed 100 characters.",
  [PollErrorCode.PollNotFound]: "Poll does not exist.",
  [PollErrorCode.PollClosed]: "Voting on this poll is closed.",
  [PollErrorCode.PollNotStarted]: "Voting has not opened yet (poll is scheduled).",
  [PollErrorCode.InvalidOptionIndex]: "Selected option is invalid.",
  [PollErrorCode.AlreadyVoted]: "This wallet has already voted on this poll.",
  [PollErrorCode.NotAuthorized]: "Only the poll creator is authorized to perform this operation.",
  [PollErrorCode.PollAlreadyClosed]: "Poll has already been closed.",
  [PollErrorCode.InvalidTimeRange]: "End time must be after start time.",
  [PollErrorCode.AllowlistTooLarge]: "Allowlist cannot exceed 50 addresses.",
  [PollErrorCode.NotAllowedToVote]: "This wallet address is not on the voter allowlist for this poll.",
  [PollErrorCode.PollDurationTooLong]: "Poll duration cannot exceed 30 days.",
  [PollErrorCode.Unknown]: "An unknown contract error occurred.",
};

export class PollContractError extends Error {
  public readonly code: PollErrorCode;

  constructor(code: PollErrorCode, customMessage?: string) {
    super(customMessage ?? POLL_ERROR_MESSAGES[code] ?? "Poll contract error");
    this.name = "PollContractError";
    this.code = code;
  }
}

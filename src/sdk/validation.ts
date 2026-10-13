import { StrKey } from "@stellar/stellar-sdk";
import type { CreatePollParams } from "./types";
import { PollErrorCode, PollContractError } from "./types";

export const MIN_QUESTION_LEN = 3;
export const MAX_QUESTION_LEN = 280;
export const MIN_OPTIONS_COUNT = 2;
export const MAX_OPTIONS_COUNT = 10;
export const MIN_OPTION_LEN = 1;
export const MAX_OPTION_LEN = 100;
export const MAX_ALLOWLIST_SIZE = 50;

export const MAX_POLL_DURATION_SECS = 30 * 24 * 3600; // 30 days

export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

export function isValidStellarContractAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  try {
    return StrKey.isValidContract(address);
  } catch {
    return false;
  }
}

export function validateQuestion(question: string): void {
  const trimmed = question?.trim() ?? "";
  if (trimmed.length < MIN_QUESTION_LEN) {
    throw new PollContractError(PollErrorCode.QuestionTooShort);
  }
  if (trimmed.length > MAX_QUESTION_LEN) {
    throw new PollContractError(PollErrorCode.QuestionTooLong);
  }
}

export function validateOptions(options: string[]): string[] {
  if (!Array.isArray(options)) {
    throw new PollContractError(PollErrorCode.InvalidOptionCount);
  }

  const cleaned = options.map((o) => o?.trim() ?? "");

  if (cleaned.length < MIN_OPTIONS_COUNT || cleaned.length > MAX_OPTIONS_COUNT) {
    throw new PollContractError(PollErrorCode.InvalidOptionCount);
  }

  for (const opt of cleaned) {
    if (opt.length < MIN_OPTION_LEN) {
      throw new PollContractError(PollErrorCode.OptionTooShort);
    }
    if (opt.length > MAX_OPTION_LEN) {
      throw new PollContractError(PollErrorCode.OptionTooLong);
    }
  }

  return cleaned;
}

export function validateTimeRange(startTime?: number, endTime?: number): void {
  if (startTime !== undefined && startTime < 0) {
    throw new PollContractError(PollErrorCode.InvalidTimeRange, "Start time must be non-negative.");
  }
  if (endTime !== undefined && endTime > 0 && startTime !== undefined && endTime <= startTime) {
    throw new PollContractError(PollErrorCode.InvalidTimeRange);
  }
  if (startTime !== undefined && endTime !== undefined && endTime > 0) {
    if (endTime - startTime > MAX_POLL_DURATION_SECS) {
      throw new PollContractError(PollErrorCode.PollDurationTooLong);
    }
  }
}

export function validateAllowlist(allowlist?: string[]): string[] {
  if (!allowlist || allowlist.length === 0) return [];

  const trimmedList = allowlist
    .map((addr) => addr?.trim())
    .filter((addr): addr is string => Boolean(addr));

  if (trimmedList.length > MAX_ALLOWLIST_SIZE) {
    throw new PollContractError(PollErrorCode.AllowlistTooLarge);
  }

  for (const addr of trimmedList) {
    if (!isValidStellarAddress(addr)) {
      throw new PollContractError(
        PollErrorCode.Unknown,
        `Invalid Stellar voter address in allowlist: "${addr}"`
      );
    }
  }

  return trimmedList;
}

export function validateCreatePollParams(params: CreatePollParams): {
  question: string;
  options: string[];
  startTime: number;
  endTime: number;
  allowlist: string[];
} {
  validateQuestion(params.question);
  const options = validateOptions(params.options);
  validateTimeRange(params.startTime, params.endTime);
  const allowlist = validateAllowlist(params.allowlist);

  return {
    question: params.question.trim(),
    options,
    startTime: params.startTime ?? 0,
    endTime: params.endTime ?? 0,
    allowlist,
  };
}

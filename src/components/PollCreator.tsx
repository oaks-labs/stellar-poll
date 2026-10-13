import { useState } from "react";
import { FaPlus, FaTrash, FaClock, FaUsers, FaInfoCircle } from "react-icons/fa";
import { createPollOnChain } from "../lib/contract";
import {
  MIN_QUESTION_LEN,
  MAX_QUESTION_LEN,
  MIN_OPTIONS_COUNT,
  MAX_OPTIONS_COUNT,
  MAX_OPTION_LEN,
  validateCreatePollParams,
  TransactionTimeoutError,
} from "../sdk";
import type { TxStatus } from "./TransactionStatus";

interface PollCreatorProps {
  contractId: string;
  publicKey: string;
  onPollCreated: () => void;
  onStatus: (status: TxStatus | null) => void;
}

export function PollCreator({
  contractId,
  publicKey,
  onPollCreated,
  onStatus,
}: PollCreatorProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [startDateTime, setStartDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [allowlistRaw, setAllowlistRaw] = useState("");
  const [creating, setCreating] = useState(false);

  const addOption = () => {
    if (options.length < MAX_OPTIONS_COUNT) {
      setOptions([...options, ""]);
    }
  };

  const removeOption = (index: number) => {
    if (options.length > MIN_OPTIONS_COUNT) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const updateOption = (index: number, value: string) => {
    const updated = [...options];
    updated[index] = value;
    setOptions(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const filledOptions = options.map((o) => o.trim()).filter(Boolean);

    // Parse timestamps (seconds)
    const startTimeUnix = startDateTime
      ? Math.floor(new Date(startDateTime).getTime() / 1000)
      : 0;
    const endTimeUnix = endDateTime
      ? Math.floor(new Date(endDateTime).getTime() / 1000)
      : 0;

    // Parse allowlist
    const parsedAllowlist = allowlistRaw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      validateCreatePollParams({
        question: question.trim(),
        options: filledOptions,
        startTime: startTimeUnix,
        endTime: endTimeUnix,
        allowlist: parsedAllowlist,
      });
    } catch (validationErr: unknown) {
      const msg = validationErr instanceof Error ? validationErr.message : String(validationErr);
      onStatus({ type: "error", message: msg });
      return;
    }

    setCreating(true);
    onStatus({
      type: "pending",
      message: "Submitting poll creation transaction to Soroban RPC...",
    });

    try {
      const { hash, pollId } = await createPollOnChain(
        contractId,
        publicKey,
        question.trim(),
        filledOptions,
        startTimeUnix,
        endTimeUnix,
        parsedAllowlist
      );

      onStatus({
        type: "success",
        message: `Poll #${pollId} created & confirmed on Stellar ledger!`,
        hash,
      });

      setQuestion("");
      setOptions(["", ""]);
      setStartDateTime("");
      setEndDateTime("");
      setAllowlistRaw("");
      setShowAdvanced(false);
      onPollCreated();
    } catch (err: unknown) {
      if (err instanceof TransactionTimeoutError) {
        onStatus({
          type: "unknown",
          message: err.message,
          hash: err.txHash,
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        onStatus({
          type: "error",
          message: msg,
        });
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/10">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
          <FaPlus className="text-purple-400" />
        </div>
        <div>
          <h3 className="text-white font-semibold">Create New Poll</h3>
          <p className="text-gray-400 text-xs">Decentralized, one-wallet-one-vote voting</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="poll-question" className="text-gray-400 text-xs uppercase tracking-wider">
              Question
            </label>
            <span
              className={`text-xs ${
                question.length > MAX_QUESTION_LEN
                  ? "text-red-400"
                  : question.length < MIN_QUESTION_LEN
                    ? "text-gray-500"
                    : "text-purple-400"
              }`}
            >
              {question.length}/{MAX_QUESTION_LEN}
            </span>
          </div>
          <input
            id="poll-question"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should the community decide?"
            maxLength={MAX_QUESTION_LEN + 10}
            required
            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-gray-400 text-xs uppercase tracking-wider">
              Options ({options.length}/10)
            </label>
            <span className="text-gray-500 text-xs">Min 2, max 10</span>
          </div>

          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  maxLength={MAX_OPTION_LEN}
                  required
                  aria-label={`Option ${i + 1}`}
                  className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
                />
                {options.length > MIN_OPTIONS_COUNT && (
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    aria-label={`Remove option ${i + 1}`}
                    className="text-red-400 hover:text-red-300 px-2 transition-colors cursor-pointer"
                  >
                    <FaTrash size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {options.length < MAX_OPTIONS_COUNT && (
            <button
              type="button"
              onClick={addOption}
              className="mt-2 text-purple-400 hover:text-purple-300 text-xs transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <FaPlus size={10} /> Add another option
            </button>
          )}
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-purple-400 hover:text-purple-300 text-xs transition-colors underline cursor-pointer"
          >
            {showAdvanced ? "Hide community settings" : "Show community settings (schedule & allowlist)"}
          </button>
        </div>

        {showAdvanced && (
          <div className="p-4 bg-black/20 rounded-xl space-y-4 border border-white/5">
            <div>
              <div className="flex items-center gap-2 mb-2 text-gray-300 text-xs font-semibold">
                <FaClock className="text-purple-400" />
                Schedule & Expiry (Optional)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="poll-start-time" className="block text-gray-400 text-xs mb-1">
                    Voting Opens:
                  </label>
                  <input
                    id="poll-start-time"
                    type="datetime-local"
                    value={startDateTime}
                    onChange={(e) => setStartDateTime(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-purple-500"
                  />
                  <p className="text-gray-500 text-[10px] mt-0.5">Leave empty to open immediately</p>
                </div>
                <div>
                  <label htmlFor="poll-end-time" className="block text-gray-400 text-xs mb-1">
                    Voting Closes:
                  </label>
                  <input
                    id="poll-end-time"
                    type="datetime-local"
                    value={endDateTime}
                    onChange={(e) => setEndDateTime(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-purple-500"
                  />
                  <p className="text-gray-500 text-[10px] mt-0.5">Leave empty for no deadline</p>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1.5 text-gray-300 text-xs font-semibold">
                <FaUsers className="text-purple-400" />
                Voter Allowlist (Optional)
              </div>
              <p className="text-gray-400 text-xs mb-2">
                Paste permitted Stellar public keys (one per line or comma-separated). Leave empty for an open public poll.
              </p>
              <textarea
                value={allowlistRaw}
                onChange={(e) => setAllowlistRaw(e.target.value)}
                placeholder="GBBD47IF...&#10;GDCX45..."
                rows={3}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono placeholder-gray-600 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
        )}

        <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-200 text-xs flex items-start gap-2.5">
          <FaInfoCircle className="text-purple-400 shrink-0 mt-0.5" />
          <div>
            <strong>Transparent & Verifiable:</strong> Once created, question text and options cannot be altered. Each voter wallet can only vote once, enforced directly by the smart contract.
          </div>
        </div>

        <button
          type="submit"
          disabled={creating}
          className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-purple-500/25 cursor-pointer"
        >
          {creating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Creating & Confirming On-Chain...
            </span>
          ) : (
            "Create Poll"
          )}
        </button>
      </form>
    </div>
  );
}

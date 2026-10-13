import { useState } from "react";
import {
  FaCheck,
  FaLock,
  FaClock,
  FaShareAlt,
  FaUsers,
  FaExclamationTriangle,
} from "react-icons/fa";
import {
  voteOnPoll,
  closePollOnChain,
  TransactionTimeoutError,
  type Poll,
  type PollStatus,
} from "../lib/contract";
import type { TxStatus } from "./TransactionStatus";

interface PollCardProps {
  poll: Poll;
  contractId: string;
  publicKey: string;
  userVoted: boolean;
  onVoted: () => void;
  onStatus: (status: TxStatus | null) => void;
}

export function PollCard({
  poll,
  contractId,
  publicKey,
  userVoted,
  onVoted,
  onStatus,
}: PollCardProps) {
  const [votingIndex, setVotingIndex] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const isCreator = Boolean(publicKey && poll.creator && poll.creator === publicKey);

  const hasAllowlist = Array.isArray(poll.allowlist) && poll.allowlist.length > 0;
  const isEligibleVoter = !hasAllowlist || (publicKey && poll.allowlist.includes(publicKey));

  const handleVote = async (optionIndex: number) => {
    if (!publicKey) {
      onStatus({
        type: "error",
        message: "Please connect your Stellar wallet first to cast a vote.",
      });
      return;
    }

    setVotingIndex(optionIndex);
    onStatus({
      type: "pending",
      message: `Confirming your vote for "${poll.options[optionIndex]}" on-chain...`,
    });

    try {
      const { hash } = await voteOnPoll(
        contractId,
        publicKey,
        poll.id,
        optionIndex
      );

      onStatus({
        type: "success",
        message: `Vote confirmed on Stellar ledger for "${poll.options[optionIndex]}"!`,
        hash,
      });

      onVoted();
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
      setVotingIndex(null);
    }
  };

  const handleClose = async () => {
    setClosing(true);
    onStatus({
      type: "pending",
      message: `Closing poll #${poll.id} on-chain...`,
    });

    try {
      const { hash } = await closePollOnChain(contractId, publicKey, poll.id);
      onStatus({
        type: "success",
        message: `Poll #${poll.id} has been closed on-chain.`,
        hash,
      });
      onVoted();
    } catch (err: unknown) {
      if (err instanceof TransactionTimeoutError) {
        onStatus({
          type: "unknown",
          message: err.message,
          hash: err.txHash,
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        onStatus({ type: "error", message: msg });
      }
    } finally {
      setClosing(false);
    }
  };

  const handleShare = async () => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("network", "testnet");
    url.searchParams.set("contract", contractId);
    url.searchParams.set("poll", poll.id.toString());
    await navigator.clipboard.writeText(url.toString());
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const getStatusBadge = (status: PollStatus) => {
    switch (status) {
      case "scheduled":
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
            <FaClock size={10} /> Scheduled
          </span>
        );
      case "closed":
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 border border-gray-500/30">
            <FaLock size={10} /> Closed
          </span>
        );
      case "open":
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
            ● Active
          </span>
        );
    }
  };

  const formatTimestamp = (ts: number) => {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="bg-black/20 rounded-xl p-5 border border-white/10 hover:border-white/20 transition-all shadow-lg">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1.5">
            <span className="text-gray-400 font-mono text-xs font-semibold">
              #{poll.id}
            </span>
            {getStatusBadge(poll.status)}

            {hasAllowlist && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                <FaUsers size={9} /> Restricted ({poll.allowlist.length} wallets)
              </span>
            )}

            {userVoted && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <FaCheck size={9} /> You Voted
              </span>
            )}
          </div>
          <h4 className="text-white font-medium text-base break-words">
            {poll.question}
          </h4>
        </div>

        <button
          onClick={handleShare}
          className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10 shrink-0"
          title="Share direct poll URL"
          aria-label="Share direct poll URL"
        >
          {shareCopied ? (
            <span className="text-xs text-green-400 font-mono">Copied!</span>
          ) : (
            <FaShareAlt size={14} />
          )}
        </button>
      </div>

      {/* Timing and Eligibility banners */}
      {poll.status === "scheduled" && poll.startTime > 0 && (
        <div className="mb-3 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-300 text-xs flex items-center gap-2">
          <FaClock /> Opens on {formatTimestamp(poll.startTime)}
        </div>
      )}

      {poll.status === "open" && poll.endTime > 0 && (
        <div className="mb-3 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-xs flex items-center gap-2">
          <FaClock /> Closes on {formatTimestamp(poll.endTime)}
        </div>
      )}

      {hasAllowlist && !isEligibleVoter && (
        <div className="mb-3 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-xs flex items-center gap-2">
          <FaExclamationTriangle /> Your connected wallet is not on this poll&apos;s voter allowlist.
        </div>
      )}

      {!publicKey && poll.status === "open" && (
        <div className="mb-3 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-xs flex items-center gap-2">
          <FaUsers size={12} /> Connect your Stellar wallet to vote on this poll.
        </div>
      )}

      {/* Options list */}
      <div className="space-y-2 mt-3">
        {poll.options.map((option, i) => {
          const voteCount = poll.votes[i] ?? 0;
          const percentage =
            poll.totalVotes > 0
              ? Math.round((voteCount / poll.totalVotes) * 100)
              : 0;
          const isVotingThis = votingIndex === i;
          const isVotingAny = votingIndex !== null;

          const isActionDisabled =
            !publicKey ||
            poll.status !== "open" ||
            userVoted ||
            !isEligibleVoter ||
            isVotingAny;

          return (
            <div key={i} className="relative overflow-hidden rounded-xl border border-white/10">
              {/* Progress background fill */}
              <div
                className="absolute inset-0 bg-purple-500/20 transition-all duration-700 ease-out"
                style={{ width: `${percentage}%` }}
              />

              <button
                onClick={() => handleVote(i)}
                disabled={isActionDisabled}
                aria-label={`Vote for ${option}`}
                className={`relative w-full text-left px-4 py-3 transition-all flex items-center justify-between gap-3 ${
                  userVoted
                    ? "cursor-default"
                    : poll.status !== "open" || !isEligibleVoter
                      ? "cursor-not-allowed opacity-60"
                      : "cursor-pointer hover:bg-white/5 active:bg-white/10"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {userVoted && voteCount > 0 && (
                    <FaCheck className="text-purple-400 shrink-0" size={12} />
                  )}
                  <span className="text-white text-sm font-medium truncate">
                    {option}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0 text-xs">
                  {isVotingThis ? (
                    <span className="text-purple-300 font-mono animate-pulse">
                      Confirming...
                    </span>
                  ) : (
                    <>
                      <span className="text-gray-300 font-mono">{voteCount}</span>
                      <span className="text-gray-400 font-mono font-semibold">
                        ({percentage}%)
                      </span>
                    </>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer Info & Creator Controls */}
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
        <div>
          Total votes: <span className="text-white font-mono">{poll.totalVotes}</span>
        </div>

        {isCreator && poll.active && poll.status !== "closed" && (
          <button
            onClick={handleClose}
            disabled={closing}
            className="text-red-400 hover:text-red-300 text-xs py-1.5 px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors inline-flex items-center gap-1 cursor-pointer"
          >
            <FaLock size={10} />
            {closing ? "Closing on-chain..." : "Close Poll"}
          </button>
        )}
      </div>
    </div>
  );
}

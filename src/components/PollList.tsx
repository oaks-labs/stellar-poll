import { useEffect, useState, useCallback } from "react";
import { FaSync, FaVoteYea, FaChevronLeft, FaChevronRight, FaTimes } from "react-icons/fa";
import {
  getPollCount,
  getPollPage,
  getPollData,
  hasVotedOnPoll,
  type Poll,
  type PollStatus,
} from "../lib/contract";
import { PollCard } from "./PollCard";
import type { TxStatus } from "./TransactionStatus";

interface PollListProps {
  contractId: string;
  publicKey: string;
  refreshTrigger: number;
  highlightPollId?: number | null;
  onClearHighlight?: () => void;
  onStatus: (status: TxStatus | null) => void;
}

const PAGE_SIZE = 5;

export function PollList({
  contractId,
  publicKey,
  refreshTrigger,
  highlightPollId,
  onClearHighlight,
  onStatus,
}: PollListProps) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [userVotedMap, setUserVotedMap] = useState<Record<number, boolean>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | PollStatus>("all");
  const [singlePoll, setSinglePoll] = useState<Poll | null>(null);

  // Fetch a single highlighted poll from direct URL navigation
  const fetchSinglePoll = useCallback(
    async (id: number) => {
      try {
        setLoading(true);
        const p = await getPollData(contractId, id);
        if (p) {
          setSinglePoll(p);
          if (publicKey) {
            const voted = await hasVotedOnPoll(contractId, id, publicKey);
            setUserVotedMap((prev) => ({ ...prev, [id]: voted }));
          }
        } else {
          setSinglePoll(null);
        }
      } catch (err) {
        console.error("Failed to load direct poll link:", err);
      } finally {
        setLoading(false);
      }
    },
    [contractId, publicKey]
  );

  // Fetch paginated polls
  const fetchPollPage = useCallback(async () => {
    try {
      setLoading(true);
      const count = await getPollCount(contractId);
      setTotalCount(count);

      if (count === 0) {
        setPolls([]);
        return;
      }

      const pageItems = await getPollPage(contractId, page, PAGE_SIZE);
      setPolls(pageItems);

      // Check voted status in parallel for this page
      if (publicKey && pageItems.length > 0) {
        const statuses = await Promise.all(
          pageItems.map((p) => hasVotedOnPoll(contractId, p.id, publicKey))
        );
        const map: Record<number, boolean> = {};
        pageItems.forEach((p, idx) => {
          map[p.id] = statuses[idx];
        });
        setUserVotedMap((prev) => ({ ...prev, ...map }));
      }
    } catch (err) {
      console.error("Failed to fetch poll page:", err);
    } finally {
      setLoading(false);
    }
  }, [contractId, page, publicKey]);

  useEffect(() => {
    if (highlightPollId !== undefined && highlightPollId !== null) {
      fetchSinglePoll(highlightPollId);
    } else {
      setSinglePoll(null);
      fetchPollPage();
    }
  }, [highlightPollId, fetchSinglePoll, fetchPollPage, refreshTrigger]);

  // Periodic refresh (20 seconds)
  useEffect(() => {
    const timer = setInterval(() => {
      if (highlightPollId !== undefined && highlightPollId !== null) {
        fetchSinglePoll(highlightPollId);
      } else {
        fetchPollPage();
      }
    }, 20000);
    return () => clearInterval(timer);
  }, [highlightPollId, fetchSinglePoll, fetchPollPage]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  const filteredPolls = polls.filter((p) => {
    if (filter === "all") return true;
    return p.status === filter;
  });

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/10 space-y-4">
      {/* Direct Poll Banner */}
      {singlePoll && (
        <div className="bg-purple-900/40 border border-purple-500/30 rounded-xl p-3 flex items-center justify-between text-xs text-purple-200">
          <span>Viewing shared poll direct link (#{singlePoll.id})</span>
          {onClearHighlight && (
            <button
              onClick={onClearHighlight}
              className="text-purple-300 hover:text-white font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <FaTimes /> View all polls
            </button>
          )}
        </div>
      )}

      {/* Header controls */}
      {!singlePoll && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <FaVoteYea className="text-blue-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Community Polls</h3>
              <p className="text-gray-400 text-xs">
                {totalCount} total poll{totalCount !== 1 ? "s" : ""} on-chain
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter pills */}
            <div className="flex bg-black/30 rounded-lg p-0.5 text-xs">
              {(["all", "open", "scheduled", "closed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-md capitalize transition-colors cursor-pointer ${
                    filter === f
                      ? "bg-purple-600 text-white font-semibold"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {f === "open" ? "Active" : f}
                </button>
              ))}
            </div>

            <button
              onClick={fetchPollPage}
              disabled={loading}
              className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10 cursor-pointer"
              title="Refresh polls"
              aria-label="Refresh polls"
            >
              <FaSync className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {singlePoll ? (
        <PollCard
          poll={singlePoll}
          contractId={contractId}
          publicKey={publicKey}
          userVoted={Boolean(userVotedMap[singlePoll.id])}
          onVoted={() => fetchSinglePoll(singlePoll.id)}
          onStatus={onStatus}
        />
      ) : loading && polls.length === 0 ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filteredPolls.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          {totalCount === 0
            ? "No community polls created yet. Be the first to create one above!"
            : `No polls match the "${filter}" filter on this page.`}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPolls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              contractId={contractId}
              publicKey={publicKey}
              userVoted={Boolean(userVotedMap[poll.id])}
              onVoted={fetchPollPage}
              onStatus={onStatus}
            />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {!singlePoll && totalCount > PAGE_SIZE && (
        <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs text-gray-400">
          <div>
            Page <span className="text-white font-mono">{page + 1}</span> of{" "}
            <span className="text-white font-mono">{totalPages}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="px-3 py-1.5 rounded-lg bg-black/30 hover:bg-black/50 disabled:opacity-40 disabled:cursor-not-allowed text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <FaChevronLeft size={10} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
              className="px-3 py-1.5 rounded-lg bg-black/30 hover:bg-black/50 disabled:opacity-40 disabled:cursor-not-allowed text-white inline-flex items-center gap-1 cursor-pointer"
            >
              Next <FaChevronRight size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

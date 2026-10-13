import {
  FaCheckCircle,
  FaTimesCircle,
  FaSpinner,
  FaExternalLinkAlt,
  FaQuestionCircle,
} from "react-icons/fa";

export interface TxStatus {
  type: "pending" | "success" | "error" | "unknown";
  message: string;
  hash?: string;
  canRetry?: boolean;
}

interface TransactionStatusProps {
  status: TxStatus | null;
  onDismiss: () => void;
  onRetry?: () => void;
  onRecheck?: (hash: string) => void;
}

export function TransactionStatus({
  status,
  onDismiss,
  onRetry,
  onRecheck,
}: TransactionStatusProps) {
  if (!status) return null;

  const colors = {
    pending: {
      bg: "bg-yellow-500/10 border-yellow-500/30",
      icon: "text-yellow-400",
      title: "text-yellow-300",
    },
    unknown: {
      bg: "bg-amber-500/10 border-amber-500/30",
      icon: "text-amber-400",
      title: "text-amber-300",
    },
    success: {
      bg: "bg-green-500/10 border-green-500/30",
      icon: "text-green-400",
      title: "text-green-300",
    },
    error: {
      bg: "bg-red-500/10 border-red-500/30",
      icon: "text-red-400",
      title: "text-red-300",
    },
  };

  const c = colors[status.type];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`backdrop-blur-lg rounded-2xl p-5 shadow-2xl border ${c.bg} transition-all`}
    >
      <div className="flex items-start gap-3">
        {status.type === "pending" && (
          <FaSpinner
            className={`${c.icon} text-xl mt-0.5 shrink-0 animate-spin`}
            aria-hidden="true"
          />
        )}
        {status.type === "unknown" && (
          <FaQuestionCircle
            className={`${c.icon} text-xl mt-0.5 shrink-0`}
            aria-hidden="true"
          />
        )}
        {status.type === "success" && (
          <FaCheckCircle className={`${c.icon} text-xl mt-0.5 shrink-0`} aria-hidden="true" />
        )}
        {status.type === "error" && (
          <FaTimesCircle className={`${c.icon} text-xl mt-0.5 shrink-0`} aria-hidden="true" />
        )}
        <div className="flex-1 min-w-0">
          <h4 className={`font-semibold mb-1 ${c.title}`}>
            {status.type === "pending"
              ? "Confirming On-Chain..."
              : status.type === "unknown"
                ? "Transaction Outcome Unknown (Timed Out)"
                : status.type === "success"
                  ? "Transaction Confirmed!"
                  : "Transaction Issue"}
          </h4>
          <p className="text-gray-300 text-sm mb-2 break-words">{status.message}</p>
          {status.hash && (
            <div className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
              <span className="text-gray-400 text-xs">Tx Hash:</span>
              <code className="text-purple-300 text-xs font-mono truncate flex-1">
                {status.hash}
              </code>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${status.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 shrink-0 inline-flex items-center gap-1 text-xs"
                title="View on Stellar Expert"
              >
                Explorer <FaExternalLinkAlt size={10} />
              </a>
            </div>
          )}

          {status.type === "unknown" && status.hash && onRecheck && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => onRecheck(status.hash!)}
                className="text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 py-1.5 px-3 rounded-lg transition-colors"
              >
                Recheck Original Hash On-Chain
              </button>
            </div>
          )}

          {status.type === "error" && onRetry && (
            <div className="mt-2">
              <button
                onClick={onRetry}
                className="text-xs font-medium text-white bg-red-600 hover:bg-red-500 py-1 px-3 rounded-lg transition-colors"
              >
                Retry Operation
              </button>
            </div>
          )}
        </div>
        {status.type !== "pending" && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className="text-gray-400 hover:text-white transition-colors text-sm shrink-0 px-1 py-0.5 rounded"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

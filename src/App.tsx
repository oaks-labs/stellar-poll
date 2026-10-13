import { useState, useEffect, useCallback } from "react";
import { FaPoll, FaInfoCircle } from "react-icons/fa";
import { WalletConnection } from "./components/WalletConnection";
import { BalanceDisplay } from "./components/BalanceDisplay";
import { PollCreator } from "./components/PollCreator";
import { PollList } from "./components/PollList";
import { ContractSetup } from "./components/ContractSetup";
import { TransactionStatus, type TxStatus } from "./components/TransactionStatus";
import {
  initKit,
  connectWallet,
  disconnectWallet,
  getAddress,
  getBalance,
} from "./lib/stellar";
import {
  getStoredContractId,
  storeContractId,
  clearContractId,
  rpcServer,
} from "./lib/contract";
import {
  getPendingTx,
  clearPendingTx,
  waitForConfirmation,
  isValidStellarContractAddress,
  TransactionTimeoutError,
  recheckTransactionStatus,
} from "./sdk";

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [assets, setAssets] = useState<
    Array<{ code: string; issuer: string; balance: string }>
  >([]);
  const [connecting, setConnecting] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [contractId, setContractId] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [highlightPollId, setHighlightPollId] = useState<number | null>(null);

  // Initialize Stellar Wallets Kit and check URL parameters
  useEffect(() => {
    initKit();

    const params = new URLSearchParams(window.location.search);
    const urlContract = params.get("contract");
    const pollParam = params.get("poll");

    let effectiveContract = getStoredContractId();
    if (urlContract && isValidStellarContractAddress(urlContract)) {
      effectiveContract = urlContract;
      storeContractId(urlContract);
    }
    setContractId(effectiveContract);

    if (pollParam !== null && !isNaN(Number(pollParam))) {
      setHighlightPollId(Number(pollParam));
    }

    // Restore pending transaction scoped to network and active contract
    const pendingResult = getPendingTx({
      network: "testnet",
      contractId: effectiveContract ?? undefined,
    });

    if (pendingResult) {
      if (pendingResult.isTimedOut) {
        setTxStatus({
          type: "unknown",
          message: `In-flight transaction timed out: "${pendingResult.tx.description}". Outcome is unknown—recheck the original hash before resubmitting.`,
          hash: pendingResult.tx.hash,
        });
      } else {
        const { tx } = pendingResult;
        setTxStatus({
          type: "pending",
          message: `Restored in-flight transaction: ${tx.description}`,
          hash: tx.hash,
        });

        waitForConfirmation(rpcServer, tx.hash)
          .then(() => {
            clearPendingTx({
              network: "testnet",
              contractId: effectiveContract ?? undefined,
            });
            setTxStatus({
              type: "success",
              message: `Transaction confirmed on-chain: ${tx.description}`,
              hash: tx.hash,
            });
            setRefreshTrigger((prev) => prev + 1);
          })
          .catch((err) => {
            if (err instanceof TransactionTimeoutError) {
              setTxStatus({
                type: "unknown",
                message: `Confirmation timed out for "${tx.description}". Outcome is unknown—recheck the original hash before resubmitting.`,
                hash: tx.hash,
              });
              return;
            }
            clearPendingTx({
              network: "testnet",
              contractId: effectiveContract ?? undefined,
            });
            setTxStatus({
              type: "error",
              message: `Transaction failed: ${err instanceof Error ? err.message : String(err)}`,
              hash: tx.hash,
            });
          });
      }
    }
  }, []);

  const fetchBalance = useCallback(async (address: string) => {
    setBalanceLoading(true);
    try {
      const result = await getBalance(address);
      setBalance(result.xlm);
      setAssets(result.assets);
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const checkExistingConnection = useCallback(async () => {
    const address = await getAddress();
    if (address) {
      setPublicKey(address);
      setIsConnected(true);
      fetchBalance(address);
    }
  }, [fetchBalance]);

  useEffect(() => {
    checkExistingConnection();
  }, [checkExistingConnection]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const address = await connectWallet();
      setPublicKey(address);
      setIsConnected(true);
      await fetchBalance(address);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("not installed")) {
        setTxStatus({
          type: "error",
          message:
            "Wallet not found. Please install the Freighter browser extension or another Stellar wallet.",
        });
      } else if (msg.includes("rejected") || msg.includes("denied")) {
        setTxStatus({
          type: "error",
          message: "Connection rejected by the wallet. Please approve the request.",
        });
      } else {
        setTxStatus({
          type: "error",
          message: `Connection failed: ${msg}`,
        });
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectWallet();
    } catch {
      // Proceed with local state clearing
    }
    setIsConnected(false);
    setPublicKey(null);
    setBalance(null);
    setAssets([]);
  };

  const handleRefreshBalance = () => {
    if (publicKey) fetchBalance(publicKey);
  };

  const handleContractDeployed = (id: string) => {
    setContractId(id);
  };

  const handlePollCreated = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleClearContract = () => {
    clearContractId();
    setContractId(null);
  };

  const handleClearHighlight = () => {
    setHighlightPollId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("poll");
    window.history.replaceState({}, "", url.toString());
  };

  const handleRecheckTx = async (hash: string) => {
    setTxStatus({
      type: "pending",
      message: "Rechecking original transaction hash on Stellar ledger...",
      hash,
    });
    try {
      const outcome = await recheckTransactionStatus(rpcServer, hash);
      if (outcome.status === "SUCCESS") {
        clearPendingTx({
          network: "testnet",
          contractId: contractId ?? undefined,
          walletAddress: publicKey ?? undefined,
        });
        setTxStatus({
          type: "success",
          message: "Original transaction confirmed on-chain! No resubmission needed.",
          hash,
        });
        setRefreshTrigger((prev) => prev + 1);
      } else if (outcome.status === "FAILED") {
        clearPendingTx({
          network: "testnet",
          contractId: contractId ?? undefined,
          walletAddress: publicKey ?? undefined,
        });
        setTxStatus({
          type: "error",
          message: "Original transaction failed on-chain. You may now safely retry.",
          hash,
        });
      } else {
        setTxStatus({
          type: "unknown",
          message: "Transaction hash is still not indexed on-chain. Wait and recheck, or dismiss to resubmit.",
          hash,
        });
      }
    } catch (err) {
      setTxStatus({
        type: "unknown",
        message: `Could not reach RPC to verify hash: ${err instanceof Error ? err.message : String(err)}`,
        hash,
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="py-6 px-4">
        <div className="max-w-2xl mx-auto flex items-center justify-center gap-3">
          <FaPoll className="text-purple-400 text-3xl" />
          <h1 className="text-white text-3xl font-extrabold tracking-tight">
            Stellar<span className="text-purple-400">Poll</span>
          </h1>
        </div>
        <p className="text-gray-400 text-center text-sm mt-1 max-w-md mx-auto">
          Decentralized community polling toolkit powered by Stellar Soroban smart contracts
        </p>
      </header>

      <main className="flex-1 px-4 pb-12">
        <div className="max-w-md mx-auto space-y-5">
          {/* Transparency & Security Info Banner */}
          <div className="bg-black/20 border border-white/10 rounded-2xl p-4 text-xs text-gray-300 flex items-start gap-3 shadow-lg">
            <FaInfoCircle className="text-purple-400 text-base shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Cryptographically Verified Polling:</strong> Every poll, vote, and state transition is verified directly on the Stellar ledger. Duplicate votes are rejected by the smart contract.
            </div>
          </div>

          <WalletConnection
            isConnected={isConnected}
            publicKey={publicKey}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            loading={connecting}
          />

          {/* Read-Only Banner when browsing polls without wallet */}
          {!isConnected && contractId && (
            <div className="bg-purple-900/20 border border-purple-500/30 rounded-2xl p-4 text-xs text-purple-200 flex items-start justify-between gap-3 shadow-lg">
              <div>
                <strong className="text-white block mb-0.5">Viewing Contract:</strong>
                <span className="font-mono text-gray-300 break-all">{contractId}</span>
                <p className="mt-1 text-gray-400">Connect your Stellar wallet above to vote or create polls.</p>
              </div>
              <button
                onClick={handleClearContract}
                className="text-gray-400 hover:text-white text-xs underline shrink-0 cursor-pointer"
              >
                Change Contract
              </button>
            </div>
          )}

          {/* Connected Wallet Controls */}
          {isConnected && publicKey && (
            <>
              <BalanceDisplay
                balance={balance}
                assets={assets}
                loading={balanceLoading}
                onRefresh={handleRefreshBalance}
              />

              <ContractSetup
                publicKey={publicKey}
                contractId={contractId}
                onDeployed={handleContractDeployed}
                onClear={handleClearContract}
                onStatus={setTxStatus}
              />

              {contractId && (
                <PollCreator
                  contractId={contractId}
                  publicKey={publicKey}
                  onPollCreated={handlePollCreated}
                  onStatus={setTxStatus}
                />
              )}
            </>
          )}

          {/* Poll Explorer: visible whenever a contract is attached (connected or read-only) */}
          {contractId && (
            <PollList
              contractId={contractId}
              publicKey={publicKey ?? ""}
              refreshTrigger={refreshTrigger}
              highlightPollId={highlightPollId}
              onClearHighlight={handleClearHighlight}
              onStatus={setTxStatus}
            />
          )}

          <TransactionStatus
            status={txStatus}
            onDismiss={() => setTxStatus(null)}
            onRecheck={handleRecheckTx}
          />
        </div>
      </main>

      <footer className="py-6 text-center text-gray-500 text-xs border-t border-white/5 space-y-1">
        <div>
          StellarPoll • Open Source Polling Toolkit for Stellar Communities
        </div>
        <div>
          Stellar Testnet (Protocol 21+) • React + TypeScript + Soroban SDK
        </div>
      </footer>
    </div>
  );
}

export default App;

import { useState } from "react";
import { FaFileContract, FaRocket, FaTrash, FaCheck, FaCopy, FaExchangeAlt } from "react-icons/fa";
import {
  deployContract,
  initializeContract,
  storeContractId,
  isValidStellarAddress,
} from "../lib/contract";
import type { TxStatus } from "./TransactionStatus";

interface ContractSetupProps {
  publicKey: string;
  contractId: string | null;
  onDeployed: (contractId: string) => void;
  onClear: () => void;
  onStatus: (status: TxStatus | null) => void;
}

export function ContractSetup({
  publicKey,
  contractId,
  onDeployed,
  onClear,
  onStatus,
}: ContractSetupProps) {
  const [deploying, setDeploying] = useState(false);
  const [manualId, setManualId] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (contractId) {
      await navigator.clipboard.writeText(contractId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    onStatus({
      type: "pending",
      message: "Uploading contract WASM bytecode to Stellar Testnet...",
    });

    try {
      const { contractId: newId, hash: deployHash } = await deployContract(publicKey);

      onStatus({
        type: "pending",
        message: `Contract deployed on-chain! Initializing instance...`,
        hash: deployHash,
      });

      try {
        await initializeContract(newId, publicKey);
      } catch (initErr) {
        // If initialize was already called or not needed, log softly
        console.warn("Contract initialization notice:", initErr);
      }

      onDeployed(newId);
      onStatus({
        type: "success",
        message: `Live Poll Contract deployed & confirmed on-chain!`,
        hash: deployHash,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onStatus({
        type: "error",
        message: msg,
      });
    } finally {
      setDeploying(false);
    }
  };

  const handleAttachManual = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualId.trim();
    if (!trimmed) return;

    if (!isValidStellarAddress(trimmed) && !trimmed.startsWith("C")) {
      onStatus({
        type: "error",
        message: "Invalid Soroban contract address format. Expected a valid C... contract ID.",
      });
      return;
    }

    storeContractId(trimmed);
    onDeployed(trimmed);
    setShowManualInput(false);
    setManualId("");
    onStatus({
      type: "success",
      message: `Attached to existing contract: ${trimmed.slice(0, 12)}...`,
    });
  };

  if (contractId) {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <FaFileContract className="text-green-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold">Active Contract Instance</h3>
            <p className="text-gray-400 text-xs">Live Poll Contract on Stellar Testnet</p>
          </div>
        </div>

        <div className="bg-black/20 rounded-xl px-4 py-3 mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-xs uppercase tracking-wider">
              Contract Address
            </span>
            <button
              onClick={handleCopy}
              className="text-gray-400 hover:text-white transition-colors text-xs inline-flex items-center gap-1"
              title="Copy Contract Address"
            >
              {copied ? (
                <span className="text-green-400 inline-flex items-center gap-1">
                  <FaCheck size={10} /> Copied
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <FaCopy size={10} /> Copy
                </span>
              )}
            </button>
          </div>
          <code className="text-purple-300 text-xs font-mono break-all select-all">
            {contractId}
          </code>
        </div>

        <div className="flex gap-2">
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${contractId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center text-blue-400 hover:text-blue-300 text-xs py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
          >
            View on Explorer
          </a>
          <button
            onClick={() => setShowManualInput(!showManualInput)}
            className="text-purple-400 hover:text-purple-300 text-xs py-2 px-3 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-colors inline-flex items-center gap-1"
            title="Switch Contract Instance"
          >
            <FaExchangeAlt size={10} /> Switch
          </button>
          <button
            onClick={onClear}
            className="flex items-center justify-center gap-1 text-red-400 hover:text-red-300 text-xs py-2 px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
            title="Reset Contract"
          >
            <FaTrash size={10} /> Reset
          </button>
        </div>

        {showManualInput && (
          <form onSubmit={handleAttachManual} className="mt-3 pt-3 border-t border-white/10 space-y-2">
            <label htmlFor="switch-contract" className="block text-gray-300 text-xs">
              Connect to Another Contract Address:
            </label>
            <div className="flex gap-2">
              <input
                id="switch-contract"
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="C..."
                className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs font-mono placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
              <button
                type="submit"
                className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                Connect
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/10">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
          <FaRocket className="text-orange-400" />
        </div>
        <div>
          <h3 className="text-white font-semibold">Contract Setup</h3>
          <p className="text-gray-400 text-sm">
            Deploy a new Live Poll contract or connect an existing one
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={handleDeploy}
          disabled={deploying}
          className="w-full bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-orange-500/25 cursor-pointer"
        >
          {deploying ? (
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
              Deploying Contract to Testnet...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <FaRocket aria-hidden="true" />
              Deploy New Poll Contract
            </span>
          )}
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowManualInput(!showManualInput)}
            className="text-purple-400 hover:text-purple-300 text-xs transition-colors underline cursor-pointer"
          >
            {showManualInput ? "Cancel manual entry" : "Or use an existing contract ID"}
          </button>
        </div>

        {showManualInput && (
          <form onSubmit={handleAttachManual} className="space-y-2 pt-2">
            <label htmlFor="manual-contract" className="block text-gray-400 text-xs uppercase tracking-wider">
              Existing Contract Address
            </label>
            <div className="flex gap-2">
              <input
                id="manual-contract"
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="C..."
                className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white text-xs font-mono placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
              <button
                type="submit"
                className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium px-4 py-2 rounded-xl transition-colors"
              >
                Attach
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

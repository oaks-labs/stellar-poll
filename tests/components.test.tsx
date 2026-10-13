import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { WalletConnection } from "../src/components/WalletConnection";
import { TransactionStatus, type TxStatus } from "../src/components/TransactionStatus";
import { BalanceDisplay } from "../src/components/BalanceDisplay";
// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("React Components Testing", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    root = null;
  });

  it("renders WalletConnection in disconnected state and handles connect click", () => {
    let connectCalled = false;

    act(() => {
      root?.render(
        <WalletConnection
          isConnected={false}
          publicKey={null}
          onConnect={() => {
            connectCalled = true;
          }}
          onDisconnect={() => {}}
          loading={false}
        />
      );
    });

    expect(container?.textContent).toContain("Connect Your Wallet");
    const button = container?.querySelector("button");
    expect(button?.textContent).toBe("Connect Wallet");

    act(() => {
      button?.click();
    });
    expect(connectCalled).toBe(true);
  });

  it("renders WalletConnection in connected state with address and disconnect button", () => {
    let disconnectCalled = false;
    const testKey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    act(() => {
      root?.render(
        <WalletConnection
          isConnected={true}
          publicKey={testKey}
          onConnect={() => {}}
          onDisconnect={() => {
            disconnectCalled = true;
          }}
          loading={false}
        />
      );
    });

    expect(container?.textContent).toContain("Wallet Connected");
    expect(container?.textContent).toContain("GBBD47...LLFLA5");

    const disconnectBtn = container?.querySelectorAll("button")[1];
    expect(disconnectBtn?.textContent).toContain("Disconnect");

    act(() => {
      disconnectBtn?.click();
    });
    expect(disconnectCalled).toBe(true);
  });

  it("renders TransactionStatus pending state with spinner", () => {
    const status: TxStatus = {
      type: "pending",
      message: "Confirming transaction on Stellar ledger...",
      hash: "1234567890abcdef",
    };

    act(() => {
      root?.render(<TransactionStatus status={status} onDismiss={() => {}} />);
    });

    expect(container?.textContent).toContain("Confirming On-Chain...");
    expect(container?.textContent).toContain("Confirming transaction on Stellar ledger...");
    expect(container?.textContent).toContain("1234567890abcdef");

    const explorerLink = container?.querySelector("a");
    expect(explorerLink?.getAttribute("href")).toContain(
      "https://stellar.expert/explorer/testnet/tx/1234567890abcdef"
    );
  });

  it("renders TransactionStatus error state and triggers retry", () => {
    let retryCalled = false;
    const status: TxStatus = {
      type: "error",
      message: "Insufficient balance",
    };

    act(() => {
      root?.render(
        <TransactionStatus
          status={status}
          onDismiss={() => {}}
          onRetry={() => {
            retryCalled = true;
          }}
        />
      );
    });

    expect(container?.textContent).toContain("Transaction Issue");
    expect(container?.textContent).toContain("Insufficient balance");

    const retryBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Retry")
    );
    expect(retryBtn).toBeDefined();

    act(() => {
      retryBtn?.click();
    });
    expect(retryCalled).toBe(true);
  });

  it("renders TransactionStatus unknown timeout state and triggers recheck of original hash", () => {
    let recheckedHash = "";
    const status: TxStatus = {
      type: "unknown",
      message: "Confirmation timed out. Recheck before resubmitting.",
      hash: "deadbeef12345678",
    };

    act(() => {
      root?.render(
        <TransactionStatus
          status={status}
          onDismiss={() => {}}
          onRecheck={(h) => {
            recheckedHash = h;
          }}
        />
      );
    });

    expect(container?.textContent).toContain("Transaction Outcome Unknown (Timed Out)");
    expect(container?.textContent).toContain("deadbeef12345678");

    const recheckBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Recheck Original Hash On-Chain")
    );
    expect(recheckBtn).toBeDefined();

    act(() => {
      recheckBtn?.click();
    });
    expect(recheckedHash).toBe("deadbeef12345678");
  });

  it("renders BalanceDisplay with formatted balance and assets", () => {
    let refreshCalled = false;

    act(() => {
      root?.render(
        <BalanceDisplay
          balance="100.5"
          assets={[{ code: "USDC", issuer: "GBBD47...", balance: "25.00" }]}
          loading={false}
          onRefresh={() => {
            refreshCalled = true;
          }}
        />
      );
    });

    expect(container?.textContent).toContain("100.50");
    expect(container?.textContent).toContain("USDC");
    expect(container?.textContent).toContain("25.00");

    const refreshBtn = container?.querySelector("button");
    act(() => {
      refreshBtn?.click();
    });
    expect(refreshCalled).toBe(true);
  });

  it("renders PollCard in read-only unauthenticated state and guides user to connect wallet", () => {
    let statusMessage = "";
    const testPoll = {
      id: 0,
      question: "Is this proposal approved?",
      options: ["Yes", "No"],
      votes: [10, 5],
      creator: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      totalVotes: 15,
      active: true,
      startTime: 0,
      endTime: 0,
      allowlist: [],
      status: "open" as const,
    };

    import("../src/components/PollCard").then(({ PollCard }) => {
      act(() => {
        root?.render(
          <PollCard
            poll={testPoll}
            contractId="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
            publicKey=""
            userVoted={false}
            onVoted={() => {}}
            onStatus={(status) => {
              if (status?.message) statusMessage = status.message;
            }}
          />
        );
      });

      expect(container?.textContent).toContain("Is this proposal approved?");
      expect(container?.textContent).toContain("Connect your Stellar wallet to vote on this poll");
      expect(container?.textContent).toContain("Yes");
      expect(container?.textContent).toContain("67%");

      // Attempting to click an option while disconnected triggers wallet reminder
      const voteOptionBtn = container?.querySelector("button[aria-label='Vote for Yes']");
      act(() => {
        (voteOptionBtn as HTMLButtonElement)?.click();
      });
      expect(statusMessage).toContain("Please connect your Stellar wallet first");
    });
  });
});

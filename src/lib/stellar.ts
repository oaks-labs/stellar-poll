import {
  Horizon,
  Networks,
} from "@stellar/stellar-sdk";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";

export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;

let server: Horizon.Server;

function getServer(): Horizon.Server {
  if (!server) {
    server = new Horizon.Server(HORIZON_URL);
  }
  return server;
}

export function initKit(): void {
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: Networks.TESTNET,
  });
}

export async function connectWallet(): Promise<string> {
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

export async function disconnectWallet(): Promise<void> {
  await StellarWalletsKit.disconnect();
}

export async function getAddress(): Promise<string | null> {
  try {
    const { address } = await StellarWalletsKit.getAddress();
    return address;
  } catch {
    return null;
  }
}

export async function getBalance(
  publicKey: string
): Promise<{
  xlm: string;
  assets: Array<{ code: string; issuer: string; balance: string }>;
}> {
  try {
    const account = await getServer().loadAccount(publicKey);
    const xlmBalance = account.balances.find((b) => b.asset_type === "native");
    const assets = account.balances
      .filter(
        (b) =>
          b.asset_type === "credit_alphanum4" ||
          b.asset_type === "credit_alphanum12"
      )
      .map((b) => ({
        code: (b as { asset_code: string }).asset_code,
        issuer: (b as { asset_issuer: string }).asset_issuer,
        balance: (b as { balance: string }).balance,
      }));
    return { xlm: xlmBalance?.balance ?? "0", assets };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.includes("Not Found")) {
      // Unfunded testnet account
      return { xlm: "0.00 (Unfunded)", assets: [] };
    }
    throw err;
  }
}

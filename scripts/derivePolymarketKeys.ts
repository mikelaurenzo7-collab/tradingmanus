/**
 * Derive Polymarket L2 API credentials (key/secret/passphrase) from your
 * wallet private key.  Polymarket has no UI page that exposes these — they
 * must be derived via a signed request to the CLOB.  You only need to run
 * this once: copy the printed values into the dashboard /connect form.
 *
 * Usage:
 *
 *   PM_PRIVATE_KEY=0xYourKey  PM_FUNDER=0xYourFunderAddress  \
 *     pnpm derive:poly-keys
 *
 *   # or interactively:
 *   pnpm derive:poly-keys
 *
 * Notes:
 *   • PM_PRIVATE_KEY = the EOA private key Polymarket gave you in the
 *     UI's "Export private key" flow.  64 hex chars, with or without 0x.
 *   • PM_FUNDER = the proxy wallet (or EOA) address that holds your USDC
 *     on Polygon.  This is what shows on https://polymarket.com/settings.
 *   • This script does NOT save the credentials anywhere.  It just prints
 *     them for you to paste into the dashboard, which encrypts them
 *     before storing.
 *   • The wallet key never leaves your machine.  This script signs
 *     locally and POSTs only the signature + your public address.
 */

import { ClobClient, Chain, SignatureType } from "@polymarket/clob-client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { createInterface } from "readline";
import { stdin as input, stdout as output } from "process";

const CLOB_HOST = "https://clob.polymarket.com";

async function prompt(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  const rl = createInterface({ input, output });
  if (opts.hidden) {
    // Best-effort password masking — turns off echo while typing.
    const orig = (input as { isRaw?: boolean }).isRaw;
    process.stdout.write(question);
    return new Promise((resolve) => {
      let buf = "";
      const onData = (data: Buffer) => {
        const s = data.toString("utf-8");
        for (const ch of s) {
          if (ch === "\r" || ch === "\n") {
            input.removeListener("data", onData);
            (input as { setRawMode?: (b: boolean) => void }).setRawMode?.(orig ?? false);
            input.pause();
            process.stdout.write("\n");
            rl.close();
            resolve(buf);
            return;
          }
          if (ch === "") {
            process.exit(130);
          }
          if (ch === "") {
            buf = buf.slice(0, -1);
          } else {
            buf += ch;
          }
        }
      };
      (input as { setRawMode?: (b: boolean) => void }).setRawMode?.(true);
      input.resume();
      input.on("data", onData);
    });
  }
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  let privateKey = (process.env.PM_PRIVATE_KEY ?? "").trim();
  let funder = (process.env.PM_FUNDER ?? "").trim();

  if (!privateKey) {
    privateKey = (await prompt("Polymarket wallet private key (hex, 0x-prefix optional): ", { hidden: true })).trim();
  }
  if (!funder) {
    funder = (await prompt("Polymarket funder / wallet address (0x...): ")).trim();
  }

  if (!privateKey || !funder) {
    console.error("Both private key and funder address are required.");
    process.exit(1);
  }

  const normalizedKey = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedKey)) {
    console.error("Private key should be 64 hex characters (with or without 0x prefix).");
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(funder)) {
    console.error("Funder address should be a 0x-prefixed 40-character hex string.");
    process.exit(1);
  }

  const account = privateKeyToAccount(normalizedKey);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  // No L2 creds yet — that's exactly what we're deriving.
  const client = new ClobClient(
    CLOB_HOST,
    Chain.POLYGON,
    walletClient,
    undefined,
    SignatureType.POLY_PROXY,
    funder,
  );

  console.error("\nSigning derive-key request with your wallet…");
  const creds = await client.createOrDeriveApiKey();

  console.error("\n✓ Polymarket L2 credentials derived.  Paste these into the");
  console.error("  dashboard /connect form (Polymarket panel):\n");
  console.log(`API Key:        ${creds.key}`);
  console.log(`API Secret:     ${creds.secret}`);
  console.log(`API Passphrase: ${creds.passphrase}`);
  console.error("\nThe signer EOA address (recovered from your private key):");
  console.log(`Signer address: ${account.address}`);
  console.error("\nNOTHING was saved to disk by this script.  Encrypt-at-rest");
  console.error("happens when you submit the form in the dashboard.");
}

main().catch((err) => {
  console.error("\nFailed to derive Polymarket L2 credentials.");
  if (err instanceof Error) console.error(err.message);
  process.exit(1);
});

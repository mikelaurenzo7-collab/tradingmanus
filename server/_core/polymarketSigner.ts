/**
 * Polymarket EIP-712 order signing.
 *
 * The Polymarket CLOB `/order` endpoint rejects naive `{ token_id, price,
 * size }` bodies — it requires the order to be signed with the user's wallet
 * key against the CTF Exchange contract's EIP-712 typed-data domain on
 * Polygon (chainId 137).  This module wraps Polymarket's official
 * `@polymarket/clob-client` library with our credential-encryption layer so
 * the wallet private key only lives in plaintext for the duration of one
 * order submission.
 *
 * Signature types (from `@polymarket/clob-client`):
 *   • 0 EOA              — direct EOA signature (rare for Polymarket UI users)
 *   • 1 POLY_PROXY       — Polymarket proxy-wallet signature (default — what
 *                          you get when you connect via the Polymarket UI)
 *   • 2 POLY_GNOSIS_SAFE — Gnosis Safe signature (uncommon)
 *
 * Most users land on POLY_PROXY (Magic email login → proxy wallet).  The
 * "private key" the user gets from the Polymarket UI signs ON BEHALF OF the
 * proxy address; `walletAddress` is the proxy address, while the recovered
 * signer is the EOA.  The SDK handles that distinction internally — we just
 * pass the right signatureType + funderAddress.
 */

import {
  ClobClient,
  Chain,
  OrderType,
  Side as ClobSide,
  SignatureType,
} from "@polymarket/clob-client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { logger } from "./logger";

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * Build a configured ClobClient for one user's credentials.  Caller is
 * responsible for ensuring `privateKey` was just decrypted from at-rest
 * storage; we do not persist it anywhere.
 */
export function buildPolymarketClobClient(input: {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  privateKey: string;
  /** Funder/maker address.  For POLY_PROXY this is the proxy wallet
   *  address (NOT the EOA that signs).  Required by the CLOB. */
  walletAddress: string;
  /** Defaults to POLY_PROXY (1) which matches Polymarket UI users. */
  signatureType?: SignatureType;
}): ClobClient {
  const pk = input.privateKey.trim();
  if (!pk) {
    throw new Error("Polymarket private key missing");
  }
  // viem requires the 0x prefix; tolerate user pasting bare hex.
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  const account = privateKeyToAccount(normalized);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const apiCreds: ApiKeyCreds = {
    key: input.apiKey,
    secret: input.apiSecret,
    passphrase: input.apiPassphrase,
  };

  const sigType = input.signatureType ?? SignatureType.POLY_PROXY;
  const funder = input.walletAddress.trim();
  if (!funder) {
    throw new Error("Polymarket wallet (funder) address missing");
  }

  // Note: ClobClient's constructor signature is a stable but non-obvious
  // positional list — see the d.ts. We only set what's needed for order
  // submission; later args (geoBlockToken, builderConfig, …) keep their
  // defaults.
  return new ClobClient(
    CLOB_HOST,
    Chain.POLYGON,
    walletClient,
    apiCreds,
    sigType,
    funder,
  );
}

/**
 * Submit a signed order to the CLOB.  `size` is in TOKEN quantity (not USDC)
 * — the caller has already converted from USDC budget via floor(usdc / price).
 * `price` is the limit price in [0, 1].
 */
export async function submitSignedPolymarketOrder(
  client: ClobClient,
  order: {
    tokenId: string;
    side: "BUY" | "SELL";
    price: number;
    size: number;
  },
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const signed = await client.createOrder({
      tokenID: order.tokenId,
      price: order.price,
      size: order.size,
      side: order.side === "BUY" ? ClobSide.BUY : ClobSide.SELL,
    });
    const resp = await client.postOrder(signed, OrderType.GTC);
    if (resp && (resp.success === false || resp.errorMsg)) {
      return {
        success: false,
        error:
          typeof resp.errorMsg === "string"
            ? resp.errorMsg
            : typeof resp.error === "string"
              ? resp.error
              : "CLOB rejected order",
      };
    }
    const orderId =
      typeof resp?.orderId === "string"
        ? resp.orderId
        : typeof resp?.orderID === "string"
          ? resp.orderID
          : undefined;
    return { success: true, orderId };
  } catch (error) {
    logger.error({ err: error }, "[Polymarket] CLOB order signing/post failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order submission failed",
    };
  }
}

export { SignatureType, ClobSide };

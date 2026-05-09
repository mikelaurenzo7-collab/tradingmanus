-- 0012 — Add EIP-712 order-signing columns to polymarketCredentials.
--
-- Polymarket's CLOB `/order` endpoint rejects unsigned/simplified bodies; it
-- requires an EIP-712-typed-data signature against the CTF Exchange contract
-- on Polygon (chainId 137).  To produce that signature server-side, the bot
-- needs:
--
--   • walletPrivateKeyEncrypted — the EOA private key (encrypted at rest under
--     CREDENTIAL_ENCRYPTION_SECRET, same scheme as kalshiCredentials).  For
--     Polymarket UI users this is the EOA whose signature authorises orders
--     against the proxy wallet that holds funds.
--   • walletAddress — the funder/maker address.  For POLY_PROXY (the default
--     for Polymarket UI users), this is the proxy wallet address (NOT the
--     EOA that signs).  For EOA signature type, equals the EOA address.
--   • signatureType — 0=EOA, 1=POLY_PROXY (default for Polymarket UI users),
--     2=POLY_GNOSIS_SAFE.  Stored as smallint matching the on-chain enum.
--
-- All columns nullable for backward compat: rows that pre-date this migration
-- can still serve read-side reconciliation; live order placement just refuses
-- to fire until the operator fills these fields via the dashboard.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "polymarketCredentials"
  ADD COLUMN IF NOT EXISTS "walletPrivateKeyEncrypted" text;

ALTER TABLE "polymarketCredentials"
  ADD COLUMN IF NOT EXISTS "walletAddress" varchar(42);

ALTER TABLE "polymarketCredentials"
  ADD COLUMN IF NOT EXISTS "signatureType" integer DEFAULT 1;

export const CONNECT_REDIRECT_DELAY_MS = 1200;

type ConnectionSuccessInput = {
  equity?: number | null;
  mode?: string | null;
};

export function buildKalshiConnectionSuccessMessage({ equity, mode }: ConnectionSuccessInput) {
  const normalizedEquity = Number.isFinite(equity) ? Number(equity) : 0;
  const modeLabel = mode ? ` in ${mode} mode` : "";

  return `Connected successfully${modeLabel}. Account equity synced: $${normalizedEquity.toFixed(2)}. Redirecting to the dashboard...`;
}

export function buildPolymarketConnectionSuccessMessage() {
  return "Polymarket connected successfully. Your CLOB credentials are encrypted and saved.";
}

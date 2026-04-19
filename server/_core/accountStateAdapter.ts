/**
 * Account State Adapter
 * Handles real account balance and position sync from brokers
 */

export interface AccountBalance {
  totalValue: number;
  cash: number;
  buyingPower: number;
  equity: number;
  timestamp: Date;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  timestamp: Date;
}

export interface AccountState {
  balance: AccountBalance;
  positions: Position[];
  lastSyncAt: Date;
  isConnected: boolean;
}

/**
 * Alpaca broker adapter
 */
export async function fetchAlpacaAccountState(apiKey: string, baseUrl: string): Promise<AccountState | null> {
  if (!apiKey) return null;

  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // Fetch account info
    const accountRes = await fetch(`${baseUrl}/v2/account`, { headers });
    if (!accountRes.ok) return null;

    const account = await accountRes.json();

    // Fetch positions
    const positionsRes = await fetch(`${baseUrl}/v2/positions`, { headers });
    if (!positionsRes.ok) return null;

    const positionsData = await positionsRes.json();

    const balance: AccountBalance = {
      totalValue: parseFloat(account.portfolio_value),
      cash: parseFloat(account.cash),
      buyingPower: parseFloat(account.buying_power),
      equity: parseFloat(account.equity),
      timestamp: new Date(),
    };

    const positions: Position[] = (positionsData || []).map((pos: any) => ({
      symbol: pos.symbol,
      quantity: parseFloat(pos.qty),
      avgCost: parseFloat(pos.avg_fill_price),
      currentPrice: parseFloat(pos.current_price),
      unrealizedPnL: parseFloat(pos.unrealized_pl),
      unrealizedPnLPct: parseFloat(pos.unrealized_plpc),
      timestamp: new Date(),
    }));

    return {
      balance,
      positions,
      lastSyncAt: new Date(),
      isConnected: true,
    };
  } catch (error) {
    console.error("[AccountStateAdapter] Alpaca sync error:", error);
    return null;
  }
}

/**
 * Interactive Brokers adapter (placeholder)
 */
export async function fetchIBAccountState(accountId: string, apiUrl: string): Promise<AccountState | null> {
  if (!accountId || !apiUrl) return null;

  try {
    // IB API would require specific authentication
    // This is a placeholder for the adapter structure
    console.log("[AccountStateAdapter] IB adapter requires OAuth setup");
    return null;
  } catch (error) {
    console.error("[AccountStateAdapter] IB sync error:", error);
    return null;
  }
}

/**
 * Kraken adapter for crypto accounts
 */
export async function fetchKrakenAccountState(apiKey: string, apiSecret: string): Promise<AccountState | null> {
  if (!apiKey || !apiSecret) return null;

  try {
    // Kraken requires HMAC-SHA512 signing
    // This is a placeholder for the adapter structure
    console.log("[AccountStateAdapter] Kraken adapter requires signature setup");
    return null;
  } catch (error) {
    console.error("[AccountStateAdapter] Kraken sync error:", error);
    return null;
  }
}

/**
 * Fetch account state with fallback strategy
 */
export async function fetchAccountStateWithFallback(
  connectorConfig: {
    type: "alpaca" | "ib" | "kraken";
    apiKey?: string;
    apiSecret?: string;
    baseUrl?: string;
    accountId?: string;
  }
): Promise<AccountState | null> {
  switch (connectorConfig.type) {
    case "alpaca":
      return fetchAlpacaAccountState(connectorConfig.apiKey || "", connectorConfig.baseUrl || "https://api.alpaca.markets");

    case "ib":
      return fetchIBAccountState(connectorConfig.accountId || "", connectorConfig.baseUrl || "");

    case "kraken":
      return fetchKrakenAccountState(connectorConfig.apiKey || "", connectorConfig.apiSecret || "");

    default:
      return null;
  }
}

/**
 * Calculate account metrics
 */
export function calculateAccountMetrics(state: AccountState) {
  const totalPositionValue = state.positions.reduce((sum, pos) => sum + pos.quantity * pos.currentPrice, 0);
  const totalUnrealizedPnL = state.positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
  const totalUnrealizedPnLPct = state.balance.equity > 0 ? (totalUnrealizedPnL / state.balance.equity) * 100 : 0;

  return {
    totalPositionValue,
    totalUnrealizedPnL,
    totalUnrealizedPnLPct,
    cashUtilization: (totalPositionValue / state.balance.totalValue) * 100,
    availableCash: state.balance.cash,
    leverage: state.balance.totalValue / state.balance.equity,
  };
}

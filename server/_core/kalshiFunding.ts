/**
 * Kalshi Account Funding Status Detection
 * Determines if account is ready to trade based on equity
 */

export interface FundingStatus {
  isFunded: boolean;
  equity: number;
  status: "no_account" | "zero_equity" | "low_equity" | "ready_to_trade";
  message: string;
  fundingUrl?: string;
}

export interface TradingReadiness {
  canTrade: boolean;
  issues: string[];
  warnings: string[];
  readinessScore: number; // 0-100
}

/**
 * Determine funding status based on account equity
 */
export function determineFundingStatus(equity: number | null | undefined): FundingStatus {
  if (equity === null || equity === undefined) {
    return {
      isFunded: false,
      equity: 0,
      status: "no_account",
      message: "Kalshi account not connected. Please connect your account to begin.",
      fundingUrl: "https://kalshi.com/account/deposit",
    };
  }

  if (equity === 0) {
    return {
      isFunded: false,
      equity: 0,
      status: "zero_equity",
      message: "Your Kalshi account has $0 balance. Deposit funds to start trading.",
      fundingUrl: "https://kalshi.com/account/deposit",
    };
  }

  if (equity > 0 && equity < 1) {
    return {
      isFunded: false,
      equity,
      status: "low_equity",
      message: `Your account has $${equity.toFixed(2)}. Minimum recommended is $1 to start trading.`,
      fundingUrl: "https://kalshi.com/account/deposit",
    };
  }

  return {
    isFunded: true,
    equity,
    status: "ready_to_trade",
    message: `Account funded with $${equity.toFixed(2)}. Ready to trade!`,
  };
}

/**
 * Check if user is ready to start trading
 * Validates: funding, instructions defined, risk limits understood
 */
export function checkTradingReadiness(payload: {
  equity: number;
  hasInstructions: boolean;
  hasAcknowledgedRisks: boolean;
  hasConnectedAccount: boolean;
}): TradingReadiness {
  const issues: string[] = [];
  const warnings: string[] = [];
  let readinessScore = 100;

  // Critical issues that block trading
  if (!payload.hasConnectedAccount) {
    issues.push("Kalshi account not connected");
    readinessScore -= 50;
  }

  if (payload.equity <= 0) {
    issues.push("Account has no funds. Deposit at least $1 to trade.");
    readinessScore -= 50;
  }

  if (payload.equity < 1 && payload.equity > 0) {
    issues.push(`Account has $${payload.equity.toFixed(2)}. Recommended minimum: $1.`);
    readinessScore -= 25;
  }

  if (!payload.hasAcknowledgedRisks) {
    issues.push("Must acknowledge risk disclaimer before trading");
    readinessScore -= 30;
  }

  // Warnings (non-blocking)
  if (!payload.hasInstructions) {
    warnings.push("No training instructions defined. Consider setting rules for your agent.");
    readinessScore -= 10;
  }

  return {
    canTrade: issues.length === 0,
    issues,
    warnings,
    readinessScore: Math.max(0, readinessScore),
  };
}

/**
 * Get funding guidance based on status
 */
export function getFundingGuidance(status: FundingStatus): string {
  switch (status.status) {
    case "no_account":
      return `
        Your Kalshi account is not connected yet.
        
        Steps to connect:
        1. Go to Settings → Connect Kalshi
        2. Enter your Kalshi API key and private key
        3. We'll verify your account and fetch your balance
        4. Once connected, you can start trading
        
        Don't have a Kalshi account? Create one at kalshi.com
      `;

    case "zero_equity":
      return `
        Your Kalshi account has $0 balance.
        
        To start trading:
        1. Visit kalshi.com/account/deposit
        2. Add funds using your preferred payment method
        3. Your balance will update automatically
        4. Once funded, you can start trading
        
        Recommended starting amount: $10-$100
        LAURENZO OMEGA works best with at least $1 in your account.
      `;

    case "low_equity":
      return `
        Your account balance is very low ($${status.equity.toFixed(2)}).
        
        While you can trade, we recommend:
        1. Depositing more funds for better risk management
        2. Starting with very small position sizes
        3. Testing your trading instructions first
        
        Recommended minimum: $1-$10 to start
      `;

    case "ready_to_trade":
      return `
        Your account is funded and ready to trade!
        
        Next steps:
        1. Review your trading instructions in the Training tab
        2. Understand the risk controls ($100 capital limit, $5 max loss per trade)
        3. Click "Start Trading" to begin
        4. Monitor your positions and P&L in real-time
      `;

    default:
      return "Unknown funding status";
  }
}

/**
 * Format equity display with color coding
 */
export function getEquityDisplay(equity: number): {
  display: string;
  color: "green" | "yellow" | "red";
  icon: "check" | "warning" | "alert";
} {
  if (equity === 0) {
    return {
      display: "$0.00 - No funds",
      color: "red",
      icon: "alert",
    };
  }

  if (equity < 1) {
    return {
      display: `$${equity.toFixed(2)} - Low balance`,
      color: "yellow",
      icon: "warning",
    };
  }

  if (equity < 10) {
    return {
      display: `$${equity.toFixed(2)} - Ready to trade`,
      color: "yellow",
      icon: "warning",
    };
  }

  return {
    display: `$${equity.toFixed(2)} - Well funded`,
    color: "green",
    icon: "check",
  };
}

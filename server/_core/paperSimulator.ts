export interface PaperFillInput {
  side: "yes" | "no";
  action: "buy" | "sell";
  askPrice: number;
  bidPrice: number;
  quantity: number;
  fallbackMidPrice?: number;
  limitPrice?: number;
}

export interface PaperFillResult {
  fillPrice: number;
  fillQuantity: number;
  executionMode: "paper";
  filledAt: Date;
}

export function simulatePaperFill(input: PaperFillInput): PaperFillResult {
  const { action, askPrice, bidPrice, quantity, fallbackMidPrice, limitPrice } = input;

  let fillPrice: number;
  if (action === "buy" && askPrice > 0) {
    fillPrice = askPrice;
  } else if (action === "sell" && bidPrice > 0) {
    fillPrice = bidPrice;
  } else if (fallbackMidPrice && fallbackMidPrice > 0) {
    fillPrice = fallbackMidPrice;
  } else {
    fillPrice = limitPrice ?? 0.5;
  }

  return {
    fillPrice: Math.max(0.01, Math.min(0.99, fillPrice)),
    fillQuantity: quantity,
    executionMode: "paper",
    filledAt: new Date(),
  };
}

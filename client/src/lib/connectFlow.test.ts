import { describe, expect, it } from "vitest";
import { buildKalshiConnectionSuccessMessage, CONNECT_REDIRECT_DELAY_MS } from "./connectFlow";

describe("connectFlow", () => {
  it("formats the success message with mode and live equity", () => {
    expect(
      buildKalshiConnectionSuccessMessage({
        equity: 123.456,
        mode: "production",
      })
    ).toBe(
      "Connected successfully in production mode. Account equity synced: $123.46. Redirecting to the dashboard..."
    );
  });

  it("falls back to zero equity when Kalshi does not return a numeric amount", () => {
    expect(buildKalshiConnectionSuccessMessage({ equity: Number.NaN, mode: null })).toBe(
      "Connected successfully. Account equity synced: $0.00. Redirecting to the dashboard..."
    );
  });

  it("uses a short redirect delay suitable for immediate first-test workflow updates", () => {
    expect(CONNECT_REDIRECT_DELAY_MS).toBe(1200);
  });
});

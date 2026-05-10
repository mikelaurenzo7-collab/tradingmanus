import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOpenRouterClient: vi.fn(),
}));

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.OPENROUTER_EXECUTIONER_MODEL = "qwen-executioner-test";
});

vi.mock("./_core/openRouterClient", () => ({
  createOpenRouterClient: mocks.createOpenRouterClient,
}));

import { buildExecutionPayloadWithExecutioner } from "./_core/openRouterKalshiTeam";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createOpenRouterClient.mockReturnValue({ chat: mocks.chat });
});

describe("buildExecutionPayloadWithExecutioner", () => {
  it("keeps the deterministic quantity and price even when the executioner mutates them", async () => {
    mocks.chat.mockResolvedValue({
      content: JSON.stringify({
        ticker: "KX-TEST",
        action: "buy",
        side: "yes",
        count: 99,
        type: "limit",
        time_in_force: "good_till_cancelled",
        yes_price: 99,
      }),
      model: "qwen-executioner-test",
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });

    const payload = await buildExecutionPayloadWithExecutioner({
      ticker: "KX-TEST",
      side: "yes",
      count: 7,
      limitPrice: 0.41,
    });

    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({
      model: "qwen-executioner-test",
    }));
    expect(payload).toEqual({
      ticker: "KX-TEST",
      action: "buy",
      side: "yes",
      count: 7,
      type: "limit",
      time_in_force: "good_till_cancelled",
      yes_price: 41,
    });
  });

  it("falls back to the deterministic payload when the executioner request fails", async () => {
    mocks.chat.mockRejectedValue(new Error("executioner unavailable"));

    const payload = await buildExecutionPayloadWithExecutioner({
      ticker: "KX-FAIL",
      side: "no",
      count: 3,
      limitPrice: 0.62,
    });

    expect(payload).toEqual({
      ticker: "KX-FAIL",
      action: "buy",
      side: "no",
      count: 3,
      type: "limit",
      time_in_force: "good_till_cancelled",
      no_price: 62,
    });
  });
});
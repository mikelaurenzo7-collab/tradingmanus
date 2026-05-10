import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOpenRouterClient: vi.fn(),
}));

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "sk-global";
});

vi.mock("./_core/openRouterClient", () => ({
  createOpenRouterClient: mocks.createOpenRouterClient,
}));

import { createAnthropicClient } from "./_core/anthropicClient";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createOpenRouterClient.mockReturnValue({ chat: mocks.chat });
  mocks.chat.mockResolvedValue({
    content: "shim output",
    model: "anthropic/claude-sonnet-test",
    inputTokens: 5,
    outputTokens: 3,
    totalTokens: 8,
  });
});

describe("createAnthropicClient", () => {
  it("honors the caller-supplied api key", async () => {
    const client = createAnthropicClient("sk-injected");

    await client.messages.create({
      model: "anthropic/claude-sonnet-test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(mocks.createOpenRouterClient).toHaveBeenCalledWith({
      apiKey: "sk-injected",
    });
  });
});
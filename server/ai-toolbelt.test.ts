import { describe, expect, it, vi } from "vitest";
import {
  buildCachedSystemPrompt,
  buildExtendedThinking,
  buildMemorySystemBlock,
  buildToolList,
  buildWebSearchTool,
  extractAnthropicText,
  extractCitations,
  formatCitationsForReasoning,
  getCacheHitRatio,
  isHighStakes,
  newReviewerTelemetry,
  recordAnthropicResponseTelemetry,
  runHaikuTriage,
  selectAnthropicModel,
} from "./_core/aiToolbelt";

describe("aiToolbelt", () => {
  describe("isHighStakes", () => {
    it("treats high-confidence signals as high stakes", () => {
      expect(isHighStakes({ confidence: 0.95 })).toBe(true);
      expect(isHighStakes({ confidence: 0.5 })).toBe(false);
    });

    it("treats large notional as high stakes", () => {
      expect(isHighStakes({ orderNotional: 100 })).toBe(true);
      expect(isHighStakes({ orderNotional: 5 })).toBe(false);
    });

    it("treats imminent resolution as high stakes", () => {
      expect(isHighStakes({ hoursToResolution: 6 })).toBe(true);
      expect(isHighStakes({ hoursToResolution: 720 })).toBe(false);
    });

    it("respects an explicit highStakes flag", () => {
      expect(isHighStakes({ highStakes: true })).toBe(true);
      expect(isHighStakes({})).toBe(false);
    });
  });

  describe("selectAnthropicModel", () => {
    it("falls back to a sensible default when no override is provided", () => {
      expect(selectAnthropicModel("review")).toMatch(/claude/);
      expect(selectAnthropicModel("triage")).toMatch(/claude/);
      expect(selectAnthropicModel("deep")).toMatch(/claude/);
    });

    it("honors an explicit override", () => {
      expect(selectAnthropicModel("review", "claude-test-9")).toBe("claude-test-9");
    });
  });

  describe("buildWebSearchTool", () => {
    it("returns the web_search tool definition with bounded uses", () => {
      const tool = buildWebSearchTool(2);
      expect(tool.type).toBe("web_search_20250305");
      expect(tool.name).toBe("web_search");
      expect(tool.max_uses).toBe(2);
    });

    it("clamps absurd input ranges", () => {
      expect(buildWebSearchTool(0).max_uses).toBe(1);
      expect(buildWebSearchTool(99).max_uses).toBe(8);
    });
  });

  describe("buildCachedSystemPrompt", () => {
    it("produces a single cached block when only the static mandate is provided", () => {
      const blocks = buildCachedSystemPrompt("Static mandate body");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
      expect(blocks[0].text).toBe("Static mandate body");
    });

    it("appends a non-cached dynamic preamble after the cached block", () => {
      const blocks = buildCachedSystemPrompt("Static", "Dynamic");
      expect(blocks).toHaveLength(2);
      expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
      expect(blocks[1].cache_control).toBeUndefined();
      expect(blocks[1].text).toBe("Dynamic");
    });
  });

  describe("buildExtendedThinking", () => {
    it("returns undefined for low-stakes calls", () => {
      expect(buildExtendedThinking({ confidence: 0.3 })).toBeUndefined();
    });
  });

  describe("buildToolList", () => {
    it("returns undefined when no tools requested and web search disabled", () => {
      // Default test env doesn't override ENABLE_AI_WEB_SEARCH; we pass allowWebSearch=false.
      expect(buildToolList([], { allowWebSearch: false })).toBeUndefined();
    });

    it("includes caller-supplied tools when present", () => {
      const tools = buildToolList([{ name: "custom_tool", type: "function" } as any], {
        allowWebSearch: false,
      });
      expect(tools).toBeDefined();
      expect(tools).toHaveLength(1);
    });
  });

  describe("extractAnthropicText", () => {
    it("concatenates text blocks and ignores tool_use blocks", () => {
      const text = extractAnthropicText({
        content: [
          { type: "text", text: "Part one." },
          { type: "tool_use", text: "ignored" },
          { type: "text", text: "Part two." },
        ],
      });
      expect(text).toBe("Part one.\nPart two.");
    });

    it("handles missing text fields gracefully", () => {
      expect(extractAnthropicText({ content: [{ type: "text" }] })).toBe("");
    });
  });

  describe("buildMemorySystemBlock", () => {
    it("returns null for empty memory", () => {
      expect(buildMemorySystemBlock(null)).toBeNull();
      expect(buildMemorySystemBlock("")).toBeNull();
    });

    it("returns a cached system block for non-empty memory", () => {
      const block = buildMemorySystemBlock("Recent learnings: stay away from XYZ");
      expect(block).not.toBeNull();
      expect(block!.type).toBe("text");
      expect(block!.cache_control).toEqual({ type: "ephemeral" });
      expect(block!.text).toContain("Recent learnings");
    });
  });

  describe("extractCitations", () => {
    it("dedupes and caps web_search_tool_result citations", () => {
      const citations = extractCitations({
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { url: "https://espn.com/article", title: "ESPN article" },
              { url: "https://espn.com/article", title: "Duplicate" },
              { url: "https://nyt.com/story", title: "NYT" },
            ],
          },
        ],
      });
      expect(citations).toHaveLength(2);
      expect(citations[0].url).toBe("https://espn.com/article");
      expect(citations[1].url).toBe("https://nyt.com/story");
    });

    it("pulls citations from inline text-block citations array", () => {
      const citations = extractCitations({
        content: [
          {
            type: "text",
            text: "Some reasoning",
            citations: [{ url: "https://reuters.com/x", title: "Reuters" }],
          },
        ],
      });
      expect(citations).toHaveLength(1);
      expect(citations[0].url).toBe("https://reuters.com/x");
    });

    it("returns empty array when there are no citation blocks", () => {
      expect(extractCitations({ content: [{ type: "text", text: "hi" }] })).toEqual([]);
    });
  });

  describe("formatCitationsForReasoning", () => {
    it("returns empty string when no citations", () => {
      expect(formatCitationsForReasoning([])).toBe("");
    });

    it("renders unique hostnames as a short [cites: ...] tag", () => {
      const formatted = formatCitationsForReasoning([
        { url: "https://www.espn.com/x", title: "x" },
        { url: "https://espn.com/y", title: "y" },
        { url: "https://nyt.com/z", title: "z" },
      ]);
      expect(formatted).toBe(" [cites: espn.com, nyt.com]");
    });
  });

  describe("runHaikuTriage", () => {
    it("returns the keep-set parsed from the model response", async () => {
      const create = vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: '{"keep":["MKT-1","MKT-3"]}',
          },
        ],
      });

      const keep = await runHaikuTriage(
        { messages: { create } },
        [
          { marketId: "MKT-1", title: "", category: "", signalType: "momentum", side: "yes", confidence: 0.7, expectedValue: 0.1, impliedProbability: 0.4 },
          { marketId: "MKT-2", title: "", category: "", signalType: "momentum", side: "yes", confidence: 0.5, expectedValue: 0.05, impliedProbability: 0.5 },
          { marketId: "MKT-3", title: "", category: "", signalType: "momentum", side: "no", confidence: 0.8, expectedValue: 0.12, impliedProbability: 0.6 },
        ],
        { timeoutMs: 100 },
      );

      expect(keep).not.toBeNull();
      expect(keep!.has("MKT-1")).toBe(true);
      expect(keep!.has("MKT-2")).toBe(false);
      expect(keep!.has("MKT-3")).toBe(true);
    });

    it("returns null when the model errors so callers fall through to full review", async () => {
      const create = vi.fn().mockRejectedValue(new Error("503"));
      const keep = await runHaikuTriage({ messages: { create } }, [
        { marketId: "MKT-1", title: "", category: "", signalType: "momentum", side: "yes", confidence: 0.7, expectedValue: 0.1, impliedProbability: 0.4 },
      ], { timeoutMs: 100 });
      expect(keep).toBeNull();
    });

    it("returns empty set for empty input", async () => {
      const create = vi.fn();
      const keep = await runHaikuTriage({ messages: { create } }, [], { timeoutMs: 100 });
      expect(keep?.size).toBe(0);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("ReviewerTelemetry", () => {
    it("starts zeroed", () => {
      const t = newReviewerTelemetry();
      expect(t.cacheReadInputTokens).toBe(0);
      expect(t.cacheCreationInputTokens).toBe(0);
      expect(t.webSearchInvocations).toBe(0);
      expect(getCacheHitRatio(t)).toBe(0);
    });

    it("accumulates cache + token usage from Anthropic responses", () => {
      const t = newReviewerTelemetry();
      recordAnthropicResponseTelemetry(t, {
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_creation_input_tokens: 800,
          cache_read_input_tokens: 0,
        },
      });
      recordAnthropicResponseTelemetry(t, {
        usage: {
          input_tokens: 1100,
          output_tokens: 250,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 800,
        },
      });
      expect(t.anthropicCalls).toBe(2);
      expect(t.cacheReadInputTokens).toBe(800);
      expect(t.cacheCreationInputTokens).toBe(800);
      expect(t.inputTokens).toBe(2100);
      expect(t.outputTokens).toBe(450);
      expect(getCacheHitRatio(t)).toBe(0.5);
    });

    it("counts web_search_tool_result blocks per response", () => {
      const t = newReviewerTelemetry();
      recordAnthropicResponseTelemetry(t, {
        content: [
          { type: "web_search_tool_result" },
          { type: "text", text: "ok" },
          { type: "web_search_tool_result" },
        ],
      });
      expect(t.webSearchInvocations).toBe(2);
    });

    it("flags extended thinking when the caller indicates it was used", () => {
      const t = newReviewerTelemetry();
      recordAnthropicResponseTelemetry(t, {}, { extendedThinkingUsed: true });
      recordAnthropicResponseTelemetry(t, {});
      expect(t.extendedThinkingInvocations).toBe(1);
      expect(t.anthropicCalls).toBe(2);
    });
  });
});

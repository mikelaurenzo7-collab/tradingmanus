import { describe, expect, it } from "vitest";
import {
  buildCachedSystemPrompt,
  buildExtendedThinking,
  buildToolList,
  buildWebSearchTool,
  extractAnthropicText,
  isHighStakes,
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
});

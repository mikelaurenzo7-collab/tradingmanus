/**
 * Training Instruction Suggestions Test Suite
 * 
 * Tests the instruction suggestion engine feature:
 * - High performer suggestions
 * - Low performer suggestions
 * - Common failure rule suggestions
 * - No suggestions on insufficient data
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getInstructionSuggestionsFromAudit } from "./db.training";
import * as db from "./db";

// Mock logger
vi.mock("./_core/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock database
vi.mock("./db", () => ({
  getDb: vi.fn(),
  getAuditLog: vi.fn(),
}));

describe("Training Instruction Suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getInstructionSuggestionsFromAudit", () => {
    it("should generate high_performer suggestion when passRate >= 0.7 and evaluatedSignals >= 10", async () => {
      // Create audit events that will result in a high performer
      const mockAuditEvents = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        eventType: "instruction_matches_evaluated",
        details: JSON.stringify({
          signals: [
            {
              marketId: `MARKET-${i * 3 + 1}`,
              signalType: "value_play",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 1,
                  instructionTitle: "High Performer Instruction",
                  passed: true,
                },
              ],
            },
            {
              marketId: `MARKET-${i * 3 + 2}`,
              signalType: "momentum",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 1,
                  instructionTitle: "High Performer Instruction",
                  passed: true,
                },
              ],
            },
            {
              marketId: `MARKET-${i * 3 + 3}`,
              signalType: "contrarian",
              filterOutcome: "rejected",
              instructionMatches: [
                {
                  instructionId: 1,
                  instructionTitle: "High Performer Instruction",
                  passed: false,
                  failedRules: [
                    {
                      ruleId: 1,
                      ruleKey: "min_confidence",
                      ruleType: "require",
                      reason: "Confidence too low",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        createdAt: new Date("2026-05-06T10:00:00Z"),
        triggeredByOpenId: "user:123",
      }));

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents);

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toMatchObject({
        instructionId: 1,
        instructionTitle: "High Performer Instruction",
        suggestionType: "high_performer",
      });
      expect(result.suggestions[0].message).toContain("passes");
      expect(result.suggestions[0].message).toContain("consider expanding this pattern");
      expect(result.suggestions[0].confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.suggestions[0].confidence).toBeLessThanOrEqual(1.0);
      expect(result.suggestions[0].supportingStats.evaluatedSignals).toBe(15);
      expect(result.suggestions[0].supportingStats.passRate).toBeGreaterThanOrEqual(0.7);
    });

    it("should generate low_performer suggestion when passRate <= 0.35 and evaluatedSignals >= 10", async () => {
      // Create audit events that will result in a low performer
      const mockAuditEvents = Array.from({ length: 4 }, (_, i) => ({
        id: i + 1,
        eventType: "instruction_matches_evaluated",
        details: JSON.stringify({
          signals: [
            {
              marketId: `MARKET-${i * 3 + 1}`,
              signalType: "value_play",
              filterOutcome: "rejected",
              instructionMatches: [
                {
                  instructionId: 2,
                  instructionTitle: "Low Performer Instruction",
                  passed: false,
                  failedRules: [
                    {
                      ruleId: 2,
                      ruleKey: "forbidden_category",
                      ruleType: "forbid",
                      reason: "Category is forbidden",
                    },
                  ],
                },
              ],
            },
            {
              marketId: `MARKET-${i * 3 + 2}`,
              signalType: "momentum",
              filterOutcome: "rejected",
              instructionMatches: [
                {
                  instructionId: 2,
                  instructionTitle: "Low Performer Instruction",
                  passed: false,
                  failedRules: [
                    {
                      ruleId: 2,
                      ruleKey: "forbidden_category",
                      ruleType: "forbid",
                      reason: "Category is forbidden",
                    },
                  ],
                },
              ],
            },
            {
              marketId: `MARKET-${i * 3 + 3}`,
              signalType: "contrarian",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 2,
                  instructionTitle: "Low Performer Instruction",
                  passed: true,
                },
              ],
            },
          ],
        }),
        createdAt: new Date("2026-05-06T10:00:00Z"),
        triggeredByOpenId: "user:123",
      }));

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents);

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      const lowPerformerSuggestion = result.suggestions.find(
        (s) => s.suggestionType === "low_performer"
      );

      expect(lowPerformerSuggestion).toBeDefined();
      expect(lowPerformerSuggestion).toMatchObject({
        instructionId: 2,
        instructionTitle: "Low Performer Instruction",
        suggestionType: "low_performer",
      });
      expect(lowPerformerSuggestion!.message).toContain("passes only");
      expect(lowPerformerSuggestion!.message).toContain("consider relaxing or revising rules");
      expect(lowPerformerSuggestion!.confidence).toBeGreaterThanOrEqual(0.5);
      expect(lowPerformerSuggestion!.confidence).toBeLessThanOrEqual(1.0);
      expect(lowPerformerSuggestion!.supportingStats.evaluatedSignals).toBe(12);
      expect(lowPerformerSuggestion!.supportingStats.passRate).toBeLessThanOrEqual(0.35);
    });

    it("should generate common_failure_rule suggestion when a rule fails >= 5 times", async () => {
      // Create audit events where a specific rule fails frequently
      const mockAuditEvents = Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        eventType: "instruction_matches_evaluated",
        details: JSON.stringify({
          signals: [
            {
              marketId: `MARKET-${i * 2 + 1}`,
              signalType: "value_play",
              filterOutcome: "rejected",
              instructionMatches: [
                {
                  instructionId: 3,
                  instructionTitle: "Volume Gating Instruction",
                  passed: false,
                  failedRules: [
                    {
                      ruleId: 5,
                      ruleKey: "min_volume",
                      ruleType: "require",
                      reason: "Volume below threshold",
                    },
                  ],
                },
              ],
            },
            {
              marketId: `MARKET-${i * 2 + 2}`,
              signalType: "momentum",
              filterOutcome: "rejected",
              instructionMatches: [
                {
                  instructionId: 3,
                  instructionTitle: "Volume Gating Instruction",
                  passed: false,
                  failedRules: [
                    {
                      ruleId: 5,
                      ruleKey: "min_volume",
                      ruleType: "require",
                      reason: "Volume below threshold",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        createdAt: new Date("2026-05-06T10:00:00Z"),
        triggeredByOpenId: "user:123",
      }));

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents);

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      const failureRuleSuggestion = result.suggestions.find(
        (s) => s.suggestionType === "common_failure_rule"
      );

      expect(failureRuleSuggestion).toBeDefined();
      expect(failureRuleSuggestion).toMatchObject({
        instructionId: 3,
        instructionTitle: "Volume Gating Instruction",
        suggestionType: "common_failure_rule",
      });
      expect(failureRuleSuggestion!.message).toContain("min_volume");
      expect(failureRuleSuggestion!.message).toContain("frequently rejects signals");
      expect(failureRuleSuggestion!.message).toContain("consider tuning threshold");
      expect(failureRuleSuggestion!.confidence).toBeGreaterThanOrEqual(0.5);
      expect(failureRuleSuggestion!.confidence).toBeLessThanOrEqual(1.0);
      expect(failureRuleSuggestion!.supportingStats.ruleKey).toBe("min_volume");
      expect(failureRuleSuggestion!.supportingStats.failureCount).toBeGreaterThanOrEqual(5);
    });

    it("should not generate suggestions on insufficient data", async () => {
      // Create only 5 audit events (below 10 threshold for high/low performers)
      const mockAuditEvents = Array.from({ length: 2 }, (_, i) => ({
        id: i + 1,
        eventType: "instruction_matches_evaluated",
        details: JSON.stringify({
          signals: [
            {
              marketId: `MARKET-${i * 2 + 1}`,
              signalType: "value_play",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 4,
                  instructionTitle: "Insufficient Data Instruction",
                  passed: true,
                },
              ],
            },
            {
              marketId: `MARKET-${i * 2 + 2}`,
              signalType: "momentum",
              filterOutcome: "rejected",
              instructionMatches: [
                {
                  instructionId: 4,
                  instructionTitle: "Insufficient Data Instruction",
                  passed: false,
                  failedRules: [
                    {
                      ruleId: 10,
                      ruleKey: "rare_rule",
                      ruleType: "require",
                      reason: "Rarely fails",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        createdAt: new Date("2026-05-06T10:00:00Z"),
        triggeredByOpenId: "user:123",
      }));

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents);

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      // Should have no suggestions because:
      // - Only 4 signals evaluated (< 10 threshold)
      // - rare_rule failed only 2 times (< 5 threshold)
      expect(result.suggestions).toHaveLength(0);
      expect(result.lookbackDays).toBe(30);
      expect(result.generatedAt).toBeDefined();
    });

    it("should handle multiple suggestion types simultaneously", async () => {
      // Create events with high performer, low performer, and common failure rule
      const mockAuditEvents = [
        // High performer events (instruction 1)
        ...Array.from({ length: 3 }, (_, i) => ({
          id: i + 1,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: Array.from({ length: 4 }, (_, j) => ({
              marketId: `HP-MARKET-${i * 4 + j}`,
              signalType: "value_play",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 1,
                  instructionTitle: "Excellent Instruction",
                  passed: true,
                },
              ],
            })),
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        })),
        // Low performer events (instruction 2)
        ...Array.from({ length: 3 }, (_, i) => ({
          id: i + 10,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: Array.from({ length: 4 }, (_, j) => ({
              marketId: `LP-MARKET-${i * 4 + j}`,
              signalType: "momentum",
              filterOutcome: "rejected",
              instructionMatches: [
                {
                  instructionId: 2,
                  instructionTitle: "Poor Instruction",
                  passed: false,
                  failedRules: [
                    {
                      ruleId: 20,
                      ruleKey: "strict_threshold",
                      ruleType: "require",
                      reason: "Threshold too strict",
                    },
                  ],
                },
              ],
            })),
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        })),
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents);

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      expect(result.suggestions.length).toBeGreaterThanOrEqual(3);

      const highPerformerSuggestion = result.suggestions.find(
        (s) => s.suggestionType === "high_performer"
      );
      const lowPerformerSuggestion = result.suggestions.find(
        (s) => s.suggestionType === "low_performer"
      );
      const failureRuleSuggestion = result.suggestions.find(
        (s) => s.suggestionType === "common_failure_rule"
      );

      expect(highPerformerSuggestion).toBeDefined();
      expect(lowPerformerSuggestion).toBeDefined();
      expect(failureRuleSuggestion).toBeDefined();
    });

    it("should return empty suggestions on error with proper structure", async () => {
      vi.mocked(db.getAuditLog).mockRejectedValue(new Error("Database error"));

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      expect(result).toMatchObject({
        generatedAt: expect.any(String),
        lookbackDays: 30,
        suggestions: [],
      });
    });

    it("should sort suggestions by confidence descending", async () => {
      // Create events that will generate suggestions with different confidence levels
      const mockAuditEvents = [
        // Very high performer (many samples, high pass rate) - should have highest confidence
        ...Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: Array.from({ length: 5 }, (_, j) => ({
              marketId: `HP1-MARKET-${i * 5 + j}`,
              signalType: "value_play",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 1,
                  instructionTitle: "Very High Performer",
                  passed: true,
                },
              ],
            })),
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        })),
        // Moderate high performer (fewer samples) - should have lower confidence
        ...Array.from({ length: 3 }, (_, i) => ({
          id: i + 100,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: Array.from({ length: 4 }, (_, j) => ({
              marketId: `HP2-MARKET-${i * 4 + j}`,
              signalType: "momentum",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 2,
                  instructionTitle: "Moderate High Performer",
                  passed: true,
                },
              ],
            })),
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        })),
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents);

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      expect(result.suggestions.length).toBeGreaterThanOrEqual(2);

      // Verify confidence is in descending order
      for (let i = 1; i < result.suggestions.length; i++) {
        expect(result.suggestions[i - 1].confidence).toBeGreaterThanOrEqual(
          result.suggestions[i].confidence
        );
      }

      // Very high performer with more samples should be first
      expect(result.suggestions[0].instructionTitle).toBe("Very High Performer");
    });

    it("should calculate confidence bounded between 0 and 1", async () => {
      // Create events that would generate suggestions with various confidence levels
      const mockAuditEvents = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        eventType: "instruction_matches_evaluated",
        details: JSON.stringify({
          signals: [
            {
              marketId: `MARKET-${i * 2 + 1}`,
              signalType: "value_play",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 5,
                  instructionTitle: "Test Instruction",
                  passed: true,
                },
              ],
            },
            {
              marketId: `MARKET-${i * 2 + 2}`,
              signalType: "momentum",
              filterOutcome: "passed",
              instructionMatches: [
                {
                  instructionId: 5,
                  instructionTitle: "Test Instruction",
                  passed: true,
                },
              ],
            },
          ],
        }),
        createdAt: new Date("2026-05-06T10:00:00Z"),
        triggeredByOpenId: "user:123",
      }));

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents);

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      // All suggestions should have confidence between 0 and 1
      for (const suggestion of result.suggestions) {
        expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
        expect(suggestion.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("should handle no audit events gracefully", async () => {
      vi.mocked(db.getAuditLog).mockResolvedValue([]);

      const result = await getInstructionSuggestionsFromAudit("user:123", 30);

      expect(result).toMatchObject({
        generatedAt: expect.any(String),
        lookbackDays: 30,
        suggestions: [],
      });
    });
  });
});

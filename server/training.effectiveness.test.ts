/**
 * Training Instruction Effectiveness Analytics Test Suite
 * 
 * Tests the instruction effectiveness analytics feature:
 * - Aggregation across multiple audit events
 * - Failed rule counting
 * - Malformed audit detail handling
 * - Default empty output when no relevant events
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getInstructionEffectivenessFromAudit } from "./db.training";
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

describe("Training Instruction Effectiveness Analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getInstructionEffectivenessFromAudit", () => {
    it("should aggregate metrics across multiple audit events", async () => {
      const mockAuditEvents = [
        {
          id: 1,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            totalSignalsEvaluated: 3,
            signalsPassed: 2,
            signalsRejected: 1,
            activeInstructionCount: 2,
            signals: [
              {
                marketId: "MARKET-1",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Bitcoin Filter",
                    passed: true,
                  },
                  {
                    instructionId: 2,
                    instructionTitle: "Volume Filter",
                    passed: true,
                  },
                ],
              },
              {
                marketId: "MARKET-2",
                signalType: "momentum",
                filterOutcome: "rejected",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Bitcoin Filter",
                    passed: false,
                    failedRules: [
                      {
                        ruleId: 1,
                        ruleKey: "must_have_keyword",
                        ruleType: "require",
                        reason: "Market title missing required keyword: Bitcoin",
                      },
                    ],
                  },
                  {
                    instructionId: 2,
                    instructionTitle: "Volume Filter",
                    passed: true,
                  },
                ],
              },
              {
                marketId: "MARKET-3",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Bitcoin Filter",
                    passed: true,
                  },
                  {
                    instructionId: 2,
                    instructionTitle: "Volume Filter",
                    passed: true,
                  },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
        {
          id: 2,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            totalSignalsEvaluated: 2,
            signalsPassed: 0,
            signalsRejected: 2,
            activeInstructionCount: 1,
            signals: [
              {
                marketId: "MARKET-4",
                signalType: "contrarian",
                filterOutcome: "rejected",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Bitcoin Filter",
                    passed: false,
                    failedRules: [
                      {
                        ruleId: 1,
                        ruleKey: "must_have_keyword",
                        ruleType: "require",
                        reason: "Market title missing required keyword: Bitcoin",
                      },
                    ],
                  },
                ],
              },
              {
                marketId: "MARKET-5",
                signalType: "value_play",
                filterOutcome: "rejected",
                instructionMatches: [
                  {
                    instructionId: 2,
                    instructionTitle: "Volume Filter",
                    passed: false,
                    failedRules: [
                      {
                        ruleId: 2,
                        ruleKey: "min_volume",
                        ruleType: "require",
                        reason: "Volume 300 below minimum 500",
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T11:00:00Z"),
          triggeredByOpenId: "user:123",
        },
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents as any);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      // Check top-level totals
      expect(result.totalEvaluatedSignals).toBe(5);
      expect(result.totalPassedSignals).toBe(2);
      expect(result.totalRejectedSignals).toBe(3);
      expect(result.instructions).toHaveLength(2);

      // Check instruction 1 (Bitcoin Filter)
      const instruction1 = result.instructions.find((i) => i.instructionId === 1);
      expect(instruction1).toBeDefined();
      expect(instruction1!.instructionTitle).toBe("Bitcoin Filter");
      expect(instruction1!.evaluatedSignals).toBe(4);
      expect(instruction1!.passedSignals).toBe(2);
      expect(instruction1!.rejectedSignals).toBe(2);
      expect(instruction1!.passRate).toBeCloseTo(0.5);
      expect(instruction1!.failedRuleCounts).toHaveLength(1);
      expect(instruction1!.failedRuleCounts[0].ruleKey).toBe("must_have_keyword");
      expect(instruction1!.failedRuleCounts[0].count).toBe(2);

      // Check instruction 2 (Volume Filter)
      const instruction2 = result.instructions.find((i) => i.instructionId === 2);
      expect(instruction2).toBeDefined();
      expect(instruction2!.instructionTitle).toBe("Volume Filter");
      expect(instruction2!.evaluatedSignals).toBe(4);
      expect(instruction2!.passedSignals).toBe(3);
      expect(instruction2!.rejectedSignals).toBe(1);
      expect(instruction2!.passRate).toBeCloseTo(0.75);
      expect(instruction2!.failedRuleCounts).toHaveLength(1);
      expect(instruction2!.failedRuleCounts[0].ruleKey).toBe("min_volume");
      expect(instruction2!.failedRuleCounts[0].count).toBe(1);
    });

    it("should count failed rules correctly across multiple failures", async () => {
      const mockAuditEvents = [
        {
          id: 1,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: [
              {
                marketId: "MARKET-1",
                signalType: "value_play",
                filterOutcome: "rejected",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Multi-Rule Filter",
                    passed: false,
                    failedRules: [
                      {
                        ruleId: 1,
                        ruleKey: "must_have_keyword",
                        ruleType: "require",
                        reason: "Missing keyword",
                      },
                      {
                        ruleId: 2,
                        ruleKey: "min_volume",
                        ruleType: "require",
                        reason: "Low volume",
                      },
                    ],
                  },
                ],
              },
              {
                marketId: "MARKET-2",
                signalType: "momentum",
                filterOutcome: "rejected",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Multi-Rule Filter",
                    passed: false,
                    failedRules: [
                      {
                        ruleId: 1,
                        ruleKey: "must_have_keyword",
                        ruleType: "require",
                        reason: "Missing keyword",
                      },
                    ],
                  },
                ],
              },
              {
                marketId: "MARKET-3",
                signalType: "contrarian",
                filterOutcome: "rejected",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Multi-Rule Filter",
                    passed: false,
                    failedRules: [
                      {
                        ruleId: 3,
                        ruleKey: "max_price",
                        ruleType: "require",
                        reason: "Price too high",
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents as any);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      expect(result.instructions).toHaveLength(1);
      const instruction = result.instructions[0];
      expect(instruction.evaluatedSignals).toBe(3);
      expect(instruction.passedSignals).toBe(0);
      expect(instruction.rejectedSignals).toBe(3);
      expect(instruction.failedRuleCounts).toHaveLength(3);
      
      // Sort to ensure consistent ordering
      const sortedRules = instruction.failedRuleCounts.sort((a, b) => b.count - a.count);
      expect(sortedRules[0].ruleKey).toBe("must_have_keyword");
      expect(sortedRules[0].count).toBe(2);
      expect(sortedRules[1].ruleKey).toBe("min_volume");
      expect(sortedRules[1].count).toBe(1);
      expect(sortedRules[2].ruleKey).toBe("max_price");
      expect(sortedRules[2].count).toBe(1);
    });

    it("should handle malformed audit event details gracefully", async () => {
      const mockAuditEvents = [
        {
          id: 1,
          eventType: "instruction_matches_evaluated",
          eventDetails: "invalid json {",
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
        {
          id: 2,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: null,
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
        {
          id: 3,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: [
              {
                marketId: "MARKET-1",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: null,
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
        {
          id: 4,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: [
              {
                marketId: "MARKET-2",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Valid Instruction",
                    passed: true,
                  },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents as any);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      // Should only process the valid event
      expect(result.totalEvaluatedSignals).toBe(1);
      expect(result.totalPassedSignals).toBe(1);
      expect(result.totalRejectedSignals).toBe(0);
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].instructionId).toBe(1);
      expect(result.instructions[0].evaluatedSignals).toBe(1);
    });

    it("should return empty result when no relevant audit events exist", async () => {
      vi.mocked(db.getAuditLog).mockResolvedValue([]);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      expect(result.totalEvaluatedSignals).toBe(0);
      expect(result.totalPassedSignals).toBe(0);
      expect(result.totalRejectedSignals).toBe(0);
      expect(result.instructions).toHaveLength(0);
      expect(result.generatedAt).toBeDefined();
    });

    it("should filter only instruction_matches_evaluated events", async () => {
      const mockAuditEvents = [
        {
          id: 1,
          eventType: "kalshi_order_placed",
          details: JSON.stringify({ orderId: "ORDER-1" }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
        {
          id: 2,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: [
              {
                marketId: "MARKET-1",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  {
                    instructionId: 1,
                    instructionTitle: "Test Instruction",
                    passed: true,
                  },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
        {
          id: 3,
          eventType: "scheduled_autonomy_run_executed",
          details: JSON.stringify({ result: "success" }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents as any);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      // Should only process the instruction_matches_evaluated event
      expect(result.totalEvaluatedSignals).toBe(1);
      expect(result.instructions).toHaveLength(1);
    });

    it("should handle audit events with mixed valid and invalid instruction matches", async () => {
      const mockAuditEvents = [
        {
          id: 1,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: [
              {
                marketId: "MARKET-1",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  {
                    // Missing instructionId (invalid)
                    instructionTitle: "Invalid Instruction",
                    passed: true,
                  },
                  {
                    instructionId: 1,
                    instructionTitle: "Valid Instruction",
                    passed: true,
                  },
                  {
                    instructionId: "not-a-number", // Invalid type
                    instructionTitle: "Another Invalid",
                    passed: true,
                  },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents as any);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      // Should only process the valid instruction
      expect(result.totalEvaluatedSignals).toBe(1);
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].instructionId).toBe(1);
      expect(result.instructions[0].evaluatedSignals).toBe(1);
    });

    it("should handle getAuditLog errors gracefully", async () => {
      vi.mocked(db.getAuditLog).mockRejectedValue(new Error("Database connection failed"));

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      // Should return empty result on error
      expect(result.totalEvaluatedSignals).toBe(0);
      expect(result.totalPassedSignals).toBe(0);
      expect(result.totalRejectedSignals).toBe(0);
      expect(result.instructions).toHaveLength(0);
    });

    it("should calculate passRate correctly for various scenarios", async () => {
      const mockAuditEvents = [
        {
          id: 1,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: [
              {
                marketId: "M1",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  { instructionId: 1, instructionTitle: "Always Pass", passed: true },
                  { instructionId: 2, instructionTitle: "Always Fail", passed: false, failedRules: [] },
                  { instructionId: 3, instructionTitle: "Mixed", passed: true },
                ],
              },
              {
                marketId: "M2",
                signalType: "momentum",
                filterOutcome: "rejected",
                instructionMatches: [
                  { instructionId: 1, instructionTitle: "Always Pass", passed: true },
                  { instructionId: 2, instructionTitle: "Always Fail", passed: false, failedRules: [] },
                  { instructionId: 3, instructionTitle: "Mixed", passed: false, failedRules: [] },
                ],
              },
              {
                marketId: "M3",
                signalType: "contrarian",
                filterOutcome: "passed",
                instructionMatches: [
                  { instructionId: 1, instructionTitle: "Always Pass", passed: true },
                  { instructionId: 2, instructionTitle: "Always Fail", passed: false, failedRules: [] },
                  { instructionId: 3, instructionTitle: "Mixed", passed: true },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents as any);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      expect(result.instructions).toHaveLength(3);

      const alwaysPass = result.instructions.find((i) => i.instructionId === 1);
      expect(alwaysPass!.passRate).toBe(1.0); // 3/3

      const alwaysFail = result.instructions.find((i) => i.instructionId === 2);
      expect(alwaysFail!.passRate).toBe(0.0); // 0/3

      const mixed = result.instructions.find((i) => i.instructionId === 3);
      expect(mixed!.passRate).toBeCloseTo(0.6667, 3); // 2/3
    });

    it("should sort instructions by evaluatedSignals descending", async () => {
      const mockAuditEvents = [
        {
          id: 1,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: [
              {
                marketId: "M1",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  { instructionId: 1, instructionTitle: "Low Activity", passed: true },
                ],
              },
              {
                marketId: "M2",
                signalType: "momentum",
                filterOutcome: "passed",
                instructionMatches: [
                  { instructionId: 2, instructionTitle: "High Activity", passed: true },
                ],
              },
              {
                marketId: "M3",
                signalType: "contrarian",
                filterOutcome: "passed",
                instructionMatches: [
                  { instructionId: 2, instructionTitle: "High Activity", passed: true },
                ],
              },
              {
                marketId: "M4",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  { instructionId: 2, instructionTitle: "High Activity", passed: true },
                ],
              },
              {
                marketId: "M5",
                signalType: "momentum",
                filterOutcome: "passed",
                instructionMatches: [
                  { instructionId: 3, instructionTitle: "Medium Activity", passed: true },
                ],
              },
              {
                marketId: "M6",
                signalType: "contrarian",
                filterOutcome: "passed",
                instructionMatches: [
                  { instructionId: 3, instructionTitle: "Medium Activity", passed: true },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents as any);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      expect(result.instructions).toHaveLength(3);
      expect(result.instructions[0].instructionId).toBe(2); // 3 signals
      expect(result.instructions[0].evaluatedSignals).toBe(3);
      expect(result.instructions[1].instructionId).toBe(3); // 2 signals
      expect(result.instructions[1].evaluatedSignals).toBe(2);
      expect(result.instructions[2].instructionId).toBe(1); // 1 signal
      expect(result.instructions[2].evaluatedSignals).toBe(1);
    });

    it("should use default instruction title when not provided", async () => {
      const mockAuditEvents = [
        {
          id: 1,
          eventType: "instruction_matches_evaluated",
          details: JSON.stringify({
            signals: [
              {
                marketId: "MARKET-1",
                signalType: "value_play",
                filterOutcome: "passed",
                instructionMatches: [
                  {
                    instructionId: 42,
                    // No instructionTitle provided
                    passed: true,
                  },
                ],
              },
            ],
          }),
          createdAt: new Date("2026-05-06T10:00:00Z"),
          triggeredByOpenId: "user:123",
        },
      ];

      vi.mocked(db.getAuditLog).mockResolvedValue(mockAuditEvents as any);

      const result = await getInstructionEffectivenessFromAudit("user:123", 30);

      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].instructionTitle).toBe("Instruction 42");
    });
  });
});

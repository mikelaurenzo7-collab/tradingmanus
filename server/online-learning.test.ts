import { describe, expect, it } from "vitest";
import {
  applyOnlineLearningUpdate,
  createInitialOnlineLearningModel,
  deriveModelFromUpdates,
  selectSignalTypeWithThompsonSampling,
} from "./_core/onlineLearning";

describe("online learning", () => {
  it("boosts weight on wins and penalizes on losses", () => {
    const model = createInitialOnlineLearningModel({ userId: 1, platform: "kalshi" });

    const win = applyOnlineLearningUpdate(model, {
      signalType: "momentum",
      outcome: "win",
      pnl: 2,
    }, () => 0.9);
    const loss = applyOnlineLearningUpdate(win.nextModel, {
      signalType: "momentum",
      outcome: "loss",
      pnl: -2,
    }, () => 0.9);

    expect(win.weightAfter).toBeGreaterThan(1);
    expect(loss.weightAfter).toBeLessThan(win.weightAfter);
  });

  it("increments model version every 50 updates", () => {
    const updates = Array.from({ length: 120 }, (_, i) => ({
      signalType: i % 2 === 0 ? "momentum" : "value_play",
      outcome: i % 3 === 0 ? "loss" as const : "win" as const,
      pnl: i % 3 === 0 ? -1 : 1,
    }));

    const model = deriveModelFromUpdates({ userId: 1, platform: "kalshi", updates });
    expect(model.updateCount).toBe(120);
    expect(model.modelVersion).toBe(3);
  });

  it("detects drift on large regime shift", () => {
    let model = createInitialOnlineLearningModel({ userId: 1, platform: "kalshi" });

    for (let i = 0; i < 30; i += 1) {
      model = applyOnlineLearningUpdate(model, {
        signalType: "momentum",
        outcome: "win",
        pnl: 1,
      }, () => 0.9).nextModel;
    }

    const shift = applyOnlineLearningUpdate(model, {
      signalType: "momentum",
      outcome: "loss",
      pnl: -25,
    }, () => 0.9);

    expect(shift.driftDetected).toBe(true);
  });

  it("supports exploration in thompson sampling", () => {
    const model = createInitialOnlineLearningModel({ userId: 1, platform: "kalshi" });
    const selected = selectSignalTypeWithThompsonSampling({
      candidates: ["momentum", "value_play"],
      model,
      random: () => 0.05,
    });

    expect(["momentum", "value_play"]).toContain(selected);
  });
});

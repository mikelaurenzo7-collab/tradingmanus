import { describe, it, expect } from "vitest";
import {
  computeAwardsPrecursorProbability,
  classifyAwardsMarket,
  lookupAwardsFundamental,
  KNOWN_NOMINEES,
  KNOWN_PRECURSORS,
} from "./_core/kalshiAwardsPrecursor";

describe("computeAwardsPrecursorProbability", () => {
  it("returns uniform probabilities when no precursors are known", () => {
    const probs = computeAwardsPrecursorProbability(
      "oscar_best_picture",
      ["A", "B", "C", "D"],
      {},
    );
    expect(Object.values(probs).every((p) => Math.abs(p - 0.25) < 1e-9)).toBe(true);
    const sum = Object.values(probs).reduce((s, p) => s + p, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("lifts the winner of a heavy precursor", () => {
    const probs = computeAwardsPrecursorProbability(
      "oscar_best_picture",
      ["A", "B", "C", "D"],
      { pga: "A" }, // PGA = 0.35 weight
    );
    expect(probs.A).toBeGreaterThan(0.4);
    expect(probs.B).toBeLessThan(0.25);
    const sum = Object.values(probs).reduce((s, p) => s + p, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("stacks multiple precursors onto the same nominee", () => {
    const single = computeAwardsPrecursorProbability(
      "oscar_best_picture",
      ["A", "B"],
      { pga: "A" },
    );
    const multi = computeAwardsPrecursorProbability(
      "oscar_best_picture",
      ["A", "B"],
      { pga: "A", dga: "A", sag_ensemble: "A" },
    );
    expect(multi.A).toBeGreaterThan(single.A);
    expect(multi.A).toBeLessThan(0.99);
  });

  it("ignores unknown precursor keys", () => {
    const probs = computeAwardsPrecursorProbability(
      "oscar_best_picture",
      ["A", "B"],
      { fictional_precursor: "A" },
    );
    expect(Math.abs(probs.A - 0.5)).toBeLessThan(1e-9);
  });

  it("returns empty map when nominee list is empty", () => {
    const probs = computeAwardsPrecursorProbability(
      "oscar_best_picture",
      [],
      { pga: "A" },
    );
    expect(probs).toEqual({});
  });

  it("matches nominees case-insensitively / punctuation-insensitively", () => {
    const probs = computeAwardsPrecursorProbability(
      "oscar_best_picture",
      ["The Brutalist", "Conclave"],
      { pga: "the brutalist" },
    );
    expect(probs["The Brutalist"]).toBeGreaterThan(0.5);
  });

  it("never produces a nominee probability above 1 even with a sweep", () => {
    const probs = computeAwardsPrecursorProbability(
      "oscar_best_picture",
      ["A", "B"],
      {
        pga: "A",
        dga: "A",
        sag_ensemble: "A",
        bafta: "A",
        critics_choice: "A",
      },
    );
    expect(probs.A).toBeLessThanOrEqual(1);
    // Sum-of-weights is ~0.95, so a clean sweep concentrates ~83%+ on the
    // sweeping nominee.  Never exceed 1, and the loser stays non-negative.
    expect(probs.A).toBeGreaterThan(0.8);
    expect(probs.B).toBeGreaterThanOrEqual(0);
    expect(probs.A + probs.B).toBeCloseTo(1, 9);
  });
});

describe("classifyAwardsMarket", () => {
  it("identifies Best Picture markets", () => {
    expect(
      classifyAwardsMarket("Will Anora win Best Picture at the 2026 Oscars?"),
    ).toMatchObject({ category: "oscar_best_picture" });
  });

  it("identifies Album of the Year markets", () => {
    expect(
      classifyAwardsMarket("Cowboy Carter for Album of the Year"),
    ).toMatchObject({ category: "grammy_album_of_the_year" });
  });

  it("returns null for unrelated markets", () => {
    expect(classifyAwardsMarket("Bitcoin closes above $100k by EOY?")).toBeNull();
  });

  it("extracts a non-empty nominee", () => {
    const result = classifyAwardsMarket(
      "Will The Brutalist win Best Picture at the 2026 Oscars?",
    );
    expect(result).not.toBeNull();
    expect(result!.nominee).toMatch(/brutalist/i);
  });
});

describe("lookupAwardsFundamental", () => {
  it("returns null when no curated nominee data exists", () => {
    // Default empty KNOWN_NOMINEES
    expect(
      lookupAwardsFundamental({
        title: "Will Anora win Best Picture at the 2026 Oscars?",
      }),
    ).toBeNull();
  });

  it("returns a calibrated probability when nominees + precursors are staged", () => {
    KNOWN_NOMINEES.oscar_best_picture = ["Anora", "The Brutalist", "Conclave"];
    KNOWN_PRECURSORS.oscar_best_picture = { pga: "Conclave" };
    try {
      const value = lookupAwardsFundamental({
        title: "Will Conclave win Best Picture at the 2026 Oscars?",
      });
      expect(value).not.toBeNull();
      expect(value!).toBeGreaterThan(0.4);
      expect(value!).toBeLessThan(0.99);
    } finally {
      delete KNOWN_NOMINEES.oscar_best_picture;
      delete KNOWN_PRECURSORS.oscar_best_picture;
    }
  });

  it("returns null when the nominee in the title is not in the curated list", () => {
    KNOWN_NOMINEES.oscar_best_picture = ["Anora", "The Brutalist"];
    try {
      expect(
        lookupAwardsFundamental({
          title: "Will RandomUnknownFilm win Best Picture at the 2026 Oscars?",
        }),
      ).toBeNull();
    } finally {
      delete KNOWN_NOMINEES.oscar_best_picture;
    }
  });
});

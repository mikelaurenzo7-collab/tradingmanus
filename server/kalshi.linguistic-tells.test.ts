import { describe, it, expect } from "vitest";
import {
  detectTells,
  classifyTellMarket,
  lookupLinguisticTellPrior,
} from "./_core/kalshiLinguisticTells";

describe("detectTells", () => {
  it("returns no matches for benign news snippets", () => {
    const matches = detectTells([
      "Company reported strong revenue growth in Q4.",
      "New product launch went well.",
    ]);
    expect(matches).toEqual([]);
  });

  it("flags strategic alternatives as M&A signal", () => {
    const matches = detectTells([
      "The Board has retained advisors to review strategic alternatives.",
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].tell.marketType).toBe("ma_acquisition");
    expect(matches[0].tell.phrase).toBe("strategic alternatives");
  });

  it("flags right-sizing as layoff signal", () => {
    const matches = detectTells([
      "We are right-sizing our operations to align with market realities.",
    ]);
    expect(matches.some((m) => m.tell.marketType === "layoffs")).toBe(true);
  });

  it("flags multiple tells across multiple snippets", () => {
    const matches = detectTells([
      "Mutually agreed transition for the CEO.",
      "The company is exploring strategic options.",
    ]);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const types = new Set(matches.map((m) => m.tell.marketType));
    expect(types.has("ceo_departure")).toBe(true);
    expect(types.has("ma_acquisition")).toBe(true);
  });

  it("is case-insensitive", () => {
    const matches = detectTells([
      "STRATEGIC ALTERNATIVES being reviewed.",
    ]);
    expect(matches).toHaveLength(1);
  });

  it("ignores non-string inputs gracefully", () => {
    const matches = detectTells([
      "",
      "  ",
      "challenging environment ahead.",
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].tell.marketType).toBe("earnings_miss");
  });
});

describe("classifyTellMarket", () => {
  it("classifies acquisition markets", () => {
    expect(classifyTellMarket("Will Acme Corp be acquired by EOY?")).toBe(
      "ma_acquisition",
    );
  });

  it("classifies CEO departure markets", () => {
    expect(
      classifyTellMarket("Will Acme CEO step down by Q3?"),
    ).toBe("ceo_departure");
  });

  it("classifies layoffs markets", () => {
    expect(
      classifyTellMarket("Will Acme announce layoffs by Aug 2026?"),
    ).toBe("layoffs");
  });

  it("classifies earnings miss markets", () => {
    expect(
      classifyTellMarket("Will Acme miss EPS estimate Q3 2026?"),
    ).toBe("earnings_miss");
  });

  it("returns null for unrelated markets", () => {
    expect(classifyTellMarket("Will it rain in NYC tomorrow?")).toBeNull();
  });
});

describe("lookupLinguisticTellPrior", () => {
  it("returns null when no relevant tells match", () => {
    const result = lookupLinguisticTellPrior({
      marketType: "ma_acquisition",
      newsSnippets: ["Strong product launch.", "Revenue grew 20%."],
    });
    expect(result).toBeNull();
  });

  it("posterior beats prior when one strong tell matches", () => {
    const result = lookupLinguisticTellPrior({
      marketType: "ma_acquisition",
      newsSnippets: ["The Board retained advisors to review strategic alternatives."],
      basePrior: 0.15,
    });
    expect(result).not.toBeNull();
    expect(result!.posterior).toBeGreaterThan(0.5);
  });

  it("posterior is monotonic in number of matching tells", () => {
    const oneTell = lookupLinguisticTellPrior({
      marketType: "ma_acquisition",
      newsSnippets: ["strategic alternatives"],
      basePrior: 0.15,
    });
    const twoTells = lookupLinguisticTellPrior({
      marketType: "ma_acquisition",
      newsSnippets: ["strategic alternatives", "exploring strategic options"],
      basePrior: 0.15,
    });
    expect(twoTells!.posterior).toBeGreaterThan(oneTell!.posterior);
  });

  it("posterior is capped below 0.95 even with many tells", () => {
    const result = lookupLinguisticTellPrior({
      marketType: "ma_acquisition",
      newsSnippets: [
        "strategic alternatives",
        "exploring strategic options",
        "engaging financial advisors",
        "review of strategic options",
        "evaluating all options",
      ],
      basePrior: 0.5,
    });
    expect(result!.posterior).toBeLessThanOrEqual(0.95);
  });

  it("filters by marketType (CEO tells don't drive M&A posterior)", () => {
    const result = lookupLinguisticTellPrior({
      marketType: "ma_acquisition",
      newsSnippets: ["CEO mutually agreed to step aside."],
      basePrior: 0.15,
    });
    expect(result).toBeNull();
  });

  it("works for layoff tells", () => {
    const result = lookupLinguisticTellPrior({
      marketType: "layoffs",
      newsSnippets: ["right-sizing the workforce", "rationalize the cost base"],
      basePrior: 0.2,
    });
    expect(result).not.toBeNull();
    expect(result!.posterior).toBeGreaterThan(0.5);
  });
});

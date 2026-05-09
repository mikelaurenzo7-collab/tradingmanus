import { describe, expect, it } from "vitest";
import {
  classifyMarketCategory,
  groupByCategory,
  MARKET_CATEGORIES,
} from "./_core/marketCategoryRouter";
import { getCategoryPersona, listPersonasForPlatform } from "./_core/categoryPersonas";

describe("classifyMarketCategory", () => {
  it("classifies sports markets from category tag", () => {
    expect(
      classifyMarketCategory({ category: "Sports / NFL", title: "Lakers vs Celtics" }),
    ).toBe("sports");
  });

  it("classifies crypto markets", () => {
    expect(
      classifyMarketCategory({
        category: "Crypto",
        title: "Will Bitcoin close above 100k?",
      }),
    ).toBe("crypto");
  });

  it("classifies politics markets", () => {
    expect(
      classifyMarketCategory({
        category: "Politics",
        title: "Will the Speaker of the House change?",
      }),
    ).toBe("politics");
  });

  it("classifies macro/economics markets", () => {
    expect(
      classifyMarketCategory({
        category: "Economics",
        title: "Fed rate cut at next FOMC?",
      }),
    ).toBe("economics");
  });

  it("classifies tech markets", () => {
    expect(
      classifyMarketCategory({
        category: "Tech",
        title: "Will OpenAI release GPT-6 by Q3?",
      }),
    ).toBe("tech");
  });

  it("falls back to other when nothing matches", () => {
    expect(
      classifyMarketCategory({
        category: "miscellaneous",
        title: "Random unrelated question",
      }),
    ).toBe("other");
  });

  it("uses question field for Polymarket-style payloads", () => {
    expect(
      classifyMarketCategory({
        category: "",
        question: "Will Bitcoin reach 150k this year?",
      }),
    ).toBe("crypto");
  });
});

describe("groupByCategory", () => {
  it("buckets items by classified category", () => {
    const items = [
      { id: "a", market: { category: "Sports", title: "Lakers win finals" } },
      { id: "b", market: { category: "Politics", title: "Trump vs Biden" } },
      { id: "c", market: { category: "Crypto", title: "Bitcoin above 100k" } },
      { id: "d", market: { category: "Sports", title: "Final match" } },
    ];
    const buckets = groupByCategory(items, (item) => item.market);
    expect(buckets.get("sports")).toHaveLength(2);
    expect(buckets.get("politics")).toHaveLength(1);
    expect(buckets.get("crypto")).toHaveLength(1);
  });
});

describe("category personas (single Profit-Reviewer collapse)", () => {
  it("returns the same single Profit-Reviewer persona for every (platform, category) pair", () => {
    for (const platform of ["kalshi"] as const) {
      for (const category of MARKET_CATEGORIES) {
        const persona = getCategoryPersona(platform, category);
        expect(persona.platform).toBe(platform);
        // After the persona collapse, platform is preserved but category
        // is always the canonical "other" — the persona is shared.
        expect(persona.id).toBe("kalshi.profit-reviewer");
        expect(persona.systemMandate.length).toBeGreaterThan(50);
        expect(persona.systemMandate).toMatch(/JSON/);
      }
    }
  });

  it("listPersonasForPlatform returns the single shared Profit Persona", () => {
    expect(listPersonasForPlatform("kalshi")).toHaveLength(1);
  });
});

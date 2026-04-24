import { describe, expect, it } from "vitest";

describe("GNEWS_API_KEY secret", () => {
  it("authorizes a lightweight GNews top-headlines request", async () => {
    const apiKey = process.env.GNEWS_API_KEY;

    expect(apiKey).toBeTruthy();

    const response = await fetch(
      `https://gnews.io/api/v4/top-headlines?category=business&lang=en&max=1&apikey=${apiKey}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "nexus-omega-dashboard/1.0 secret validation",
        },
      },
    );

    expect([200, 429]).toContain(response.status);

    const payload = (await response.json()) as {
      totalArticles?: number;
      articles?: Array<{ title?: string }>;
      errors?: string[];
      message?: string;
      information?: Record<string, unknown>;
    };

    if (response.status === 429) {
      expect(
        `${payload.message ?? ""} ${payload.errors?.join(" ") ?? ""}`.toLowerCase(),
      ).toMatch(/rate|limit|quota|too many requests|blocked/);
      return;
    }

    expect(Array.isArray(payload.articles)).toBe(true);
    expect(payload.articles!.length).toBeGreaterThan(0);
    expect(typeof payload.articles?.[0]?.title).toBe("string");
    expect(payload.errors).toBeUndefined();
  }, 15000);
});

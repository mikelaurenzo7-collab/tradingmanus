import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("site metadata branding", () => {
  it("uses Laurenzo for browser and mobile-visible app naming", () => {
    const htmlPath = path.resolve(process.cwd(), "client/index.html");
    const html = fs.readFileSync(htmlPath, "utf8");

    expect(html).toContain("<title>Laurenzo</title>");
    expect(html).toContain('name="application-name" content="Laurenzo"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="Laurenzo"');
    expect(html).toContain('property="og:title" content="Laurenzo"');
    expect(html).not.toMatch(/NEXUS OMEGA|Nexus Omega|nexus-omega/i);
  });
});

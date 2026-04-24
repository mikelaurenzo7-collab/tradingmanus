import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("site metadata branding", () => {
  it("uses Laurenzo for browser and visible dashboard naming", () => {
    const htmlPath = path.resolve(process.cwd(), "client/index.html");
    const layoutPath = path.resolve(process.cwd(), "client/src/components/DashboardLayout.tsx");
    const dashboardPath = path.resolve(process.cwd(), "client/src/pages/Dashboard.tsx");
    const html = fs.readFileSync(htmlPath, "utf8");
    const layout = fs.readFileSync(layoutPath, "utf8");
    const dashboard = fs.readFileSync(dashboardPath, "utf8");

    expect(html).toContain("<title>Laurenzo</title>");
    expect(html).toContain('name="application-name" content="Laurenzo"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="Laurenzo"');
    expect(html).toContain('property="og:title" content="Laurenzo"');
    expect(layout).toContain('document.title = "Laurenzo"');
    expect(layout).toContain("Laurenzo Trading Dashboard");
    expect(dashboard).toContain("Laurenzo Trading Dashboard • Owner");
    expect(`${html}\n${layout}\n${dashboard}`).not.toMatch(/NEXUS OMEGA|Nexus Omega|nexus-omega/i);
    expect(`${layout}\n${dashboard}`).not.toContain("Kalshi Trading Dashboard");
  });
});

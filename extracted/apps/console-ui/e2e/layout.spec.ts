import { test, expect, type Page } from "@playwright/test";

// Runs at both desktop (1280×800) and mobile (Pixel 5) viewports — see the
// projects in playwright.config.ts. The check is intentionally simple and
// high-signal: each surface renders and does not overflow horizontally (the most
// common responsive-layout break). Surfaces are reached via the real user flow
// from the marketing site.

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("marketing site renders without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Try the playground" }).first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
});

test("playground (Try) renders without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the playground" }).first().click();
  // The app shell's back button confirms we left the marketing site.
  await expect(page.getByRole("button", { name: /AristotleOS/ })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
});

test("Command Center renders without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Launch Command Center" }).first().click();
  await expect(page.getByRole("button", { name: /AristotleOS/ })).toBeVisible();
  // Command Center's section rail proves the dashboard mounted.
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
});

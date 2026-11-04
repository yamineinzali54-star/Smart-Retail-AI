import { expect, test } from "@playwright/test";

// Core auth journeys: default-deny, failed login, inventory login,
// session API, logout. (Admin TOTP enrollment has its own spec.)
test("unauthenticated / redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("SmartRetailAI")).toBeVisible();
});

test("invalid credentials show an error and stay on /login", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill("nobody");
  await page.locator('input[type="password"]').fill("Wrong@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/invalid username/i)).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/\/login/);
});

test("inventory login lands on the inventory workspace", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill("inventory1");
  await page.locator('input[type="password"]').fill("Inventory@123");
  // Role home for inventory is /inventory (not /dashboard)
  await Promise.all([
    page.waitForURL(/\/inventory/, { timeout: 15000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  // The username appears in the sidebar user dropdown button
  await expect(page.locator('button:has-text("inventory1")')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("inventory", { exact: true })).toBeVisible();

  const session = await page.request.get("/api/auth/session");
  expect(session.ok()).toBe(true);
  const data = await session.json();
  expect(data.session?.user?.role).toBe("inventory");
});

test("logout returns to /login and kills the session", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill("cashier1");
  await page.locator('input[type="password"]').fill("Cashier@123");
  // Role home for cashier is /pos (not /dashboard)
  await Promise.all([
    page.waitForURL(/\/pos/, { timeout: 15000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  await expect(page.getByText("cashier1")).toBeVisible({ timeout: 10000 });

  // Logout is in the user dropdown in the sidebar
  // The dropdown trigger is a button containing the username
  await page.locator('button:has-text("cashier1")').click();
  await page.getByRole("menuitem", { name: /log out/i }).click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
  await expect(page).toHaveURL(/\/login/);

  const session = await page.request.get("/api/auth/session");
  expect(session.status()).toBe(401);
});
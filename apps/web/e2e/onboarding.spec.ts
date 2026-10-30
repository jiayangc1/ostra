import { expect, test } from "./fixtures.ts";

test("onboarding with label templates", async ({ signIn }) => {
  const page = await signIn({ onboarded: false, labels: false });
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { name: "Bring every inbox" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Connected accounts" }).getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Set up labels" })).toBeVisible();
  await page.locator("[data-template=founder]").click();
  await page.locator("[data-template=personal]").click();
  await expect(page.locator("[data-template=founder]")).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Your own labels").fill("Press");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("switch", { name: "Auto-label incoming mail" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Last touches" })).toBeVisible();
  await page.getByRole("radio", { name: /Light/ }).click();
  await page.getByRole("button", { name: "Open my inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const nav = page.getByRole("navigation", { name: "Mailboxes" });
  for (const name of ["Investors", "Customers", "Hiring", "Legal", "Family", "Travel", "Receipts", "Press"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  // Finished users aren't sent back.
  await page.reload();
  await expect(page).toHaveURL(/\/inbox$/);
});

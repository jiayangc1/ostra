import { expect, openInbox, test } from "./fixtures.ts";

test("open a thread from the keyboard and read it", async ({ signIn }) => {
  const page = await signIn();
  await openInbox(page);
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Q4 roadmap review moved to 3pm" })).toBeVisible();
  await expect(page.getByText("the roadmap review is now at 3pm in Juniper")).toBeVisible();
  await expect(page.getByRole("button", { name: /q4-roadmap\.pdf/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/inbox$/);
});

test("bundle rows collapse non-primary mail and expand inline", async ({ signIn }) => {
  const page = await signIn();
  await openInbox(page);
  const bundle = page.locator("[data-bundle=newsletter]");
  await expect(bundle).toContainText("Newsletters");
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Lenny's Newsletter" })).toHaveCount(0);
  await bundle.click();
  await expect(bundle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Lenny's Newsletter" })).toBeVisible();
  await bundle.click();
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Lenny's Newsletter" })).toHaveCount(0);
});

test("label a thread with l", async ({ signIn }) => {
  const page = await signIn();
  await openInbox(page);
  const row = page.locator("[data-thread-id]").filter({ hasText: "Mom" });
  await row.click();
  await page.keyboard.press("l");
  const picker = page.getByRole("dialog", { name: "Label" });
  await expect(picker).toBeVisible();
  await page.keyboard.type("Legal");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(row.getByText("Legal")).toBeVisible();
  // Survives a reload: it was saved, not just drawn.
  await page.reload();
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Mom" }).getByText("Legal")).toBeVisible();
});

test("⌘K archives the thread and navigates", async ({ signIn }) => {
  const page = await signIn();
  await openInbox(page);
  const row = page.locator("[data-thread-id]").filter({ hasText: "Sunday dinner?" });
  await row.click();
  await page.keyboard.press("ControlOrMeta+k");
  const bar = page.getByRole("dialog", { name: "Command bar" });
  await expect(bar).toBeVisible();
  await page.keyboard.type("archive");
  await expect(bar.getByRole("option").first()).toContainText("Archive");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Sunday dinner?" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Archived" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("go to archive");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/archive$/);
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Sunday dinner?" })).toBeVisible();
});

test("y changes the category in one keystroke", async ({ signIn }) => {
  const page = await signIn();
  await openInbox(page);
  await page.locator("[data-thread-id]").filter({ hasText: "Diego Alvarez" }).click();
  await page.keyboard.press("y");
  await page.keyboard.press("3");
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Diego Alvarez" })).toHaveCount(0);
  await expect(page.locator("[data-bundle=notification]")).toContainText("12");
});

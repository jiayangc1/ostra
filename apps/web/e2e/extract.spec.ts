import { expect, openInbox, test } from "./fixtures.ts";

test("a fresh sign-in code shows above the list and ⇧C copies it", async ({ signIn, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await signIn();
  await openInbox(page);
  const bar = page.getByRole("status").filter({ hasText: "Code from Google" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Copy code 482913" })).toBeVisible();
  await page.keyboard.press("Shift+C");
  await expect(page.getByRole("status").filter({ hasText: "Copied 482913" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("482913");
});

test("connect a calendar, then add an invite to a chosen calendar", async ({ signIn }) => {
  const page = await signIn();
  await page.goto("/settings/calendars");
  await page.getByRole("button", { name: /Other CalDAV/ }).click();
  // demo.invalid is an in-memory calendar in demo mode.
  await page.getByLabel("Server").fill("demo.invalid");
  await page.getByLabel("Username").fill("me@demo.local");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("me@demo.local")).toBeVisible();

  await openInbox(page);
  await page.locator("[data-thread-id]").filter({ hasText: "Invitation: Design review" }).click();
  const card = page.getByRole("region", { name: "Event: Design review" });
  await expect(card.getByRole("button", { name: "Add to Home" })).toBeVisible();
  await card.getByRole("button", { name: "Choose a calendar" }).click();
  await page.keyboard.type("debate");
  await page.keyboard.press("Enter");
  await expect(card.getByText("Added to Debate")).toBeVisible();
  // Saved, not just drawn.
  await page.reload();
  await expect(page.getByRole("region", { name: "Event: Design review" }).getByText("Added to Debate")).toBeVisible();
});

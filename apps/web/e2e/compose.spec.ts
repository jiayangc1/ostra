import { expect, openInbox, test } from "./fixtures.ts";

test("pre-send check warns about the wrong account and a missing attachment, then sends anyway", async ({ signIn }) => {
  const page = await signIn();
  await openInbox(page);
  await page.locator("[data-thread-id]").filter({ hasText: "Priya Natarajan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Re: Tidepool seed: next steps" })).toBeVisible();
  await page.keyboard.press("r");
  const composer = page.getByRole("dialog", { name: "Reply" });
  await expect(composer).toBeVisible();
  // Smart from picked the address Priya wrote to.
  await expect(composer.getByLabel("From")).toHaveValue(await composer.getByLabel("From").locator("option", { hasText: "hello@tidepool.dev" }).getAttribute("value") ?? "");
  await expect(composer.getByLabel("To")).toHaveValue("Priya Natarajan <priya@foundry.vc>");

  await composer.getByLabel("Message").fill("Hi Priya, I've attached the updated model.");
  await composer.getByLabel("From").selectOption({ label: "Sam Rivera <sam.rivera@gmail.com>" });
  await page.keyboard.press("ControlOrMeta+Enter");

  const warnings = composer.getByTestId("presend-warnings");
  await expect(warnings).toContainText("This mail was sent to Tidepool <hello@tidepool.dev>");
  await expect(warnings).toContainText("You mention an attachment, but nothing is attached.");
  await warnings.getByRole("button", { name: "Switch" }).click();
  await expect(composer.getByLabel("From")).toHaveValue(await composer.getByLabel("From").locator("option", { hasText: "hello@tidepool.dev" }).getAttribute("value") ?? "");

  await composer.getByRole("button", { name: /Send anyway/ }).click();
  await expect(composer).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Sent" })).toBeVisible();
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Priya Natarajan" })).toContainText("4");
});

test("compose new mail with c", async ({ signIn }) => {
  const page = await signIn();
  await openInbox(page);
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.getByLabel("To").fill("friend@example.org");
  await composer.getByLabel("Subject").fill("Coffee in November");
  await composer.getByLabel("Message").fill("Are you around in November?");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/sent$/);
  await expect(page.locator("[data-thread-id]").filter({ hasText: "Coffee in November" })).toBeVisible();
});

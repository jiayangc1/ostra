import { test as base, expect, type Page } from "@playwright/test";

const API = "http://localhost:8790";

/** Each test signs in as its own dev user, seeded with demo mail. */
export const test = base.extend<{ user: string; signIn: (opts?: { onboarded?: boolean; labels?: boolean }) => Promise<Page> }>({
  user: async ({}, use, info) => {
    await use(`e2e${info.workerIndex}x${info.testId.slice(0, 8).replace(/[^a-z0-9]/gi, "")}`.toLowerCase());
  },
  signIn: async ({ page, user, request }, use) => {
    await use(async (opts = {}) => {
      const res = await request.post(`${API}/api/dev/seed`, { headers: { authorization: `Bearer dev:${user}` }, data: { onboarded: opts.onboarded ?? true, labels: opts.labels ?? true } });
      expect(res.ok()).toBeTruthy();
      await page.addInitScript((u) => localStorage.setItem("ostra:dev-user", u), user);
      return page;
    });
  },
});

export { expect };

export async function openInbox(page: Page) {
  await page.goto("/inbox");
  await expect(page.locator("[data-thread-id]").first()).toBeVisible({ timeout: 15_000 });
}

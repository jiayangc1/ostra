import { DEFAULT_SETTINGS, type UserSettings } from "@ostra/core";
import { eq, users, type Db, type UserRow } from "@ostra/db";

export async function upsertUserByClerkId(db: Db, clerkUserId: string, profile: { email?: string; name?: string | null } = {}): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ clerkUserId, email: profile.email ?? "", name: profile.name ?? null })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: {
        ...(profile.email !== undefined ? { email: profile.email } : {}),
        ...(profile.name !== undefined ? { name: profile.name } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function findUserByClerkId(db: Db, clerkUserId: string) {
  const [row] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId));
  return row ?? null;
}

export function settingsOf(row: Pick<UserRow, "settings">): UserSettings {
  return { ...DEFAULT_SETTINGS, ...row.settings };
}

export async function updateSettings(db: Db, userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  const [row] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  const next = { ...row?.settings, ...patch };
  await db.update(users).set({ settings: next, updatedAt: new Date() }).where(eq(users.id, userId));
  return settingsOf({ settings: next });
}

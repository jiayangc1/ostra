import { DEFAULT_SETTINGS, type UserSettings } from "@ostra/core";
import { eq, sql, users, type Db, type UserRow } from "@ostra/db";

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

/** Merge in the database, so two quick saves (say, the time zone and finishing onboarding) can't overwrite each other. */
export async function updateSettings(db: Db, userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  const [row] = await db
    .update(users)
    .set({ settings: sql`${users.settings} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ settings: users.settings });
  return settingsOf({ settings: row?.settings ?? patch });
}

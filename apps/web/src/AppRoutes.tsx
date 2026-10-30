import { Button, OstraLogo, useAuthState } from "@ostra/ui";

/** Placeholder until the three-pane app lands. */
export function AppRoutes() {
  const auth = useAuthState();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <OstraLogo />
      <p className="text-fg-2">Signed in as {auth.user?.email}</p>
      <Button onClick={() => void auth.signOut()}>Sign out</Button>
    </div>
  );
}

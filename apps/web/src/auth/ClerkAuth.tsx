import { useMemo, type ReactNode } from "react";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from "@clerk/react";
import { useNavigate } from "react-router";
import { AuthLayout, AuthProvider, useTheme, type AuthState } from "@ostra/ui";
import { clerkAppearance } from "./appearance.ts";

function Bridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const value = useMemo<AuthState>(
    () => ({
      status: !isLoaded ? "loading" : isSignedIn ? "signedIn" : "signedOut",
      user: user ? { name: user.fullName, email: user.primaryEmailAddress?.emailAddress ?? null, imageUrl: user.imageUrl } : null,
      getToken: () => getToken(),
      signOut: () => signOut(),
      openProfile: () => clerk.openUserProfile(),
      SignIn: () => (
        <AuthLayout>
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
        </AuthLayout>
      ),
      SignUp: () => (
        <AuthLayout>
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/onboarding" />
        </AuthLayout>
      ),
    }),
    [isLoaded, isSignedIn, getToken, signOut, user, clerk],
  );
  return <AuthProvider value={value}>{children}</AuthProvider>;
}

export function ClerkAuth({ publishableKey, children }: { publishableKey: string; children: ReactNode }) {
  const navigate = useNavigate();
  const { resolved } = useTheme();
  const appearance = useMemo(() => clerkAppearance(resolved), [resolved]);
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={appearance}
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  );
}

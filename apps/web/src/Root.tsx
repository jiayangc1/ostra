import { lazy, Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ShellSkeleton, useAuthState } from "@ostra/ui";
import { DevAuth } from "./auth/DevAuth.tsx";

// Clerk is the largest dependency; it loads only when a key is configured.
const ClerkAuth = lazy(() => import("./auth/ClerkAuth.tsx").then((m) => ({ default: m.ClerkAuth })));

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || import.meta.env.CLERK_PUBLISHABLE_KEY || undefined;

/** Chooses Clerk or local dev auth, then renders the matched route. */
export function Root() {
  return CLERK_KEY ? (
    <Suspense fallback={<div className="h-full bg-canvas" aria-busy="true" />}>
      <ClerkAuth publishableKey={CLERK_KEY}>
        <Outlet />
      </ClerkAuth>
    </Suspense>
  ) : (
    <DevAuth>
      <Outlet />
    </DevAuth>
  );
}

export function SignInRoute() {
  const auth = useAuthState();
  if (auth.status === "signedIn") return <Navigate to="/" replace />;
  return <auth.SignIn />;
}

export function SignUpRoute() {
  const auth = useAuthState();
  if (auth.status === "signedIn") return <Navigate to="/onboarding" replace />;
  return <auth.SignUp />;
}

/** Every app route sits behind this: signed-out users go to the themed sign-in page. */
export function RequireAuth() {
  const auth = useAuthState();
  const location = useLocation();
  if (auth.status === "loading") {
    return <ShellSkeleton />;
  }
  if (auth.status === "signedOut") return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

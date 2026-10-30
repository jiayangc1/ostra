import { Navigate, Outlet, useLocation } from "react-router";
import { ListSkeleton, useAuthState } from "@ostra/ui";
import { ClerkAuth } from "./auth/ClerkAuth.tsx";
import { DevAuth } from "./auth/DevAuth.tsx";

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/** Chooses Clerk or local dev auth, then renders the matched route. */
export function Root() {
  return CLERK_KEY ? (
    <ClerkAuth publishableKey={CLERK_KEY}>
      <Outlet />
    </ClerkAuth>
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
    return (
      <div className="h-full" aria-busy="true">
        <ListSkeleton rows={8} />
      </div>
    );
  }
  if (auth.status === "signedOut") return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

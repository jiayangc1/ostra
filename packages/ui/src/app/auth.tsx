import { createContext, useContext, type ReactNode } from "react";

export interface AuthUser {
  name: string | null;
  email: string | null;
  imageUrl: string | null;
}

export interface AuthState {
  status: "loading" | "signedIn" | "signedOut";
  user: AuthUser | null;
  /** Fresh session token for the API. */
  getToken(): Promise<string | null>;
  signOut(): Promise<void>;
  /** Opens the account (Clerk profile) screen, when available. */
  openProfile?: () => void;
  /** Renders the sign-in / sign-up screens. */
  SignIn: () => ReactNode;
  SignUp: () => ReactNode;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ value, children }: { value: AuthState; children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthState(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthState must be used inside <AuthProvider>");
  return ctx;
}

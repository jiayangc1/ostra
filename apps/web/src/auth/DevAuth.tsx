import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { AuthLayout, AuthProvider, Button, Input, type AuthState } from "@ostra/ui";

const KEY = "ostra:dev-user";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Local development without Clerk keys. The API accepts `dev:<name>` tokens
 * only when it is also running without Clerk, and never in production.
 */
export function DevAuth({ children }: { children: ReactNode }) {
  const [name, setName] = useState<string | null>(read);
  const navigate = useNavigate();

  const signIn = useCallback(
    (n: string) => {
      const clean = n.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "you";
      try {
        localStorage.setItem(KEY, clean);
      } catch {
        // ignore
      }
      setName(clean);
      navigate("/");
    },
    [navigate],
  );

  const value = useMemo<AuthState>(() => {
    const Form = ({ title }: { title: string }) => <DevSignIn title={title} onSubmit={signIn} />;
    return {
      status: name ? "signedIn" : "signedOut",
      user: name ? { name, email: `${name}@dev.local`, imageUrl: null } : null,
      getToken: async () => (name ? `dev:${name}` : null),
      signOut: async () => {
        try {
          localStorage.removeItem(KEY);
        } catch {
          // ignore
        }
        setName(null);
      },
      SignIn: () => <Form title="Sign in to Ostra" />,
      SignUp: () => <Form title="Create your Ostra account" />,
    };
  }, [name, signIn]);

  return <AuthProvider value={value}>{children}</AuthProvider>;
}

function DevSignIn({ title, onSubmit }: { title: string; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("you");
  return (
    <AuthLayout footer="Development sign-in. Set VITE_CLERK_PUBLISHABLE_KEY to use Clerk.">
      <form
        className="flex w-80 flex-col gap-4 rounded-window border border-line bg-surface p-6"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
      >
        <h1 className="text-lg">{title}</h1>
        <Input label="Dev user" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <Button type="submit" variant="primary">
          Continue
        </Button>
      </form>
    </AuthLayout>
  );
}

import type { ReactNode } from "react";
import { OstraMark } from "../brand/logo.tsx";

/** Frame for sign-in / sign-up: centered, quiet, mark above. */
export function AuthLayout({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-8 bg-canvas px-4 py-12">
      <div className="flex animate-slide-up flex-col items-center gap-8">
        <OstraMark size={36} className="text-fg" />
        {children}
      </div>
      {footer && <div className="text-[13px] text-fg-3">{footer}</div>}
    </main>
  );
}

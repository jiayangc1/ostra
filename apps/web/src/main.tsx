import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@ostra/ui/styles.css";
import { DesignPreview, ThemeProvider, ToastProvider } from "@ostra/ui";
import { RequireAuth, Root, SignInRoute, SignUpRoute } from "./Root.tsx";
import { AppRoutes } from "./AppRoutes.tsx";

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/sign-in/*", element: <SignInRoute /> },
      { path: "/sign-up/*", element: <SignUpRoute /> },
      ...(import.meta.env.DEV ? [{ path: "/design", element: <DesignPreview /> }] : []),
      { element: <RequireAuth />, children: [{ path: "*", element: <AppRoutes /> }] },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@ostra/ui/styles.css";
import { DesignPreview, ThemeProvider, ToastProvider } from "@ostra/ui";

const router = createBrowserRouter([
  { path: "/design", element: <DesignPreview /> },
  { path: "*", element: <DesignPreview /> },
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

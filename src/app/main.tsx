import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { store } from "@/app/store";
import { queryClient } from "@/app/api/queryClient";
import { startSilentRefresh } from "@/features/auth/silentRefresh";
import { AuthProvider } from "@/features/auth/AuthContext";
import { ThemeProvider } from "@/shared/theme/ThemeContext";
import { App } from "@/app/App";
import "@/shared/styles/globals.css";

async function enableMocking(): Promise<void> {
  // E2E runs set VITE_DISABLE_MSW so Playwright's page.route() owns the
  // network; the MSW service worker would otherwise answer first.
  if (!import.meta.env.DEV || import.meta.env["VITE_DISABLE_MSW"] === "true") return;
  try {
    const { worker } = await import("@/shared/mocks/browser");
    await worker.start({ onUnhandledRequest: "bypass" });
  } catch (error) {
    console.error("MSW failed to start; continuing without API mocks.", error);
  }
}

startSilentRefresh(store);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

void enableMocking().then(() => {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <App />
            </AuthProvider>
            <ReactQueryDevtools initialIsOpen={false} />
          </QueryClientProvider>
        </Provider>
      </ThemeProvider>
    </StrictMode>,
  );
});

import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureStore } from "@reduxjs/toolkit";
import { authSlice } from "@/entities/session/authSlice";
import { baseApi } from "@/shared/api/baseApi";
import { ApiClientProvider } from "@/shared/api/ApiClientProvider";
import { createStubApiClient } from "@/shared/api/createStubApiClient";
import type { ApiClient } from "@/shared/api/apiClient";

export function makeStore() {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
  });
}

export type TestStore = ReturnType<typeof makeStore>;

interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  store?: TestStore;
  /**
   * The client `useApiClient()` will return.
   *
   * Defaults to a stub with *no routes*, so a component that makes an
   * unexpected request fails naming the route it wanted rather than hanging or
   * reaching the network. A test that wants a response passes its own stub and
   * keeps the handle, which is also how it asserts on the calls that were made.
   */
  apiClient?: ApiClient;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    store = makeStore(),
    apiClient = createStubApiClient(),
    ...options
  }: RenderWithProvidersOptions = {},
) {
  const testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={store}>
        <QueryClientProvider client={testQueryClient}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </Provider>
    );
  }

  return { store, apiClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

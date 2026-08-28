import { describe, it, expect, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiClientProvider } from "@/shared/api/ApiClientProvider";
import { useApiClient } from "@/shared/api/apiClientContext";
import { createStubApiClient } from "@/shared/api/createStubApiClient";

describe("useApiClient", () => {
  it("returns the client published by the nearest provider", () => {
    const client = createStubApiClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    );

    const { result } = renderHook(() => useApiClient(), { wrapper });

    expect(result.current).toBe(client);
  });

  it("throws outside a provider rather than falling back to a real client", () => {
    // The whole reason the context default is `null`. A default that worked
    // would let a component rendered outside the provider make real requests
    // from a green test suite.
    function Consumer() {
      useApiClient();
      return null;
    }

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => {
        render(<Consumer />);
      }).toThrow(/must be used inside an <ApiClientProvider>/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("lets an inner provider override an outer one for its subtree", () => {
    const outer = createStubApiClient({ routes: { "GET /who": "outer" } });
    const inner = createStubApiClient({ routes: { "GET /who": "inner" } });

    function Consumer({ label }: { label: string }) {
      const client = useApiClient();
      return <span data-testid={label}>{client === outer ? "outer" : "inner"}</span>;
    }

    render(
      <ApiClientProvider client={outer}>
        <Consumer label="above" />
        <ApiClientProvider client={inner}>
          <Consumer label="below" />
        </ApiClientProvider>
      </ApiClientProvider>,
    );

    expect(screen.getByTestId("above")).toHaveTextContent("outer");
    expect(screen.getByTestId("below")).toHaveTextContent("inner");
  });
});

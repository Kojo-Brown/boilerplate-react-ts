import { describe, it, expect, act } from "vitest";
import { renderHook } from "@testing-library/react";
import { QUERY_ERROR_EVENT, type QueryErrorDetail } from "@/api/queryClient";
import { useGlobalQueryError } from "./useGlobalQueryError";

function fireQueryError(message: string) {
  window.dispatchEvent(
    new CustomEvent<QueryErrorDetail>(QUERY_ERROR_EVENT, { detail: { message } }),
  );
}

describe("useGlobalQueryError", () => {
  it("initializes with null error", () => {
    const { result } = renderHook(() => useGlobalQueryError());
    expect(result.current.error).toBeNull();
  });

  it("captures error message when query:error fires", () => {
    const { result } = renderHook(() => useGlobalQueryError());

    act(() => fireQueryError("Something went wrong"));

    expect(result.current.error).toBe("Something went wrong");
  });

  it("clears error when clearError is called", () => {
    const { result } = renderHook(() => useGlobalQueryError());

    act(() => fireQueryError("Some error"));
    expect(result.current.error).toBe("Some error");

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("updates to latest error on subsequent events", () => {
    const { result } = renderHook(() => useGlobalQueryError());

    act(() => fireQueryError("First error"));
    expect(result.current.error).toBe("First error");

    act(() => fireQueryError("Second error"));
    expect(result.current.error).toBe("Second error");
  });

  it("stops listening after unmount", () => {
    const { result, unmount } = renderHook(() => useGlobalQueryError());

    unmount();

    act(() => fireQueryError("Post-unmount error"));

    expect(result.current.error).toBeNull();
  });
});

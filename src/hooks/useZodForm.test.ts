import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { z } from "zod";
import { useZodForm } from "./useZodForm";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  age: z.number().min(0, "Age must be non-negative"),
});

describe("useZodForm", () => {
  it("initialises with provided default values", () => {
    const { result } = renderHook(() =>
      useZodForm(schema, { defaultValues: { name: "Alice", age: 30 } }),
    );
    expect(result.current.getValues()).toEqual({ name: "Alice", age: 30 });
  });

  it("starts with no validation errors", () => {
    const { result } = renderHook(() =>
      useZodForm(schema, { defaultValues: { name: "", age: 0 } }),
    );
    expect(result.current.formState.errors).toEqual({});
  });

  it("populates errors for failing fields after submit attempt", async () => {
    const { result } = renderHook(() =>
      useZodForm(schema, { defaultValues: { name: "", age: 0 } }),
    );

    await act(async () => {
      await result.current.handleSubmit(vi.fn())();
    });

    expect(result.current.formState.errors.name?.message).toBe("Name is required");
  });

  it("calls submit handler with parsed values when form is valid", async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useZodForm(schema, { defaultValues: { name: "Bob", age: 25 } }),
    );

    await act(async () => {
      await result.current.handleSubmit(onSubmit)();
    });

    expect(onSubmit).toHaveBeenCalledWith(
      { name: "Bob", age: 25 },
      expect.anything(),
    );
  });

  it("does not call submit handler when form is invalid", async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useZodForm(schema, { defaultValues: { name: "", age: 0 } }),
    );

    await act(async () => {
      await result.current.handleSubmit(onSubmit)();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

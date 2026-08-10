import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  emptyValues,
  fieldErrorsFromZod,
  firstFieldError,
  formFailed,
  formSucceeded,
  idleFormState,
  readFormValues,
} from "@/lib/formState";

const FIELDS = ["email", "role", "note"] as const;
type Field = (typeof FIELDS)[number];

describe("emptyValues", () => {
  it("maps every declared field to an empty string", () => {
    expect(emptyValues(FIELDS)).toEqual({ email: "", role: "", note: "" });
  });

  it("returns a fresh object each call", () => {
    expect(emptyValues(FIELDS)).not.toBe(emptyValues(FIELDS));
  });
});

describe("idleFormState", () => {
  it("starts with no message, no errors, and empty values", () => {
    expect(idleFormState(FIELDS)).toEqual({
      status: "idle",
      message: null,
      fieldErrors: {},
      values: { email: "", role: "", note: "" },
    });
  });
});

describe("readFormValues", () => {
  it("reads the declared fields as strings", () => {
    const formData = new FormData();
    formData.set("email", "ada@example.com");
    formData.set("role", "admin");
    formData.set("note", "Welcome!");

    expect(readFormValues(formData, FIELDS)).toEqual({
      email: "ada@example.com",
      role: "admin",
      note: "Welcome!",
    });
  });

  it("falls back to an empty string for a field the form did not submit", () => {
    const formData = new FormData();
    formData.set("email", "ada@example.com");

    expect(readFormValues(formData, FIELDS)).toEqual({
      email: "ada@example.com",
      role: "",
      note: "",
    });
  });

  it("ignores entries the form submitted that were not declared", () => {
    const formData = new FormData();
    formData.set("email", "ada@example.com");
    formData.set("csrf", "mock-csrf-token");

    expect(readFormValues(formData, FIELDS)).not.toHaveProperty("csrf");
  });

  it("does not leak a File into a shape that promises strings", () => {
    const formData = new FormData();
    formData.set("note", new File(["fake"], "note.txt", { type: "text/plain" }));

    expect(readFormValues(formData, FIELDS).note).toBe("");
  });

  it("preserves whitespace exactly as typed", () => {
    const formData = new FormData();
    formData.set("email", "  ada@example.com  ");

    expect(readFormValues(formData, FIELDS).email).toBe("  ada@example.com  ");
  });
});

describe("formFailed", () => {
  it("carries the submitted values back so the fields can be repopulated", () => {
    const values = { email: "not-an-email", role: "admin", note: "" };

    expect(formFailed(values, { fieldErrors: { email: "Enter a valid email address." } })).toEqual({
      status: "error",
      message: null,
      fieldErrors: { email: "Enter a valid email address." },
      values,
    });
  });

  it("supports a form-level message with no field to blame", () => {
    const state = formFailed(emptyValues(FIELDS), { message: "The service is unavailable." });

    expect(state.message).toBe("The service is unavailable.");
    expect(state.fieldErrors).toEqual({});
  });

  it("defaults to no message and no field errors", () => {
    const state = formFailed(emptyValues(FIELDS));

    expect(state).toMatchObject({ status: "error", message: null, fieldErrors: {} });
  });
});

describe("formSucceeded", () => {
  it("clears the values so the reset leaves a blank form", () => {
    expect(formSucceeded(FIELDS, "Invitation sent.")).toEqual({
      status: "success",
      message: "Invitation sent.",
      fieldErrors: {},
      values: { email: "", role: "", note: "" },
    });
  });
});

describe("firstFieldError", () => {
  it("returns the first failing field in declaration order, not key order", () => {
    // `note` is inserted first; `email` is declared first and is what a caller
    // moving focus has to be given.
    expect(firstFieldError(FIELDS, { note: "Too long.", email: "Invalid." })).toBe("email");
  });

  it("returns null when nothing failed", () => {
    expect(firstFieldError(FIELDS, {})).toBeNull();
  });
});

describe("fieldErrorsFromZod", () => {
  const schema = z.object({
    email: z.email({ message: "Enter a valid email address." }),
    role: z.enum(["member", "admin"], { message: "Choose a role." }),
    note: z.string().max(5, "Too long."),
  });

  function errorFor(input: Record<string, unknown>): z.ZodError {
    const parsed = schema.safeParse(input);
    if (parsed.success) throw new Error("expected the schema to reject this input");
    return parsed.error;
  }

  it("maps each failing field to its message", () => {
    const fieldErrors = fieldErrorsFromZod<Field>(
      errorFor({ email: "nope", role: "owner", note: "far too long" }),
      FIELDS,
    );

    expect(fieldErrors).toEqual({
      email: "Enter a valid email address.",
      role: "Choose a role.",
      note: "Too long.",
    });
  });

  it("keeps only the first issue for a field", () => {
    const twoIssues = z.object({
      email: z.string().min(5, "First problem.").endsWith("@example.com", "Second problem."),
    });
    const parsed = twoIssues.safeParse({ email: "a@b" });
    if (parsed.success) throw new Error("expected the schema to reject this input");

    expect(parsed.error.issues.length).toBeGreaterThan(1);
    expect(fieldErrorsFromZod<Field>(parsed.error, FIELDS).email).toBe("First problem.");
  });

  it("drops issues that do not name a declared field", () => {
    const withExtra = z.object({ surprise: z.string() });
    const parsed = withExtra.safeParse({});
    if (parsed.success) throw new Error("expected the schema to reject this input");

    expect(fieldErrorsFromZod<Field>(parsed.error, FIELDS)).toEqual({});
  });

  it("drops a root-level issue, which has no path at all", () => {
    const parsed = schema.safeParse("not an object");
    if (parsed.success) throw new Error("expected the schema to reject this input");

    expect(fieldErrorsFromZod<Field>(parsed.error, FIELDS)).toEqual({});
  });
});

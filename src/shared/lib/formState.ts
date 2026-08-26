import type { ZodError } from "zod";

/** One message per field, keyed by the field's `name` attribute. */
export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

/**
 * `idle` is the state before anything has been submitted, and is distinct from
 * `success` — a form that has never run and a form that succeeded both have no
 * errors, but only one of them should be congratulating the user.
 */
export type FormStatus = "idle" | "success" | "error";

/**
 * The state an `useActionState` action returns.
 *
 * `values` is the part that looks redundant and is not. React resets an
 * uncontrolled form once its action settles, so a rejected submission would
 * otherwise hand the user an empty form and ask them to type it all again.
 * Echoing the submitted values back and feeding them to `defaultValue` is what
 * survives the reset — see the note on {@link formFailed}.
 */
export interface FormState<Field extends string> {
  readonly status: FormStatus;
  /** Form-level message: the outcome as a whole, not one field's problem. */
  readonly message: string | null;
  readonly fieldErrors: FieldErrors<Field>;
  /** What was submitted, echoed back so the fields can be repopulated. */
  readonly values: Readonly<Record<Field, string>>;
}

/** Every field mapped to `""`. */
export function emptyValues<Field extends string>(fields: readonly Field[]): Record<Field, string> {
  // `Object.fromEntries` cannot preserve the key union, and building the object
  // key by key needs the same assertion one line later. One cast, stated once.
  return Object.fromEntries(fields.map((field) => [field, ""])) as Record<Field, string>;
}

/** The state to pass as `useActionState`'s initial value. */
export function idleFormState<Field extends string>(fields: readonly Field[]): FormState<Field> {
  return { status: "idle", message: null, fieldErrors: {}, values: emptyValues(fields) };
}

/**
 * Pulls the declared fields out of a `FormData` as strings.
 *
 * A `<input type="file">` entry yields a `File`, and a field the browser did
 * not submit yields `null`; both become `""` rather than leaking a non-string
 * into a shape that promises strings. Values are returned exactly as typed —
 * trimming belongs to validation, where the user can be told about it.
 */
export function readFormValues<Field extends string>(
  formData: FormData,
  fields: readonly Field[],
): Record<Field, string> {
  const values = emptyValues(fields);
  for (const field of fields) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw : "";
  }
  return values;
}

export interface FormFailure<Field extends string> {
  /** Form-level message. Omit when every problem belongs to a field. */
  readonly message?: string | undefined;
  readonly fieldErrors?: FieldErrors<Field> | undefined;
}

/**
 * A failed submission, carrying the values back to the inputs.
 *
 * Pass the values that were actually submitted, not the parsed ones: the point
 * is to hand the user back exactly what they typed, including the part that
 * failed validation.
 */
export function formFailed<Field extends string>(
  values: Readonly<Record<Field, string>>,
  failure: FormFailure<Field> = {},
): FormState<Field> {
  return {
    status: "error",
    message: failure.message ?? null,
    fieldErrors: failure.fieldErrors ?? {},
    values,
  };
}

/**
 * A successful submission.
 *
 * The values go back to empty on purpose — React's post-action reset then
 * leaves a genuinely blank form instead of one still holding the invitation
 * that has already been sent.
 */
export function formSucceeded<Field extends string>(
  fields: readonly Field[],
  message: string,
): FormState<Field> {
  return { status: "success", message, fieldErrors: {}, values: emptyValues(fields) };
}

/**
 * The first field with an error, in the order the fields are declared.
 *
 * Declaration order rather than `Object.keys` order, because the caller's
 * reason for asking is almost always "which control should I focus?" and the
 * answer has to be the first one on screen.
 */
export function firstFieldError<Field extends string>(
  fields: readonly Field[],
  fieldErrors: FieldErrors<Field>,
): Field | null {
  return fields.find((field) => fieldErrors[field] !== undefined) ?? null;
}

/**
 * The same errors without the one belonging to `field`.
 *
 * Used when a control changes: the message under it has to go away at that
 * moment rather than at the next submit, because a user who fixes a field and
 * is still told it is wrong reads the form as having ignored them.
 *
 * Written as a rebuild rather than `delete next[field]` because the key is a
 * variable, and a dynamic `delete` on a typed record is both a lint error here
 * and a deoptimisation in every engine.
 */
export function clearFieldError<Field extends string>(
  fieldErrors: FieldErrors<Field>,
  field: Field,
): FieldErrors<Field> {
  const remaining: FieldErrors<Field> = {};
  // `Object.keys` widens to `string[]`; the keys of a `Partial<Record<Field, …>>`
  // are `Field` by construction, and there is no built-in that says so.
  for (const key of Object.keys(fieldErrors) as Field[]) {
    if (key !== field) remaining[key] = fieldErrors[key];
  }
  return remaining;
}

/**
 * Flattens a Zod error into one message per known field.
 *
 * Only the first issue per field survives: a control can display one message,
 * and "Enter a work email address." followed by "Must be at least 3
 * characters." is a worse answer than either half alone. Issues whose path does
 * not name a declared field are dropped — they belong to the schema's shape,
 * not to a control the user can fix.
 */
export function fieldErrorsFromZod<Field extends string>(
  error: ZodError,
  fields: readonly Field[],
): FieldErrors<Field> {
  const fieldErrors: FieldErrors<Field> = {};
  for (const issue of error.issues) {
    const [key] = issue.path;
    if (typeof key !== "string") continue;
    const field = fields.find((candidate) => candidate === key);
    if (field !== undefined && fieldErrors[field] === undefined) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}

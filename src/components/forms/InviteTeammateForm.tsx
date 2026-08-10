import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { z } from "zod";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { cn } from "@/lib/cn";
import {
  fieldErrorsFromZod,
  firstFieldError,
  formFailed,
  formSucceeded,
  idleFormState,
  readFormValues,
  type FieldErrors,
  type FormState,
} from "@/lib/formState";
import {
  InviteRejectedError,
  ROLE_LABELS,
  TEAM_ROLES,
  type InviteApi,
  type TeamRole,
} from "@/lib/inviteApi";

const INVITE_FIELDS = ["email", "role", "note"] as const;

type InviteField = (typeof INVITE_FIELDS)[number];

/** The maximum note length, enforced by the schema and shown as a hint. */
const NOTE_MAX_LENGTH = 140;

const inviteSchema = z.object({
  email: z.email({ message: "Enter a valid email address." }),
  role: z.enum(TEAM_ROLES, { message: "Choose a role." }),
  note: z.string().max(NOTE_MAX_LENGTH, `Keep the note under ${NOTE_MAX_LENGTH} characters.`),
});

const IDLE_STATE = idleFormState(INVITE_FIELDS);

export interface InviteTeammateFormProps {
  api: InviteApi;
  className?: string | undefined;
}

/**
 * An invite form with no submit-state bookkeeping of its own.
 *
 * There is no `isSubmitting`, no `setError`, no `try/finally` resetting a flag
 * — the three things a hand-rolled form spends most of its code on. The action
 * is an ordinary async function that takes the `FormData` and returns the next
 * state; React owns when it runs, whether it is still running, and what the UI
 * shows meanwhile. Compare `<LoginForm>`, which wires the same concerns up by
 * hand through React Hook Form.
 *
 * Both kinds of failure end up in the same shape. Schema problems are found
 * before the request; a duplicate address is only known by the server and
 * arrives as a rejection. `InviteRejectedError.field` decides whether a message
 * lands under a control or at the top of the form, so that judgement is made
 * once, by the side that can actually make it.
 *
 * Two React 19 behaviours drive the rest of the file:
 *
 * 1. **React resets the form once the action settles.** That is the right
 *    default for a success and actively hostile on a failure — the user is
 *    handed an empty form and asked to retype the thing that was rejected. The
 *    action echoes the submitted values back in `state.values` and every
 *    control reads its `defaultValue` from there, so the reset restores what
 *    was typed instead of wiping it. On success the echo is empty, so the same
 *    mechanism clears the form.
 * 2. **`useFormStatus` only reports to descendants of the `<form>`.** Calling
 *    it here would return `pending: false` forever, with no warning. That is
 *    why `<SubmitButton>` and `<SubmittingNotice>` are separate components.
 *
 * Usage:
 *   <InviteTeammateForm api={createInMemoryInviteApi()} />
 */
export function InviteTeammateForm({ api, className }: InviteTeammateFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const [state, formAction] = useActionState<FormState<InviteField>, FormData>(
    async (_previous, formData) => {
      const values = readFormValues(formData, INVITE_FIELDS);

      const parsed = inviteSchema.safeParse(values);
      if (!parsed.success) {
        return formFailed(values, { fieldErrors: fieldErrorsFromZod(parsed.error, INVITE_FIELDS) });
      }

      try {
        const invite = await api.invite(parsed.data);
        return formSucceeded(
          INVITE_FIELDS,
          `Invitation sent to ${invite.email} as ${ROLE_LABELS[invite.role].toLowerCase()}.`,
        );
      } catch (cause) {
        return formFailed(values, toFailure(cause));
      }
    },
    IDLE_STATE,
  );

  // Sending focus to the problem is the difference between an accessible form
  // and a form that merely renders an error. The dependency is the whole state
  // object on purpose: `useActionState` returns a new object for every
  // submission, so submitting the same invalid value twice re-runs this and
  // focus lands again. Narrowing the dependency to `state.status` — the
  // tempting simplification, since that is the value being read first — would
  // break exactly that case, because a second failure leaves it on `"error"`.
  useEffect(() => {
    if (state.status !== "error") return;

    const field = firstFieldError(INVITE_FIELDS, state.fieldErrors);
    const control = field === null ? null : formRef.current?.elements.namedItem(field);
    if (control instanceof HTMLElement) {
      control.focus();
    } else {
      alertRef.current?.focus();
    }
  }, [state]);

  const { email, role, note } = state.values;

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      data-testid="invite-form"
      className={cn("flex flex-col gap-4", className)}
    >
      <FormField label="Email" error={state.fieldErrors.email} required>
        <Input
          type="email"
          name="email"
          // Not `value` — a controlled input would need its own state and its
          // own reset, which is the bookkeeping this pattern removes.
          defaultValue={email}
          placeholder="teammate@example.com"
          autoComplete="off"
          error={state.fieldErrors.email !== undefined}
          aria-invalid={state.fieldErrors.email !== undefined}
          data-testid="invite-email"
        />
      </FormField>

      <FormField label="Role" error={state.fieldErrors.role} required>
        <select
          // `<select>` is the one control the echo-into-`defaultValue` trick
          // does not reach. React keeps an `<input>`/`<textarea>`'s
          // `defaultValue` in sync after mount, so the post-action reset
          // restores the echoed value — but it never propagates a changed
          // `defaultValue` here onto the options' `defaultSelected`, so the
          // reset restores whichever option was selected at *mount* and the
          // user's choice is silently thrown away. Keying on the echoed value
          // remounts the select, which is the only point at which React applies
          // it. Cheap: two options, and it only changes when a submission has
          // already re-rendered the form.
          key={role}
          name="role"
          defaultValue={isTeamRole(role) ? role : "member"}
          aria-invalid={state.fieldErrors.role !== undefined}
          data-testid="invite-role"
          className={cn(
            "h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]",
            "bg-[var(--color-bg)] px-3 text-sm text-[var(--color-fg)]",
            "focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1 focus:outline-none",
          )}
        >
          {TEAM_ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Note"
        error={state.fieldErrors.note}
        hint={`Optional. Up to ${NOTE_MAX_LENGTH} characters.`}
      >
        <textarea
          name="note"
          rows={3}
          defaultValue={note}
          placeholder="Anything they should know before joining?"
          aria-invalid={state.fieldErrors.note !== undefined}
          data-testid="invite-note"
          className={cn(
            "w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border)]",
            "bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]",
            "placeholder:text-[var(--color-muted-fg)]",
            "focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1 focus:outline-none",
          )}
        />
      </FormField>

      {state.status === "error" && state.message !== null && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          data-testid="invite-error"
          className={cn(
            "rounded-[var(--radius-md)] border border-[var(--color-danger)] px-3 py-2",
            "text-sm text-[var(--color-fg)] focus-visible:outline-2",
            "focus-visible:outline-offset-2 focus-visible:outline-[var(--color-danger)]",
          )}
        >
          <strong className="font-semibold">Invitation not sent.</strong> {state.message}
        </div>
      )}

      {state.status === "success" && state.message !== null && (
        <p
          role="status"
          data-testid="invite-success"
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg)]"
        >
          {state.message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Sending…">Send invite</SubmitButton>
        <SubmittingNotice />
      </div>
    </form>
  );
}

/**
 * Turns whatever the API threw into the two things the form can show.
 *
 * A rejection that names a field becomes that field's error; anything else —
 * including a failure the fake server does not model — becomes a form-level
 * message, because attributing an unknown error to a control would tell the
 * user to fix something that is not wrong.
 */
function toFailure(cause: unknown): { message?: string; fieldErrors?: FieldErrors<InviteField> } {
  if (cause instanceof InviteRejectedError && cause.field !== null) {
    const fieldErrors: FieldErrors<InviteField> = {};
    fieldErrors[cause.field] = cause.message;
    return { fieldErrors };
  }
  return { message: cause instanceof Error ? cause.message : String(cause) };
}

function isTeamRole(value: string): value is TeamRole {
  return TEAM_ROLES.some((role) => role === value);
}

/**
 * Reads *what* is being submitted, not just that something is.
 *
 * `useFormStatus().data` is the `FormData` of the in-flight submission, which
 * is how a descendant can name the pending work without the form passing it
 * down. The return type is a discriminated union on `pending`, so the early
 * return below is also what narrows `data` away from `null` — no optional
 * chaining needed, and nothing renders at rest.
 */
function SubmittingNotice() {
  const status = useFormStatus();
  if (!status.pending) return null;

  const email = status.data.get("email");
  return (
    <span
      role="status"
      data-testid="submitting-notice"
      className="text-sm text-[var(--color-muted-fg)]"
    >
      {typeof email === "string" && email !== ""
        ? `Sending invite to ${email}…`
        : "Sending invite…"}
    </span>
  );
}

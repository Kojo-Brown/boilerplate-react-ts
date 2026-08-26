import { act } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteTeammateForm } from "@/features/invite/InviteTeammateForm";
import {
  createInMemoryInviteApi,
  InviteRejectedError,
  type Invite,
  type InviteApi,
  type InviteInput,
} from "@/features/invite/inviteApi";

type User = ReturnType<typeof userEvent.setup>;

const email = (): HTMLInputElement => screen.getByTestId("invite-email");
const note = (): HTMLTextAreaElement => screen.getByTestId("invite-note");
const role = (): HTMLSelectElement => screen.getByTestId("invite-role");
const submit = (): HTMLButtonElement => screen.getByTestId("submit-button");

async function fillAndSubmit(
  user: User,
  values: { email?: string; role?: string; note?: string } = {},
): Promise<void> {
  if (values.email !== undefined) await user.type(email(), values.email);
  if (values.note !== undefined) await user.type(note(), values.note);
  if (values.role !== undefined) await user.selectOptions(role(), values.role);
  await user.click(submit());
}

/** An API whose single call finishes only when the test releases it. */
function createDeferredApi(): { api: InviteApi; settle: () => Promise<void> } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    api: {
      async invite(input: InviteInput): Promise<Invite> {
        await gate;
        return { id: "invite-1", email: input.email, role: input.role, note: input.note };
      },
    },
    settle: async () => {
      await act(async () => {
        release();
        await gate;
      });
    },
  };
}

describe("InviteTeammateForm", () => {
  it("starts with no message and an enabled button", () => {
    render(<InviteTeammateForm api={createInMemoryInviteApi()} />);

    expect(screen.queryByTestId("invite-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invite-success")).not.toBeInTheDocument();
    expect(submit()).toHaveTextContent("Send invite");
    expect(submit()).toBeEnabled();
  });

  it("sends the invitation and reports it", async () => {
    const user = userEvent.setup();
    const invite = vi.fn(createInMemoryInviteApi().invite);
    render(<InviteTeammateForm api={{ invite }} />);

    await fillAndSubmit(user, { email: "grace@example.com", role: "admin", note: "Welcome!" });

    expect(await screen.findByTestId("invite-success")).toHaveTextContent(
      "Invitation sent to grace@example.com as admin.",
    );
    expect(invite).toHaveBeenCalledWith({
      email: "grace@example.com",
      role: "admin",
      note: "Welcome!",
    });
  });

  it("clears the fields after a success", async () => {
    // React resets the form once the action settles, and the success state
    // echoes empty values back — so the reset restores emptiness rather than
    // the invitation that was just sent.
    const user = userEvent.setup();
    render(<InviteTeammateForm api={createInMemoryInviteApi()} />);

    await fillAndSubmit(user, { email: "grace@example.com", note: "Welcome!" });

    await screen.findByTestId("invite-success");
    expect(email().value).toBe("");
    expect(note().value).toBe("");
  });

  it("rejects a malformed address without calling the API", async () => {
    const user = userEvent.setup();
    const invite = vi.fn<InviteApi["invite"]>();
    render(<InviteTeammateForm api={{ invite }} />);

    await fillAndSubmit(user, { email: "not-an-email" });

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(invite).not.toHaveBeenCalled();
  });

  it("keeps what the user typed when validation fails", async () => {
    // The reset React performs after the action would otherwise hand back an
    // empty form and ask the user to retype the value that was rejected. The
    // action echoes the submitted values into `defaultValue`, which is what
    // survives the reset.
    const user = userEvent.setup();
    render(<InviteTeammateForm api={createInMemoryInviteApi()} />);

    await fillAndSubmit(user, { email: "not-an-email", note: "Join us" });

    await screen.findByText("Enter a valid email address.");
    expect(email().value).toBe("not-an-email");
    expect(note().value).toBe("Join us");
  });

  it("keeps the selected role when validation fails", async () => {
    // The select needs more than the echoed `defaultValue` the other controls
    // get: React never applies a changed `defaultValue` to an already-mounted
    // `<select>`, so without a remount the reset would restore "member" and
    // quietly discard the choice.
    const user = userEvent.setup();
    render(<InviteTeammateForm api={createInMemoryInviteApi()} />);

    await fillAndSubmit(user, { email: "not-an-email", role: "admin" });

    await screen.findByText("Enter a valid email address.");
    expect(role().value).toBe("admin");
  });

  it("rejects a note over the length limit", async () => {
    const user = userEvent.setup();
    render(<InviteTeammateForm api={createInMemoryInviteApi()} />);

    await user.type(email(), "grace@example.com");
    // Typing 141 characters through userEvent is slow and adds nothing; the
    // value is set directly and the form is submitted with it.
    await user.click(note());
    await user.paste("x".repeat(141));
    await user.click(submit());

    expect(await screen.findByText("Keep the note under 140 characters.")).toBeInTheDocument();
  });

  it("puts a server-side rejection under the field the server blamed", async () => {
    // Nothing in the browser can know this address is already on the team, so
    // this error can only arrive after the request — which is the reason the
    // form needs somewhere to put a late error at all.
    const user = userEvent.setup();
    const api = createInMemoryInviteApi({ existingEmails: ["ada@example.com"] });
    render(<InviteTeammateForm api={api} />);

    await fillAndSubmit(user, { email: "ada@example.com" });

    expect(await screen.findByText("ada@example.com is already on the team.")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-error")).not.toBeInTheDocument();
    expect(email()).toHaveAttribute("aria-invalid", "true");
  });

  it("puts a rejection that blames no field at the top of the form", async () => {
    const user = userEvent.setup();
    const api = createInMemoryInviteApi({ failWhen: () => "The invitation service is down." });
    render(<InviteTeammateForm api={api} />);

    await fillAndSubmit(user, { email: "grace@example.com" });

    expect(await screen.findByTestId("invite-error")).toHaveTextContent(
      "The invitation service is down.",
    );
    expect(email()).toHaveAttribute("aria-invalid", "false");
  });

  it("keeps the submitted values when the server rejects", async () => {
    const user = userEvent.setup();
    const api = createInMemoryInviteApi({ failWhen: () => "The invitation service is down." });
    render(<InviteTeammateForm api={api} />);

    await fillAndSubmit(user, { email: "grace@example.com", note: "Welcome!" });

    await screen.findByTestId("invite-error");
    expect(email().value).toBe("grace@example.com");
    expect(note().value).toBe("Welcome!");
  });

  it("reports a non-Error rejection rather than swallowing it", async () => {
    const user = userEvent.setup();
    const invite = vi.fn<InviteApi["invite"]>().mockRejectedValue("connection reset");
    render(<InviteTeammateForm api={{ invite }} />);

    await fillAndSubmit(user, { email: "grace@example.com" });

    expect(await screen.findByTestId("invite-error")).toHaveTextContent("connection reset");
  });

  it("treats a rejection naming an unexpected field as form-level", async () => {
    const user = userEvent.setup();
    const invite = vi
      .fn<InviteApi["invite"]>()
      .mockRejectedValue(new InviteRejectedError("Something went wrong.", null));
    render(<InviteTeammateForm api={{ invite }} />);

    await fillAndSubmit(user, { email: "grace@example.com" });

    expect(await screen.findByTestId("invite-error")).toHaveTextContent("Something went wrong.");
  });

  it("moves focus to the first invalid control", async () => {
    const user = userEvent.setup();
    render(<InviteTeammateForm api={createInMemoryInviteApi()} />);

    await fillAndSubmit(user, { email: "not-an-email" });

    await waitFor(() => {
      expect(email()).toHaveFocus();
    });
  });

  it("moves focus again when the same invalid value is submitted twice", async () => {
    // `status` stays on "error" across both failures, so an effect keyed on it
    // would fire once and leave the second submission with focus stranded on
    // the button. Keying on the state object — new for every submission —
    // is what makes the second attempt behave like the first.
    const user = userEvent.setup();
    render(<InviteTeammateForm api={createInMemoryInviteApi()} />);

    await fillAndSubmit(user, { email: "not-an-email" });
    await waitFor(() => {
      expect(email()).toHaveFocus();
    });

    // Clicking the button takes focus off the input; only the effect running a
    // second time can put it back.
    await user.click(submit());

    await waitFor(() => {
      expect(email()).toHaveFocus();
    });
  });

  it("moves focus to the alert when no field can be blamed", async () => {
    const user = userEvent.setup();
    const api = createInMemoryInviteApi({ failWhen: () => "The invitation service is down." });
    render(<InviteTeammateForm api={api} />);

    await fillAndSubmit(user, { email: "grace@example.com" });

    await waitFor(() => {
      expect(screen.getByTestId("invite-error")).toHaveFocus();
    });
  });

  it("names the address being sent while the request is in flight", async () => {
    // `useFormStatus().data` is the in-flight FormData, so a descendant can
    // describe the pending work without the form passing anything down.
    const user = userEvent.setup();
    const { api, settle } = createDeferredApi();
    render(<InviteTeammateForm api={api} />);

    await fillAndSubmit(user, { email: "grace@example.com" });

    expect(screen.getByTestId("submitting-notice")).toHaveTextContent(
      "Sending invite to grace@example.com…",
    );
    expect(submit()).toHaveTextContent("Sending…");
    expect(submit()).toBeDisabled();

    await settle();

    await waitFor(() => {
      expect(screen.queryByTestId("submitting-notice")).not.toBeInTheDocument();
    });
    expect(submit()).toBeEnabled();
  });

  it("clears a previous error once the next attempt succeeds", async () => {
    const user = userEvent.setup();
    const api = createInMemoryInviteApi({ existingEmails: ["ada@example.com"] });
    render(<InviteTeammateForm api={api} />);

    await fillAndSubmit(user, { email: "ada@example.com" });
    await screen.findByText("ada@example.com is already on the team.");

    await user.clear(email());
    await fillAndSubmit(user, { email: "grace@example.com" });

    await screen.findByTestId("invite-success");
    expect(screen.queryByText("ada@example.com is already on the team.")).not.toBeInTheDocument();
  });
});

import type { Politeness } from "@/shared/a11y/announcer";

/** How a toast presents itself, and — see {@link toastPoliteness} — how urgent it is. */
export type ToastVariant = "default" | "success" | "warning" | "danger";

/**
 * Which queue a toast is announced through, from its variant.
 *
 * The variant is the right default because on this component it is already a
 * claim about urgency: `warning` and `danger` are the two that say something has
 * gone or is going wrong, and those are the two worth interrupting for.
 * `success` is the one people reach for assertive on by reflex — every save
 * cutting off whatever the user was reading, to tell them the thing they asked
 * for happened.
 */
export function toastPoliteness(variant: ToastVariant): Politeness {
  return variant === "danger" || variant === "warning" ? "assertive" : "polite";
}

/**
 * What the live region says for a toast.
 *
 * Title and description in one string rather than two announcements, because
 * they are one message: "Upload failed" followed as a separate utterance by
 * "The file is larger than 10 MB" can be interleaved with anything else in the
 * queue, and a reason that arrives detached from what it is a reason for is
 * worse than no reason.
 */
export function toastAnnouncement(title: string, description?: string): string {
  return description === undefined || description.trim() === ""
    ? title
    : `${title}. ${description}`;
}

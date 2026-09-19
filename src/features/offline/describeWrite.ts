import type { ReplayedWrite } from "@/shared/offline/messages";

/**
 * Naming a write in an interface a user reads.
 *
 * There is nothing better available. The queue stores a method, a URL and a
 * body of bytes; it has no idea that `POST /api/posts` is "a new post",
 * because knowing that would mean the worker knowing what every endpoint
 * means. Showing the method and path is the honest floor: it is not friendly,
 * and it is enough for a user to recognise which action of theirs is being
 * talked about, and enough for a support ticket to be actionable.
 *
 * The query string is dropped, and not only for length. A URL is the one part
 * of a request that routinely carries a token in a `?` parameter — a signed
 * download link, a one-time invite — and this string is rendered into the DOM,
 * read aloud by screen readers, and pasted into bug reports. The path alone
 * says which resource without carrying anything that grants access to it.
 */
export function describeWrite(write: ReplayedWrite): string {
  let path: string;
  try {
    path = new URL(write.url, "http://invalid.localhost").pathname;
  } catch {
    // A URL the parser refuses is not worth a broken row: the method and the
    // fate are still true, and they are most of what the sentence says.
    path = write.url;
  }
  return `${write.method.toUpperCase()} ${path}`;
}

/**
 * Why a write is never going to be sent, in one clause.
 *
 * `sent` has no phrase because it never reaches here: this is the vocabulary
 * of the loss notice, and a delivered write is not a loss. Returning something
 * for it would make "0 changes could not be saved" renderable, which is a
 * sentence no user should ever be shown.
 */
export function describeFate(write: ReplayedWrite): string | null {
  switch (write.fate) {
    case "sent":
      return null;
    case "expired":
      // The age limit exists so a write does not arrive against a session that
      // expired hours ago; the user's version of that is simply "too old".
      return "waited too long to be sent";
    case "exhausted":
      return "could not reach the server";
    case "rejected":
      // The status is the only part a user can act on — a 409 means someone
      // else changed it, a 422 means the input was wrong — and it is the first
      // thing anyone helping them will ask for.
      return write.status === undefined
        ? "was refused by the server"
        : `was refused by the server (${String(write.status)})`;
  }
}

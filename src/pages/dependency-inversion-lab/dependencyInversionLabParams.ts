/**
 * URL state for the dependency-inversion lab, parsed in one place.
 *
 * Same shape as the other labs: the mode lives in the query string so a run is
 * shareable, and an unrecognised value falls back rather than throwing — a
 * hand-edited URL should not be able to blank the page.
 */
export const CLIENT_MODES = ["live", "stub"] as const;

export type ClientMode = (typeof CLIENT_MODES)[number];

export function parseClientMode(raw: string | null): ClientMode {
  return CLIENT_MODES.includes(raw as ClientMode) ? (raw as ClientMode) : "live";
}

/** The rows the stub answers with, so the swap is visible at a glance. */
export const STUB_POSTS = [
  {
    id: 901,
    title: "Injected by the stub client",
    body: "This row never touched the network. The component asked context for a client and got createStubApiClient().",
    userId: 1,
  },
  {
    id: 902,
    title: "Same component, different implementation",
    body: "PostFeed did not change to render this. Only the client above it did.",
    userId: 1,
  },
] as const;

/**
 * Removing credentials from anything on its way to an error backend.
 *
 * This exists because of where the values come from. A breadcrumb records the
 * URL the user navigated to, and an OAuth redirect arrives as
 * `/auth/callback?code=…&state=…`; a password reset is
 * `/reset?token=…`. Nobody writes `reporter.captureMessage(accessToken)` —
 * the credential arrives as a *substring of a path the app already handles*,
 * which is why redaction belongs on the recording side rather than in review.
 *
 * The default key list is deliberately matched loosely (case-insensitive
 * substring), because the leak is in the long tail of spellings: `token`
 * catches `access_token`, `refreshToken`, `id_token` and `csrf-token` in one
 * rule, and the cost of a false positive is a redacted analytics parameter
 * that nobody was reading. `code` is on the list for the OAuth authorization
 * code, and is the one rule that costs something — a `?code=US` country
 * filter is redacted too. That trade is taken deliberately: a redacted facet
 * is recoverable from the route, a leaked authorization code is not.
 *
 * What this cannot do is find a secret inside a *path* segment
 * (`/invite/abc123`), because nothing distinguishes that from a slug. Routes
 * that put a secret in a path are the caller's problem; see
 * `docs/error-boundaries.md`.
 */

export const REDACTED = "[redacted]";

/** Substrings that mark a query parameter as sensitive. Lowercase. */
export const SENSITIVE_KEY_PATTERNS: readonly string[] = [
  "token",
  "secret",
  "password",
  "passwd",
  "auth",
  "key",
  "code",
  "session",
  "signature",
  "credential",
];

export function isSensitiveKey(
  key: string,
  patterns: readonly string[] = SENSITIVE_KEY_PATTERNS,
): boolean {
  const lower = key.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

/**
 * Rewrites a URL's sensitive query values and drops its fragment.
 *
 * The fragment goes entirely rather than being parsed, because the implicit
 * OAuth flow returns `#access_token=…&token_type=bearer` and a fragment is
 * never meaningful to a server-side error backend anyway. Dropping it is both
 * the safe answer and the honest one.
 *
 * Relative URLs are the common case here (`location.pathname + search`), so
 * parsing goes through a placeholder base and the base is stripped back off.
 * A value that will not parse at all is returned with its query string
 * removed rather than passed through: an unparseable URL is exactly the case
 * where nothing can be said about what is in it.
 */
export function redactUrl(
  url: string,
  patterns: readonly string[] = SENSITIVE_KEY_PATTERNS,
): string {
  const PLACEHOLDER_ORIGIN = "http://redact.invalid";
  let parsed: URL;
  try {
    parsed = new URL(url, PLACEHOLDER_ORIGIN);
  } catch {
    const queryStart = url.indexOf("?");
    const fragmentStart = url.indexOf("#");
    const cut = [queryStart, fragmentStart].filter((i) => i !== -1).sort((a, b) => a - b)[0];
    return cut === undefined ? url : `${url.slice(0, cut)}?${REDACTED}`;
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (isSensitiveKey(key, patterns)) parsed.searchParams.set(key, REDACTED);
  }
  parsed.hash = "";

  const serialized = parsed.toString();
  const relative = url.startsWith(PLACEHOLDER_ORIGIN) || !/^[a-z][a-z0-9+.-]*:/i.test(url);
  return relative ? serialized.slice(PLACEHOLDER_ORIGIN.length) : serialized;
}

/**
 * Redacts every URL-shaped substring of a free-text message.
 *
 * Error messages quote URLs constantly — `Failed to fetch
 * https://api.example.com/me?access_token=…` is what a network error looks
 * like — so a reporter that redacts breadcrumbs and not messages leaks the
 * same credential through the field it is most likely to display.
 *
 * The pattern stops at whitespace, quotes and angle brackets, which is where a
 * URL embedded in prose ends. A trailing sentence-ending character is handed
 * back rather than treated as part of the URL.
 */
export function redactMessage(
  message: string,
  patterns: readonly string[] = SENSITIVE_KEY_PATTERNS,
): string {
  return message.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => {
    const trailing = /[.,;:!?)\]]+$/.exec(match);
    if (trailing === null) return redactUrl(match, patterns);
    const url = match.slice(0, match.length - trailing[0].length);
    return redactUrl(url, patterns) + trailing[0];
  });
}

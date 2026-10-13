import type { Rule } from "eslint";

/**
 * The ban that makes the token-storage policy enforceable.
 *
 * `docs/token-storage.md` is the prose; this file is the enforcement. The
 * application just moved its access token into memory and its refresh token
 * into an `HttpOnly` cookie, and deleted four `localStorage` keys in the
 * process. Nothing about that is self-sustaining: `localStorage.setItem` is one
 * line, it is the obvious fix for "the user is signed out when I reload", and
 * it type-checks, lints, renders and passes every test in the suite. The commit
 * that reintroduces it will be a two-line diff with a plausible message.
 *
 * ## The two checks, and why neither is sufficient alone
 *
 * **Key-based.** `localStorage.setItem("auth.accessToken", token)` is reported
 * wherever it appears, on a key matching {@link CREDENTIAL_KEY_PATTERN}. This
 * is the check that catches a credential being stashed from a module that has
 * every right to use storage otherwise — a theme provider, a settings page, a
 * new feature slice.
 *
 * It cannot see a key it cannot read. The code this rule replaced was written
 * as `localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, token)`, where the
 * key is a member expression resolved at runtime, so a key-matching rule would
 * have reported precisely none of the four calls it most needed to.
 *
 * **Path-based.** Any Web Storage access at all — read or write, `localStorage`
 * or `sessionStorage` — is reported inside the modules named by the `session`
 * option. Those are the modules that hold the credential, and they have no
 * legitimate use for storage: the session is memory plus a cookie, and both of
 * those are reachable without `Storage`. This is the check that would have
 * reported the old code, variable keys and all.
 *
 * Together they cover the two shapes the regression actually takes: the
 * credential moving to a module that is allowed to use storage, and storage
 * moving back into the module that holds the credential.
 *
 * ## What is deliberately not banned
 *
 * `localStorage` itself. The theme toggle, the locale preference, the offline
 * write queue and `useLocalStorage` all use it correctly, for data whose
 * disclosure costs nothing. A blanket ban would have to carry four exemptions
 * on day one, and a rule that is mostly exemptions is a rule that gets deleted.
 * The policy is not "storage is dangerous", it is "credentials do not go in
 * storage", and that is what this reports.
 *
 * `document.cookie` is also not banned, because it cannot read the refresh
 * cookie — `HttpOnly` is enforced by the browser, not by lint — and a rule
 * against it would be theatre.
 *
 * ## The one exemption, and why it is not a hole
 *
 * `features/auth/oauth.ts` keeps the PKCE code verifier and the `state` nonce
 * in `sessionStorage`, and is named in the rule's `allow` list rather than
 * worked around with a disable comment. That is not the rule being inconvenient
 * and losing: it is the one value in the auth flow that *cannot* live in
 * memory. The verifier is created before the browser navigates to Google and
 * read after Google navigates back, and a full-page cross-origin round trip
 * discards every JavaScript heap in between — memory is not an option, which is
 * why RFC 8252's browser-app profile specifies session storage here.
 *
 * It is also a different kind of value from the one this rule protects: single
 * use, valid for the seconds between two redirects, and worthless without the
 * authorization code it is exchanged alongside. `sessionStorage` rather than
 * `localStorage` so it dies with the tab. The exemption lives in
 * `eslint.config.ts` where widening it is a change to the lint configuration
 * that a reviewer reads as one — the same argument `noDangerousHtml` makes for
 * `HTML_SANITISATION_BOUNDARY`.
 */

/** Web Storage globals. Both, because `sessionStorage` is the obvious dodge. */
export const STORAGE_GLOBALS = new Set(["localStorage", "sessionStorage"]);

/** `Storage` methods that take a key as their first argument. */
export const KEYED_STORAGE_METHODS = new Set(["setItem", "getItem", "removeItem"]);

/**
 * Keys whose contents would be a credential.
 *
 * Matched case-insensitively against a literal key. `auth.` is anchored to a
 * leading position so it catches the `auth.accessToken` family this change
 * removed without also catching an `authorName` draft.
 */
export const CREDENTIAL_KEY_PATTERN =
  /(token|jwt|bearer|credential|password|secret|refresh)|^auth[._-]/i;

interface Options {
  /**
   * Modules forbidden *any* Web Storage access, as path suffixes
   * (`"entities/session"`, `"features/auth/authApi.ts"`).
   *
   * Suffixes rather than globs or absolute paths, for the same reason
   * `noDangerousHtml` uses them: the rule has to recognise the same file under
   * ESLint (an absolute path), under `RuleTester` (a bare `file.ts`) and on
   * Windows (backslashes), and a suffix match on `/` boundaries is the one
   * comparison that behaves identically in all three.
   */
  readonly session: readonly string[];
  /**
   * Files inside `session` that are exempt, as path suffixes.
   *
   * Checked before `session`, so an entry here wins. Matched the same way, for
   * the same portability reasons.
   */
  readonly allow: readonly string[];
}

function readStringArray(raw: unknown, key: string): readonly string[] {
  const value = (raw as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readOptions(raw: unknown): Options {
  if (typeof raw !== "object" || raw === null) return { session: [], allow: [] };
  return { session: readStringArray(raw, "session"), allow: readStringArray(raw, "allow") };
}

/** Whether `filename` matches one of `entries`, treated as path suffixes. */
export function matchesPathSuffix(filename: string, entries: readonly string[]): boolean {
  const normalised = filename.replace(/\\/g, "/");
  return entries.some((entry) => {
    const suffix = entry
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/\/$/, "");
    // The `/` boundary is what stops `entities/session` from also matching
    // `entities/sessionless`, and what makes a directory entry cover the files
    // inside it.
    return (
      normalised === suffix ||
      normalised.endsWith(`/${suffix}`) ||
      normalised.includes(`/${suffix}/`) ||
      normalised.startsWith(`${suffix}/`)
    );
  });
}

/** The static name of a member access, or `null` when there is not one. */
export function staticMemberName(node: {
  computed?: boolean;
  property?: { type?: string; name?: unknown; value?: unknown };
}): string | null {
  const property = node.property;
  if (property === undefined) return null;
  if (node.computed === true) {
    return property.type === "Literal" && typeof property.value === "string"
      ? property.value
      : null;
  }
  return property.type === "Identifier" && typeof property.name === "string" ? property.name : null;
}

/**
 * The storage global an expression plainly denotes, or `null`.
 *
 * Recognises `localStorage`, `window.localStorage` and `globalThis.localStorage`
 * — the three spellings in use in this codebase. A storage object passed in as
 * a parameter is out of reach of any lint rule and is covered by the path check
 * instead, which does not care how the object was obtained because it reports
 * the whole module.
 */
export function storageGlobalName(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  const expression = node as {
    type?: string;
    name?: unknown;
    object?: { type?: string; name?: unknown };
  };

  if (expression.type === "Identifier" && typeof expression.name === "string") {
    return STORAGE_GLOBALS.has(expression.name) ? expression.name : null;
  }

  if (expression.type === "MemberExpression") {
    const property = staticMemberName(
      expression as { computed?: boolean; property?: { type?: string; name?: unknown } },
    );
    if (property === null || !STORAGE_GLOBALS.has(property)) return null;
    const object = expression.object;
    if (object?.type !== "Identifier") return null;
    return object.name === "window" || object.name === "globalThis" ? property : null;
  }

  return null;
}

/** The string a node spells, or `null` for anything not a string literal. */
export function staticStringValue(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  const literal = node as { type?: string; value?: unknown; quasis?: unknown[] };
  if (literal.type === "Literal" && typeof literal.value === "string") return literal.value;
  // A template literal with no substitutions is a string written with the wrong
  // quotes, and is the first thing to try once `"auth.accessToken"` is reported.
  if (literal.type === "TemplateLiteral" && Array.isArray(literal.quasis)) {
    if (literal.quasis.length !== 1) return null;
    const cooked = (literal.quasis[0] as { value?: { cooked?: unknown } }).value?.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  return null;
}

export const noTokenStorage: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban credential-shaped keys in Web Storage, and ban Web Storage outright in the modules that hold the session",
      url: "https://github.com/Kojo-Brown/boilerplate-react-ts/blob/main/docs/token-storage.md",
    },
    schema: [
      {
        type: "object",
        properties: {
          session: { type: "array", items: { type: "string" } },
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      credentialKey:
        "`{{storage}}` is readable by every script on this origin, so a credential in it is a credential an XSS payload can exfiltrate — and one that outlives the tab. The access token belongs in memory (the `auth` slice) and the refresh token in an `HttpOnly` cookie the server sets. See docs/token-storage.md.",
      sessionModule:
        "`{{storage}}` must not be reached from `{{module}}`: this module holds the session, and the session is memory plus an `HttpOnly` cookie. Persisting any part of it here is the regression `docs/token-storage.md` exists to prevent. If you need a durable preference rather than a credential, put it in a module that is not the session.",
    },
  },

  create(context) {
    const { session, allow } = readOptions(context.options[0]);
    // `physicalFilename` is the file on disk; `filename` can be a virtual path
    // for a processed block. The check is about a real file, so it reads the
    // real one, falling back for `RuleTester`.
    const filename = context.physicalFilename || context.filename;
    const inSessionModule =
      !matchesPathSuffix(filename, allow) && matchesPathSuffix(filename, session);

    /**
     * Reports any mention of a storage global inside a session module.
     *
     * Deliberately on `Identifier`/`MemberExpression` rather than only on
     * calls: `const s = localStorage` followed by `s.setItem(k, v)` is two
     * statements that a call-site check would wave through, and the point of
     * the path rule is that this module does not touch storage at all.
     */
    function reportModuleAccess(node: Rule.Node, storage: string): void {
      context.report({
        node,
        messageId: "sessionModule",
        data: { storage, module: filename.replace(/\\/g, "/").split("/src/").pop() ?? filename },
      });
    }

    return {
      Identifier(node) {
        if (!inSessionModule) return;
        if (!STORAGE_GLOBALS.has(node.name)) return;
        // `window.localStorage` would otherwise report twice: once for the
        // member expression below and once for this identifier inside it.
        const parent = (node as unknown as { parent?: { type?: string; property?: unknown } })
          .parent;
        if (parent?.type === "MemberExpression" && parent.property === node) return;
        reportModuleAccess(node, node.name);
      },

      MemberExpression(node) {
        if (!inSessionModule) return;
        const storage = storageGlobalName(node);
        if (storage === null) return;
        reportModuleAccess(node, storage);
      },

      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression") return;

        const method = staticMemberName(callee);
        if (method === null || !KEYED_STORAGE_METHODS.has(method)) return;

        const storage = storageGlobalName(callee.object);
        if (storage === null) return;

        const key = staticStringValue(node.arguments[0]);
        if (key === null || !CREDENTIAL_KEY_PATTERN.test(key)) return;

        // Inside a session module the path rule has already reported the
        // receiver, and two errors on one line only obscures the fix.
        if (inSessionModule) return;

        context.report({ node, messageId: "credentialKey", data: { storage } });
      },
    };
  },
};

export const tokenStoragePlugin = {
  rules: { "no-token-storage": noTokenStorage },
};

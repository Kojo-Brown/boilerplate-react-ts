// @vitest-environment node
//
// `RuleTester` parses and lints source strings; there is no DOM in sight, and
// the default jsdom environment only slows it down.
import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import {
  CREDENTIAL_KEY_PATTERN,
  matchesPathSuffix,
  noTokenStorage,
  staticStringValue,
  storageGlobalName,
  tokenStoragePlugin,
} from "./noTokenStorage";

/**
 * Two layers, matching `noDangerousHtml.test.ts`.
 *
 * The helpers decide what a piece of syntax *is* — which file this is, whether
 * an expression denotes a storage global, what string a node spells — and they
 * are tested directly, because each is a place the rule can be wrong in a way
 * that reads as correct.
 *
 * The rule decides what to report, and that is tested through `RuleTester` on
 * real source. The valid cases carry as much weight as the invalid ones: this
 * codebase uses `localStorage` legitimately in four places, and a rule that
 * reported the theme toggle would be switched off within a week.
 */
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as unknown as NonNullable<
      ConstructorParameters<typeof RuleTester>[0]
    >["languageOptions"] extends { parser?: infer P }
      ? P
      : never,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** The production configuration, so the tests exercise what CI runs. */
const OPTIONS = [
  {
    session: ["src/entities/session", "src/features/auth"],
    allow: ["src/features/auth/oauth.ts"],
  },
];

describe("matchesPathSuffix", () => {
  it("matches a directory entry against a file inside it", () => {
    expect(
      matchesPathSuffix("/repo/src/entities/session/authSlice.ts", ["src/entities/session"]),
    ).toBe(true);
  });

  it("matches an absolute path by suffix", () => {
    expect(matchesPathSuffix("/repo/src/features/auth/authApi.ts", ["src/features/auth"])).toBe(
      true,
    );
  });

  it("matches a path spelled with backslashes", () => {
    expect(
      matchesPathSuffix("C:\\repo\\src\\features\\auth\\authApi.ts", ["src/features/auth"]),
    ).toBe(true);
  });

  it("matches the entry on its own, as RuleTester spells it", () => {
    expect(matchesPathSuffix("src/features/auth/authApi.ts", ["src/features/auth"])).toBe(true);
  });

  it("requires a path-segment boundary", () => {
    // The one-character bypass: `entities/sessionless` must not inherit the ban
    // meant for `entities/session`, and a plain `includes` would give it one.
    expect(matchesPathSuffix("/repo/src/entities/sessionless/x.ts", ["src/entities/session"])).toBe(
      false,
    );
  });

  it("matches nothing when the list is empty", () => {
    expect(matchesPathSuffix("/repo/src/entities/session/authSlice.ts", [])).toBe(false);
  });

  it("tolerates a leading ./ and a trailing / on an entry", () => {
    expect(matchesPathSuffix("/repo/src/features/auth/x.ts", ["./src/features/auth/"])).toBe(true);
  });
});

describe("storageGlobalName", () => {
  it("reads a bare identifier", () => {
    expect(storageGlobalName({ type: "Identifier", name: "localStorage" })).toBe("localStorage");
    expect(storageGlobalName({ type: "Identifier", name: "sessionStorage" })).toBe(
      "sessionStorage",
    );
  });

  it("reads window.localStorage and globalThis.sessionStorage", () => {
    expect(
      storageGlobalName({
        type: "MemberExpression",
        computed: false,
        object: { type: "Identifier", name: "window" },
        property: { type: "Identifier", name: "localStorage" },
      }),
    ).toBe("localStorage");
    expect(
      storageGlobalName({
        type: "MemberExpression",
        computed: false,
        object: { type: "Identifier", name: "globalThis" },
        property: { type: "Identifier", name: "sessionStorage" },
      }),
    ).toBe("sessionStorage");
  });

  it("is null for an unrelated identifier", () => {
    expect(storageGlobalName({ type: "Identifier", name: "cache" })).toBeNull();
  });

  it("is null for a storage-named property on an unknown receiver", () => {
    // `fakeWindow.localStorage` is not the global, and claiming it is would let
    // the rule report objects it knows nothing about.
    expect(
      storageGlobalName({
        type: "MemberExpression",
        computed: false,
        object: { type: "Identifier", name: "fakeWindow" },
        property: { type: "Identifier", name: "localStorage" },
      }),
    ).toBeNull();
  });
});

describe("staticStringValue", () => {
  it("reads a string literal", () => {
    expect(staticStringValue({ type: "Literal", value: "auth.accessToken" })).toBe(
      "auth.accessToken",
    );
  });

  it("reads a template literal with no substitutions", () => {
    expect(
      staticStringValue({
        type: "TemplateLiteral",
        quasis: [{ value: { cooked: "auth.accessToken" } }],
      }),
    ).toBe("auth.accessToken");
  });

  it("is null for a template literal with a substitution", () => {
    expect(
      staticStringValue({
        type: "TemplateLiteral",
        quasis: [{ value: { cooked: "auth." } }, { value: { cooked: "" } }],
      }),
    ).toBeNull();
  });

  it("is null for a non-string literal", () => {
    expect(staticStringValue({ type: "Literal", value: 42 })).toBeNull();
  });
});

describe("CREDENTIAL_KEY_PATTERN", () => {
  it.each([
    "auth.accessToken",
    "auth.refreshToken",
    "AUTH_TOKEN",
    "sessionToken",
    "jwt",
    "bearer",
    "user.password",
    "api-secret",
    "my.credential",
    "refresh",
  ])("matches %s", (key) => {
    expect(CREDENTIAL_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each([
    // The keys this codebase legitimately stores. A rule that matched any of
    // these would report `ThemeContext`, `localePreference` or the offline
    // queue, and would be deleted rather than fixed.
    "theme",
    "locale",
    "offline.queue",
    "authorName",
    "oauth.codeVerifier",
    "sidebar.collapsed",
  ])("does not match %s", (key) => {
    expect(CREDENTIAL_KEY_PATTERN.test(key)).toBe(false);
  });
});

describe("tokenStoragePlugin", () => {
  it("exposes the rule under the name the config uses", () => {
    expect(tokenStoragePlugin.rules["no-token-storage"]).toBe(noTokenStorage);
  });
});

describe("no-token-storage", () => {
  ruleTester.run("no-token-storage", noTokenStorage, {
    valid: [
      {
        name: "the theme preference, which is what the rule must not report",
        code: `localStorage.setItem("theme", "dark");`,
        filename: "src/shared/theme/ThemeContext.tsx",
        options: OPTIONS,
      },
      {
        name: "the locale preference",
        code: `localStorage.setItem("locale", "en-GB"); localStorage.getItem("locale");`,
        filename: "src/shared/i18n/localePreference.ts",
        options: OPTIONS,
      },
      {
        name: "a generic storage hook, whose key is a parameter",
        code: `export function read(key: string) { return localStorage.getItem(key); }`,
        filename: "src/shared/hooks/useLocalStorage.ts",
        options: OPTIONS,
      },
      {
        name: "the PKCE verifier in the one exempt file",
        code: `sessionStorage.setItem("oauth.codeVerifier", v); sessionStorage.getItem("oauth.state");`,
        filename: "src/features/auth/oauth.ts",
        options: OPTIONS,
      },
      {
        name: "the auth slice holding the token in memory, which is the fix",
        code: `state.token = action.payload.token;`,
        filename: "src/entities/session/authSlice.ts",
        options: OPTIONS,
      },
      {
        name: "a storage-named property on an object that is not the global",
        code: `const fake = { localStorage: new Map() }; fake.localStorage.get("auth.token");`,
        filename: "src/shared/lib/x.ts",
        options: OPTIONS,
      },
      {
        name: "`entities/sessionless` does not inherit `entities/session`'s ban",
        code: `localStorage.getItem("theme");`,
        filename: "src/entities/sessionless/x.ts",
        options: OPTIONS,
      },
      {
        name: "reading the refresh cookie is impossible, so document.cookie is not policed",
        code: `const c = document.cookie;`,
        filename: "src/features/auth/authApi.ts",
        options: OPTIONS,
      },
    ],

    invalid: [
      {
        name: "the exact regression: the access token back in localStorage",
        code: `localStorage.setItem("auth.accessToken", token);`,
        filename: "src/shared/lib/persist.ts",
        options: OPTIONS,
        errors: [{ messageId: "credentialKey" }],
      },
      {
        name: "the refresh token, which is the credential that matters most",
        code: `localStorage.setItem("auth.refreshToken", refreshToken);`,
        filename: "src/shared/lib/persist.ts",
        options: OPTIONS,
        errors: [{ messageId: "credentialKey" }],
      },
      {
        name: "sessionStorage is the obvious dodge and is reported too",
        code: `sessionStorage.setItem("sessionToken", t);`,
        filename: "src/shared/lib/persist.ts",
        options: OPTIONS,
        errors: [{ messageId: "credentialKey" }],
      },
      {
        name: "window.localStorage spells the same thing",
        code: `window.localStorage.setItem("jwt", t);`,
        filename: "src/shared/lib/persist.ts",
        options: OPTIONS,
        errors: [{ messageId: "credentialKey" }],
      },
      {
        name: "a template literal with no substitutions is a string in other quotes",
        code: "localStorage.setItem(`auth.accessToken`, token);",
        filename: "src/shared/lib/persist.ts",
        options: OPTIONS,
        errors: [{ messageId: "credentialKey" }],
      },
      {
        name: "reading one back is reported too — a read implies a write somewhere",
        code: `const t = localStorage.getItem("auth.accessToken");`,
        filename: "src/shared/lib/persist.ts",
        options: OPTIONS,
        errors: [{ messageId: "credentialKey" }],
      },
      {
        /*
          The case a key-matching rule cannot see, and the shape the deleted
          code was actually written in. `AUTH_STORAGE_KEYS.ACCESS_TOKEN` is a
          member expression, so there is no literal to match — the path check is
          the only thing that reports it.
        */
        name: "a variable key inside a session module, which only the path check catches",
        code: `localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, token);`,
        filename: "src/entities/session/authSlice.ts",
        options: OPTIONS,
        errors: [{ messageId: "sessionModule" }],
      },
      {
        name: "any storage read inside a session module, whatever the key",
        code: `const raw = localStorage.getItem(someKey);`,
        filename: "src/entities/session/authSlice.ts",
        options: OPTIONS,
        errors: [{ messageId: "sessionModule" }],
      },
      {
        name: "aliasing the global does not escape the module ban",
        code: `const s = localStorage; s.setItem(k, v);`,
        filename: "src/features/auth/authApi.ts",
        options: OPTIONS,
        errors: [{ messageId: "sessionModule" }],
      },
      {
        name: "window.localStorage inside a session module reports once, not twice",
        code: `window.localStorage.removeItem(k);`,
        filename: "src/features/auth/silentRefresh.ts",
        options: OPTIONS,
        errors: [{ messageId: "sessionModule" }],
      },
      {
        name: "the exemption is per-file, not per-directory",
        code: `sessionStorage.setItem("oauth.state", s);`,
        filename: "src/features/auth/oauthHelpers.ts",
        options: OPTIONS,
        errors: [{ messageId: "sessionModule" }],
      },
      {
        name: "a credential key in a session module reports the module, not the key",
        // Both checks match; reporting twice on one line only obscures the fix.
        code: `localStorage.setItem("auth.accessToken", token);`,
        filename: "src/entities/session/authSlice.ts",
        options: OPTIONS,
        errors: [{ messageId: "sessionModule" }],
      },
    ],
  });
});

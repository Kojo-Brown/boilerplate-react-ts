/**
 * Defaults for the `VITE_*` values the application turns into requests.
 *
 * Here rather than inline in `env.ts`'s schema because two things need them and
 * only one of them is the application. The other is the
 * Content-Security-Policy: `tooling/csp/policy.ts` derives `connect-src` from
 * the build's resolved environment, and an unset variable is exactly the case
 * where that environment says nothing while the bundle still fetches something
 * — the Zod default having filled it in.
 *
 * That was a real bug, found by loading a production build under the policy:
 * with `VITE_API_URL` unset, `connect-src` came out as `'self'` and the
 * application's own API calls to `http://localhost:4000` were refused. The
 * default is the piece of the contract the build could not see, so the build
 * reads it from here.
 *
 * No Zod, no `import.meta.env`, nothing that assumes a browser or a bundler:
 * this module is imported by a Vite plugin running in Node before the
 * application exists.
 */
export const ENV_DEFAULTS = {
  /** Where the API is. A dev-server default; production supplies its own. */
  VITE_API_URL: "http://localhost:4000",
  /** Empty means "do not report" rather than "report to a default endpoint". */
  VITE_ANALYTICS_URL: "",
  VITE_ERROR_REPORT_URL: "",
} as const;

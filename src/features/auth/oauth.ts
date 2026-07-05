import { env } from "@/env";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = "openid email profile";

export const OAUTH_STORAGE_KEYS = {
  CODE_VERIFIER: "oauth.codeVerifier",
  STATE: "oauth.state",
} as const;

export interface GoogleAuthUrlParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

export function buildGoogleAuthUrl(params: GoogleAuthUrlParams): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
}

function getRedirectUri(): string {
  return env.VITE_REDIRECT_URI ?? `${window.location.origin}/auth/callback`;
}

/**
 * Starts the Google OAuth PKCE flow: generates PKCE params, persists them to
 * sessionStorage, then redirects the browser to Google's authorization endpoint.
 */
export async function startGoogleOAuth(): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, codeVerifier);
  sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, state);

  const url = buildGoogleAuthUrl({
    clientId: env.VITE_GOOGLE_CLIENT_ID ?? "",
    redirectUri: getRedirectUri(),
    codeChallenge,
    state,
  });

  window.location.assign(url);
}

export interface OAuthCallbackParams {
  code: string;
  state: string;
}

export interface OAuthCallbackResult {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/**
 * Validates the OAuth callback state against the stored value and returns the
 * code + verifier needed for the token exchange. Clears sessionStorage on exit.
 *
 * Throws if the state is missing, mismatched, or the verifier is absent.
 */
export function validateOAuthCallback(params: OAuthCallbackParams): OAuthCallbackResult {
  const storedState = sessionStorage.getItem(OAUTH_STORAGE_KEYS.STATE);
  const storedVerifier = sessionStorage.getItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER);

  sessionStorage.removeItem(OAUTH_STORAGE_KEYS.STATE);
  sessionStorage.removeItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER);

  if (!storedState || storedState !== params.state) {
    throw new Error("OAuth state mismatch — possible CSRF attack.");
  }
  if (!storedVerifier) {
    throw new Error("OAuth code verifier missing from session.");
  }

  return {
    code: params.code,
    codeVerifier: storedVerifier,
    redirectUri: getRedirectUri(),
  };
}

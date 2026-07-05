function base64urlEncode(bytes: Uint8Array): string {
  const str = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Generates a cryptographically random code verifier (RFC 7636 §4.1). */
export function generateCodeVerifier(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return base64urlEncode(buffer);
}

/** Derives an S256 code challenge from a code verifier (RFC 7636 §4.2). */
export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64urlEncode(new Uint8Array(digest));
}

/** Generates a cryptographically random state string for CSRF prevention. */
export function generateState(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return base64urlEncode(buffer);
}

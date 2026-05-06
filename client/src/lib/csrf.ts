const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

function readCookie(name: string) {
  if (typeof document === "undefined") return undefined;
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

function generateHexToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function getOrCreateCsrfToken() {
  const existingToken = readCookie(CSRF_COOKIE_NAME);
  if (existingToken && CSRF_TOKEN_PATTERN.test(existingToken)) {
    return existingToken;
  }

  const token = generateHexToken();
  document.cookie = `${CSRF_COOKIE_NAME}=${token}; Path=/; Max-Age=86400; SameSite=Strict`;
  return token;
}

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "./logger";

const CSRF_TOKEN_HEADER = "X-CSRF-Token";
export const CSRF_COOKIE_NAME = "csrf_token";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CSRF_TOKEN_BYTES = 32;
const CSRF_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

function isSafeMethod(method: string) {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isValidCsrfTokenShape(token: unknown): token is string {
  return typeof token === "string" && CSRF_TOKEN_PATTERN.test(token);
}

/**
 * Generate a CSRF token
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_BYTES).toString("hex");
}

function csrfCookieOptions() {
  return {
    httpOnly: false, // Must be readable by JavaScript for double-submit headers.
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: ONE_DAY_MS,
  };
}

function ensureResponseCsrfCookie(req: Request, res: Response) {
  const existingToken = req.cookies?.[CSRF_COOKIE_NAME];
  const token = isValidCsrfTokenShape(existingToken)
    ? existingToken
    : generateCsrfToken();

  if (token !== existingToken) {
    res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  }

  return token;
}

/**
 * Mint the CSRF token early on safe requests (including the initial HTML
 * document) so the SPA can include it on its first state-changing tRPC call.
 */
export function issueCsrfToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (isSafeMethod(req.method)) {
    ensureResponseCsrfCookie(req, res);
  }
  next();
}

/**
 * Middleware to generate and validate CSRF tokens using double-submit cookie pattern
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Skip CSRF validation for safe methods. The global issueCsrfToken middleware
  // is responsible for making sure those responses bootstrap a readable token.
  if (isSafeMethod(req.method)) {
    next();
    return;
  }

  // For mutation methods, validate CSRF token
  const tokenFromHeader = req.headers[CSRF_TOKEN_HEADER.toLowerCase()];
  const tokenFromCookie = req.cookies?.[CSRF_COOKIE_NAME];

  if (
    !isValidCsrfTokenShape(tokenFromHeader) ||
    !isValidCsrfTokenShape(tokenFromCookie)
  ) {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
        hasHeader: !!tokenFromHeader,
        hasCookie: !!tokenFromCookie,
      },
      "CSRF token missing or malformed"
    );
    res.status(403).json({
      error: "CSRF token missing. Please refresh the page and try again.",
    });
    return;
  }

  const headerBuf = Buffer.from(tokenFromHeader, "hex");
  const cookieBuf = Buffer.from(tokenFromCookie, "hex");
  const isValid =
    headerBuf.length === CSRF_TOKEN_BYTES &&
    cookieBuf.length === CSRF_TOKEN_BYTES &&
    crypto.timingSafeEqual(headerBuf, cookieBuf);

  if (!isValid) {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
      },
      "Invalid CSRF token"
    );
    res.status(403).json({
      error: "Invalid CSRF token. Please refresh the page and try again.",
    });
    return;
  }

  next();
}

/**
 * Get CSRF token for the current request
 */
export function getCsrfToken(req: Request): string {
  const token = req.cookies?.[CSRF_COOKIE_NAME];
  return isValidCsrfTokenShape(token) ? token : generateCsrfToken();
}

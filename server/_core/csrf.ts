import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "./logger";

const CSRF_TOKEN_HEADER = "X-CSRF-Token";
const CSRF_COOKIE_NAME = "csrf_token";

/**
 * Generate a CSRF token
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Middleware to generate and validate CSRF tokens using double-submit cookie pattern
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for safe methods (GET, HEAD, OPTIONS)
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    // Always set a CSRF token cookie for GET requests so it's available for subsequent requests
    const existingToken = req.cookies?.[CSRF_COOKIE_NAME];
    if (!existingToken) {
      const token = generateCsrfToken();
      res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false, // Must be readable by JavaScript
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }
    next();
    return;
  }

  // For mutation methods, validate CSRF token
  const tokenFromHeader = req.headers[CSRF_TOKEN_HEADER.toLowerCase()] as string;
  const tokenFromCookie = req.cookies?.[CSRF_COOKIE_NAME];

  if (!tokenFromHeader || !tokenFromCookie) {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
        hasHeader: !!tokenFromHeader,
        hasCookie: !!tokenFromCookie,
      },
      "CSRF token missing"
    );
    res.status(403).json({
      error: "CSRF token missing. Please refresh the page and try again.",
    });
    return;
  }

  // Use timing-safe comparison
  const isValid = crypto.timingSafeEqual(
    Buffer.from(tokenFromHeader),
    Buffer.from(tokenFromCookie)
  );

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
  return req.cookies?.[CSRF_COOKIE_NAME] || generateCsrfToken();
}

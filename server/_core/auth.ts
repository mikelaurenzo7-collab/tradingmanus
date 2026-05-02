import crypto from "crypto";
import { parse as parseCookieHeader } from "cookie";
import type { IncomingHttpHeaders } from "node:http";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_NAME, REFRESH_COOKIE_NAME, ONE_DAY_MS, SEVEN_DAYS_MS } from "../../shared/const";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { logger } from "./logger";

export type AuthRequest = {
  headers: IncomingHttpHeaders;
};

export type SessionPayload = {
  openId: string;
  email: string;
  name: string;
  type?: "access" | "refresh";
};

const OWNER_OPEN_ID = "owner:primary";
const OWNER_NAME = "Mikelaurenzo";

function getJwtSecret() {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET is required for owner sessions");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

function timingSafeEqualString(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function validateOwnerCredentials(email: string, password: string) {
  const expectedEmail = ENV.ownerEmail.toLowerCase();
  const submittedEmail = email.trim().toLowerCase();

  if (!expectedEmail || !ENV.ownerPassword) {
    throw new Error("OWNER_EMAIL and OWNER_PASSWORD must be configured before sign-in works.");
  }

  return (
    timingSafeEqualString(submittedEmail, expectedEmail) &&
    timingSafeEqualString(password, ENV.ownerPassword)
  );
}

export async function ensureOwnerUser() {
  await db.upsertUser({
    openId: OWNER_OPEN_ID,
    name: OWNER_NAME,
    email: ENV.ownerEmail,
    loginMethod: "owner_password",
    lastSignedIn: new Date(),
  });

  const user = await db.getUserByOpenId(OWNER_OPEN_ID);
  if (!user) {
    throw new Error("Owner user could not be loaded after sign-in.");
  }

  return user;
}

export async function createOwnerSessionToken() {
  const payload: SessionPayload = {
    openId: OWNER_OPEN_ID,
    email: ENV.ownerEmail,
    name: OWNER_NAME,
    type: "access",
  };

  // Access token expires in 24 hours
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(ONE_DAY_MS / 1000)}s`)
    .sign(getJwtSecret());
}

export async function createOwnerRefreshToken() {
  const payload: SessionPayload = {
    openId: OWNER_OPEN_ID,
    email: ENV.ownerEmail,
    name: OWNER_NAME,
    type: "refresh",
  };

  // Refresh token expires in 7 days
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(SEVEN_DAYS_MS / 1000)}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string, expectedType?: "access" | "refresh") {
  try {
    const result = await jwtVerify(token, getJwtSecret());
    const payload = result.payload as Partial<SessionPayload>;

    if (!payload.openId || typeof payload.openId !== "string") {
      return null;
    }

    // If expectedType is specified, verify the token type matches
    if (expectedType && payload.type !== expectedType) {
      logger.warn(
        { expectedType, actualType: payload.type },
        "Token type mismatch"
      );
      return null;
    }

    return payload.openId;
  } catch (error) {
    logger.debug({ error }, "Token verification failed");
    return null;
  }
}

export async function refreshAccessToken(refreshToken: string) {
  const openId = await verifySessionToken(refreshToken, "refresh");
  if (!openId) {
    return null;
  }

  // Generate new access token
  return createOwnerSessionToken();
}

export async function authenticateRequest(req: AuthRequest): Promise<User | null> {
  const cookieHeader = Array.isArray(req.headers.cookie)
    ? req.headers.cookie.join("; ")
    : req.headers.cookie;
  const cookies = parseCookieHeader(cookieHeader ?? "");
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const openId = await verifySessionToken(token);
  if (!openId) return null;

  return db.getUserByOpenId(openId);
}

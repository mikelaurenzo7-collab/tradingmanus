import crypto from "crypto";
import { parse as parseCookieHeader } from "cookie";
import type { IncomingHttpHeaders } from "node:http";
import { SignJWT, jwtVerify } from "jose";
import {
  COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  ONE_DAY_MS,
  SEVEN_DAYS_MS,
} from "../../shared/const";
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

const PASSWORD_HASH_VERSION = "pbkdf2_sha256_v1";
const PASSWORD_HASH_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;

const OWNER_OPEN_ID = "owner:primary";
const OWNER_NAME = "Mikelaurenzo";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

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
  const submittedEmail = normalizeEmail(email);

  if (!expectedEmail || !ENV.ownerPassword) {
    throw new Error(
      "OWNER_EMAIL and OWNER_PASSWORD must be configured before sign-in works."
    );
  }

  return (
    timingSafeEqualString(submittedEmail, expectedEmail) &&
    timingSafeEqualString(password, ENV.ownerPassword)
  );
}

export function hashAccountPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const digest = crypto
    .pbkdf2Sync(
      password,
      salt,
      PASSWORD_HASH_ITERATIONS,
      PASSWORD_KEY_LENGTH,
      "sha256"
    )
    .toString("base64url");

  return `${PASSWORD_HASH_VERSION}$${PASSWORD_HASH_ITERATIONS}$${salt}$${digest}`;
}

export function verifyAccountPassword(
  password: string,
  storedHash: string | null | undefined
) {
  if (!storedHash) return false;
  const [version, iterationsText, salt, expectedDigest] = storedHash.split("$");
  const iterations = Number.parseInt(iterationsText ?? "", 10);
  if (
    version !== PASSWORD_HASH_VERSION ||
    !Number.isFinite(iterations) ||
    !salt ||
    !expectedDigest
  ) {
    return false;
  }

  const actualDigest = crypto
    .pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, "sha256")
    .toString("base64url");

  return timingSafeEqualString(actualDigest, expectedDigest);
}

export function getCheckoutUrlForTier(tier: "starter" | "pro" | "fund") {
  if (tier === "fund") return ENV.fundCheckoutUrl;
  if (tier === "pro") return ENV.proCheckoutUrl;
  return ENV.starterCheckoutUrl;
}

export function isSubscriptionEntitled(
  user: Pick<
    User,
    "subscriptionStatus" | "subscriptionCurrentPeriodEnd" | "role"
  >
) {
  if (user.role === "admin") return true;
  const status = user.subscriptionStatus ?? "trialing";
  if (status !== "active" && status !== "trialing") return false;
  if (!user.subscriptionCurrentPeriodEnd) return true;
  return new Date(user.subscriptionCurrentPeriodEnd).getTime() > Date.now();
}

export async function ensureOwnerUser() {
  // The owner is the operator: they deploy the system, set the env-level
  // policy, and own the Kalshi/Polymarket accounts.  Always grant them
  // role=admin + betaAccessLevel=internal so they're never blocked by
  // gates designed for downstream beta users.  Idempotent — refreshed
  // on every login.
  await db.upsertUser({
    openId: OWNER_OPEN_ID,
    name: OWNER_NAME,
    email: ENV.ownerEmail,
    loginMethod: "owner_password",
    lastSignedIn: new Date(),
    role: "admin",
    betaAccessLevel: "internal",
  });

  const user = await db.getUserByOpenId(OWNER_OPEN_ID);
  if (!user) {
    throw new Error("Owner user could not be loaded after sign-in.");
  }

  return user;
}

export async function createSessionTokenForUser(
  user: Pick<User, "openId" | "email" | "name">,
  type: "access" | "refresh"
) {
  const payload: SessionPayload = {
    openId: user.openId,
    email: user.email ?? "",
    name: user.name ?? "",
    type,
  };

  const ttlMs = type === "access" ? ONE_DAY_MS : SEVEN_DAYS_MS;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(ttlMs / 1000)}s`)
    .sign(getJwtSecret());
}

export async function createOwnerSessionToken() {
  return createSessionTokenForUser(
    { openId: OWNER_OPEN_ID, email: ENV.ownerEmail, name: OWNER_NAME },
    "access"
  );
}

export async function createOwnerRefreshToken() {
  return createSessionTokenForUser(
    { openId: OWNER_OPEN_ID, email: ENV.ownerEmail, name: OWNER_NAME },
    "refresh"
  );
}

export async function verifySessionToken(
  token: string,
  expectedType?: "access" | "refresh"
) {
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

  const user = await db.getUserByOpenId(openId);
  if (!user) return null;

  return createSessionTokenForUser(user, "access");
}

export async function authenticateRequest(
  req: AuthRequest
): Promise<User | null> {
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

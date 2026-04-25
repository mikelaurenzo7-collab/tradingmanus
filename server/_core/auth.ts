import crypto from "crypto";
import { parse as parseCookieHeader } from "cookie";
import type { IncomingHttpHeaders } from "node:http";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

export type AuthRequest = {
  headers: IncomingHttpHeaders;
};

export type SessionPayload = {
  openId: string;
  email: string;
  name: string;
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
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(ONE_YEAR_MS / 1000)}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string) {
  const result = await jwtVerify(token, getJwtSecret());
  const payload = result.payload as Partial<SessionPayload>;

  if (!payload.openId || typeof payload.openId !== "string") {
    return null;
  }

  return payload.openId;
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

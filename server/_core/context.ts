import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { IncomingHttpHeaders } from "node:http";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./auth";

export type TrpcRequest = {
  headers: IncomingHttpHeaders;
  protocol?: string;
};

export type TrpcResponse = {
  cookie(name: string, value: string, options?: unknown): TrpcResponse;
  clearCookie(name: string, options?: unknown): TrpcResponse;
};

export type TrpcContext = {
  req: TrpcRequest;
  res: TrpcResponse;
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const req = opts.req as unknown as TrpcRequest;
  const res = opts.res as unknown as TrpcResponse;
  let user: User | null = null;

  try {
    user = await authenticateRequest(req);
  } catch (error) {
    // Authentication is optional for public procedures.
    console.warn("[Context] Auth error:", error);
    user = null;
  }

  return {
    req,
    res,
    user,
  };
}

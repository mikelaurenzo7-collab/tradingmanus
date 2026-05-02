import type { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { logger, createChildLogger } from "./logger";

/**
 * Middleware to add correlation IDs to requests for distributed tracing
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check if correlation ID already exists in headers (from upstream services)
  const correlationId =
    (req.headers["x-correlation-id"] as string) ||
    (req.headers["x-request-id"] as string) ||
    nanoid();

  // Store correlation ID in request for later use
  (req as any).correlationId = correlationId;

  // Add correlation ID to response headers
  res.setHeader("X-Correlation-ID", correlationId);

  // Create a child logger with correlation ID for this request
  (req as any).logger = createChildLogger({
    correlationId,
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  // Log incoming request
  (req as any).logger.info(
    {
      method: req.method,
      url: req.url,
      userAgent: req.headers["user-agent"],
    },
    "Incoming request"
  );

  // Log response when finished
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? "warn" : "info";
    (req as any).logger[logLevel](
      {
        statusCode: res.statusCode,
        duration,
      },
      "Request completed"
    );
  });

  next();
}

/**
 * Get correlation ID from request
 */
export function getCorrelationId(req: Request): string {
  return (req as any).correlationId || "unknown";
}

/**
 * Get request logger (with correlation ID)
 */
export function getRequestLogger(req: Request) {
  return (req as any).logger || logger;
}

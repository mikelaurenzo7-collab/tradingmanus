import pino from "pino";

/**
 * Centralized logging framework using Pino
 * Provides structured logging with correlation IDs for request tracing
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    env: process.env.NODE_ENV || "development",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "apiKey",
      "apiSecret",
      "apiPassphrase",
      "privateKey",
      "secret",
      "token",
      "encryptedData",
      "*.password",
      "*.apiKey",
      "*.apiSecret",
      "*.apiPassphrase",
      "*.privateKey",
      "*.secret",
      "*.token",
      "*.encryptedData",
    ],
    censor: "[REDACTED]",
  },
});

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Log audit events for security-sensitive operations
 */
export function logAudit(event: {
  action: string;
  userId?: number;
  openId?: string;
  resource?: string;
  details?: Record<string, unknown>;
  success: boolean;
  error?: string;
}) {
  logger.info(
    {
      type: "audit",
      ...event,
    },
    `Audit: ${event.action}`
  );
}

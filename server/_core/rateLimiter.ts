import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { logger } from "./logger";

/**
 * Rate limiter for general API endpoints
 * Limits to 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: "Too many requests from this IP, please try again later." },
  handler: (req: Request, res: Response) => {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
      },
      "Rate limit exceeded"
    );
    res.status(429).json({
      error: "Too many requests from this IP, please try again later.",
    });
  },
});

/**
 * Strict rate limiter for authentication endpoints
 * Limits to 5 requests per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  message: { error: "Too many authentication attempts, please try again later." },
  handler: (req: Request, res: Response) => {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
      },
      "Auth rate limit exceeded"
    );
    res.status(429).json({
      error: "Too many authentication attempts, please try again later.",
    });
  },
});

/**
 * Rate limiter for scheduled/cron endpoints
 * Limits to 20 requests per minute
 */
export const scheduledLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Limit to 20 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many scheduled requests, please try again later." },
  handler: (req: Request, res: Response) => {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
      },
      "Scheduled rate limit exceeded"
    );
    res.status(429).json({
      error: "Too many scheduled requests, please try again later.",
    });
  },
});

/**
 * Rate limiter for trading actions
 * Limits to 30 orders per minute per user
 */
export const tradingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit to 30 trading actions per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many trading requests, please try again later." },
  handler: (req: Request, res: Response) => {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
      },
      "Trading rate limit exceeded"
    );
    res.status(429).json({
      error: "Too many trading requests, please try again later.",
    });
  },
});

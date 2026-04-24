# Kalshi API repository review notes

- The GitHub `kalshi-api` topic page surfaces a broader set of resources than the single `quantgalore/kalshi-trading` repository, including a high-star autonomous bot, the `pykalshi` unofficial Python client, Rust SDKs, data collectors, and multi-market prediction-market frameworks.
- The most promising categories for this project are client libraries and data/market-structure tools rather than strategy repos with narrow market assumptions.
- The current review priority is to inspect repositories that may improve market data normalization, execution reliability, and candidate selection for standard Kalshi markets.

The `pykalshi` repository appears materially useful as a **reference implementation for production-grade client behavior**. Its most relevant patterns for this project are WebSocket streaming, automatic retries and backoff, typed domain models for markets and orders, local orderbook state management from deltas, and explicit portfolio/order workflows. It also highlights concrete production concerns we should keep tightening in this app: bounded error handling, rate-limit resilience, better orderbook-driven market qualification, and cleaner separation between market browsing, signal generation, and order execution.


# PriceWatch — Design Document

**Date:** 2026-03-05
**Status:** Approved

## Goal

Build an event-driven price tracking system using microservices. Users add product URLs with target prices. The system periodically scrapes prices and sends notifications (Discord + email) when prices drop below target.

## Architecture Decisions

### Scraping Strategy
- **Amazon**: Dedicated Cheerio parser targeting known price selectors (`.a-price-whole`, `.a-price-fraction`, `#priceblock_ourprice`)
- **Other sites**: Extract pricing from JSON-LD structured data (`@type: Product` -> `offers.price`) or OpenGraph meta tags (`og:price:amount`)
- **Fallback**: Return error, mark product for manual review
- **Rationale**: No CSS selector input needed from user. Amazon covers the primary use case; JSON-LD covers most modern e-commerce sites.

### Notification Channels
- **Discord webhook**: Rich embed with product name, old price, new price, URL, and timestamp
- **Email (Nodemailer + Gmail SMTP)**: HTML email with same info
- **Per-alert configuration**: Each alert specifies `notification_channel: 'email' | 'discord' | 'both'`
- **Rationale**: Discord is visual and easy to demo. Email is practical and expected.

### Message Broker (RabbitMQ)
- Exchange: `pricewatch.events` (topic exchange)
- Queues:
  - `price.check.requested` — scheduler publishes, scraper consumes
  - `price.dropped` — scraper publishes, notification consumes
  - `price.check.dlq` — dead letter queue for failed scrapes
- Retry: 3 attempts with exponential backoff (1s, 2s, 4s), then DLQ

### Database
- PostgreSQL with Prisma ORM
- Three tables: `products`, `alerts`, `price_history`
- `alerts` includes `notification_channel` field and optional `discord_webhook_url`
- `products` includes `store` field for parser routing

### Services
1. **API** (port 3000) — REST endpoints for products and alerts
2. **Scraper** — consumes price check requests, scrapes, saves history, detects drops
3. **Notification** — consumes price drop events, sends Discord + email
4. **Scheduler** — cron job publishes batch price checks for active products

## Non-Goals
- No frontend/UI (API only)
- No user authentication (portfolio scope)
- No real-time websockets
- No price prediction or analytics

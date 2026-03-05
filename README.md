# PriceWatch

> Event-driven price tracking system built with microservices architecture.
> Users add product URLs with target prices — the system monitors them and fires notifications when prices drop.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode, no `any`) |
| Runtime | Node.js 20+ |
| Framework | Express.js |
| Message Broker | RabbitMQ |
| Primary Database | PostgreSQL 15 |
| ORM | Prisma |
| Containerization | Docker + Docker Compose |
| HTTP Scraping | Puppeteer + Cheerio (Amazon) / Axios + JSON-LD (generic) |
| Notifications | Nodemailer (Gmail SMTP) + Discord Webhook |
| Scheduling | node-cron |
| Resilience | Dead Letter Queue + Retry logic |
| Testing | Jest + Supertest |
| Linting | ESLint + Prettier |

---

## Architecture

```
+---------------------------------------------+
|               API Service :3000              |
|           (Express + TypeScript)             |
|                                              |
|  POST /products        -> add product        |
|  GET  /products        -> list products      |
|  POST /alerts          -> set target price   |
|  GET  /alerts/:id      -> alert status       |
+----------------------+-----------------------+
                       | publish
                       v
+---------------------------------------------+
|                 RabbitMQ                     |
|                                             |
|  exchange:  pricewatch.events               |
|  queue:     price.check.requested           |
|  queue:     price.dropped                   |
|  queue:     price.check.dlq   (Dead Letter) |
+-------+-------------------------+-----------+
        | consume                 | consume
        v                         v
+--------------+       +--------------------+
|   Scraper    |       |   Notification     |
|   Service    |       |   Service          |
|              |       |                    |
| Amazon parser|       | Discord webhook    |
| + JSON-LD    |       | Email (Nodemailer) |
| fallback     |       +--------------------+
| save price   |
| publish      |
| price.drop   |
+------+-------+
       | read/write
       v
+---------------------------------------------+
|               PostgreSQL                     |
|                                              |
|  products . alerts . price_history          |
+---------------------------------------------+
       ^
       | triggers every N minutes
+------+------+
|  Scheduler  |
|  Service    |
|  (cron job) |
+-------------+
```

---

## Scraping Strategy

1. **Amazon URLs** — dedicated Puppeteer headless browser parser using known CSS selectors for price extraction
2. **All other URLs** — JSON-LD structured data (`@type: Product`) or `og:price:amount` meta tags (works with IKEA, Best Buy, Target, etc.)
3. **No match** — clear error message, product marked for review

---

## Dead Letter Queue — Retry Flow

When the scraper fails (timeout, 404, parse error):

```
price.check.requested
        |
        | FAIL (max 3 retries with exponential backoff)
        v
price.check.dlq
        |
        | DLQ consumer logs failure
        v
products.scrape_status = 'failed'  (in DB)
```

Each retry attempt is tracked. After 3 failures the product is marked `failed` and excluded from future scheduling until manually re-activated via API.

---

## Database Schema

```sql
-- products
id            UUID PRIMARY KEY
url           TEXT NOT NULL
name          TEXT
store         TEXT DEFAULT 'unknown'  -- amazon | generic
scrape_status TEXT DEFAULT 'active'   -- active | failed
created_at    TIMESTAMP

-- alerts
id                    UUID PRIMARY KEY
product_id            UUID REFERENCES products(id)
user_email            TEXT
discord_webhook_url   TEXT
target_price          DECIMAL(10,2) NOT NULL
notification_channel  TEXT DEFAULT 'both'  -- email | discord | both
triggered             BOOLEAN DEFAULT false
created_at            TIMESTAMP

-- price_history
id            UUID PRIMARY KEY
product_id    UUID REFERENCES products(id)
price         DECIMAL(10,2) NOT NULL
currency      TEXT DEFAULT 'EUR'
scraped_at    TIMESTAMP
```

---

## Project Structure

```
pricewatch/
├── docker-compose.yml
├── .env.example
├── README.md
│
├── services/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── products.ts
│   │   │   │   └── alerts.ts
│   │   │   ├── controllers/
│   │   │   │   ├── products.controller.ts
│   │   │   │   └── alerts.controller.ts
│   │   │   ├── middleware/
│   │   │   │   ├── errorHandler.ts
│   │   │   │   └── validate.ts
│   │   │   ├── lib/
│   │   │   │   ├── db.ts          (Prisma client)
│   │   │   │   └── rabbitmq.ts    (connection + publish)
│   │   │   └── index.ts
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── scraper/
│   │   ├── src/
│   │   │   ├── consumer.ts        (listens price.check.requested)
│   │   │   ├── scrapers/
│   │   │   │   ├── amazon.ts      (Amazon-specific parser)
│   │   │   │   ├── jsonld.ts      (JSON-LD / meta tag parser)
│   │   │   │   └── index.ts       (router — picks parser by URL)
│   │   │   ├── dlq.consumer.ts    (listens price.check.dlq)
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── notification/
│   │   ├── src/
│   │   │   ├── consumer.ts        (listens price.dropped)
│   │   │   ├── channels/
│   │   │   │   ├── discord.ts     (Discord webhook sender)
│   │   │   │   └── email.ts       (Nodemailer sender)
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── scheduler/
│       ├── src/
│       │   ├── scheduler.ts       (cron job)
│       │   └── index.ts
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
│
└── shared/
    └── types/
        └── events.ts              (shared TS interfaces for all queue messages)
```

---

## Development Plan

### Phase 1 — Infrastructure
- [x] `docker-compose.yml` — postgres, rabbitmq, all services
- [x] `.env.example` with all variables
- [x] Prisma schema + migrations
- [x] Shared `events.ts` — TypeScript interfaces for all queue messages
- [x] RabbitMQ helper — connection, publish, consume, DLQ setup

### Phase 2 — API Service
- [x] Express setup + middleware (error handler, validation)
- [x] `POST /products` — add product (auto-detect store type)
- [x] `GET /products` — list with latest price
- [x] `POST /alerts` — set target price, email, discord webhook, channel preference
- [x] `GET /alerts/:id` — alert status
- [x] Publish `price.check.requested` event

### Phase 3 — Scraper Service
- [x] Consume `price.check.requested`
- [x] Amazon parser (Cheerio)
- [x] JSON-LD / meta tag fallback parser
- [x] Save price to `price_history`
- [x] Compare with target prices -> publish `price.dropped`
- [x] Retry logic — exponential backoff (1s -> 2s -> 4s)
- [x] DLQ consumer — log + mark `scrape_status = failed`

### Phase 4 — Notification + Scheduler
- [x] Consume `price.dropped`
- [x] Discord webhook notification with embed
- [x] Email notification via Nodemailer
- [x] Scheduler — cron job every 30 min for active products
- [x] Publish `price.check.requested` batch

### Phase 5 — Polish
- [x] Jest tests for API endpoints (Supertest)
- [x] Jest tests for scraper logic (mock axios)
- [x] ESLint + Prettier configuration
- [x] README — final diagrams, setup instructions, API examples
- [x] GitHub Actions CI — lint + test on every push

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- Node.js 20+ (for local development)

### Setup

```bash
# 1. Clone repo
git clone https://github.com/lemmy-code/pricewatch
cd pricewatch

# 2. Environment
cp .env.example .env
# Edit .env to add your Discord webhook URL and/or Gmail SMTP credentials

# 3. Start everything
docker-compose up --build

# 4. Run database migrations (in a new terminal)
docker exec pricewatch-api-1 npx prisma migrate dev --name init

# API is available at http://localhost:3000
# RabbitMQ Management UI at http://localhost:15672 (guest/guest)
```

### Verify it works

```bash
# Health check
curl http://localhost:3000/health
# -> {"status":"ok"}
```

---

## API Examples

```bash
# Add a product (store type auto-detected from URL)
# Works with any site that has JSON-LD structured data (IKEA, Best Buy, Target, etc.)
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.ikea.com/us/en/p/kallax-shelf-unit-white-20275814/", "name": "IKEA KALLAX Shelf Unit"}'
# -> {"id":"uuid","url":"...","name":"IKEA KALLAX Shelf Unit","store":"generic","scrapeStatus":"active",...}

# Amazon products use dedicated Puppeteer-based parser
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.amazon.com/dp/B0CT5KP3GL", "name": "Sony WH-1000XM5"}'
# -> {"id":"uuid","url":"...","name":"Sony WH-1000XM5","store":"amazon","scrapeStatus":"active",...}

# Set a price alert (Discord + Email)
curl -X POST http://localhost:3000/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "uuid-from-above",
    "userEmail": "you@email.com",
    "discordWebhookUrl": "https://discord.com/api/webhooks/...",
    "targetPrice": 45.00,
    "notificationChannel": "both"
  }'

# List all products with latest prices
curl http://localhost:3000/products
# -> [{"id":"...","name":"IKEA KALLAX Shelf Unit","latestPrice":"44.99","currency":"USD","alertCount":1,...}]

# Check alert status
curl http://localhost:3000/alerts/{alert-id}

# Reactivate a failed product
curl -X PATCH http://localhost:3000/products/{product-id}/reactivate

# Test: simulate a price drop (triggers Discord/email notifications)
curl -X POST http://localhost:3000/test/price-drop \
  -H "Content-Type: application/json" \
  -d '{"productId": "uuid-here"}'
# -> {"message":"Price drop event published","alerts":1}
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://postgres:password@postgres:5432/pricewatch

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672

# Scheduler
CHECK_INTERVAL_MINUTES=30

# Email (Gmail SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Discord (default webhook, can also be per-alert)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-id/your-webhook-token
```

---

## Testing

```bash
# Run API tests (14 tests)
cd services/api && npx jest --verbose

# Run scraper tests (13 tests)
cd services/scraper && npx jest --verbose

# Lint all services
npm run lint
```

---

## Key Concepts Demonstrated

- **Microservices** — 4 independent services with clear responsibilities
- **Event-Driven Architecture** — asynchronous communication via RabbitMQ
- **Dead Letter Queue** — production-ready error handling with retry logic
- **Docker Compose** — entire stack with one command
- **TypeScript Strict** — shared types between services, zero `any`
- **Prisma ORM** — type-safe database queries
- **Multi-Channel Notifications** — Discord webhooks + email via Nodemailer
- **Web Scraping** — Puppeteer headless browser (Amazon) + JSON-LD structured data (generic sites)
- **CI/CD** — GitHub Actions pipeline
- **Input Validation** — Zod schemas on all endpoints
- **27 Unit Tests** — Jest + Supertest with mocked dependencies

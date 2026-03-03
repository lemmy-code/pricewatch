# PriceWatch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an event-driven price tracking microservices system with RabbitMQ, PostgreSQL, Docker, and multi-channel notifications.

**Architecture:** 4 TypeScript microservices (API, Scraper, Notification, Scheduler) communicating via RabbitMQ topic exchange. PostgreSQL stores products, alerts, and price history. Scraper supports Amazon + JSON-LD. Notifications via Discord webhook + email.

**Tech Stack:** TypeScript strict, Express, Prisma, RabbitMQ (amqplib), Axios, Cheerio, Nodemailer, node-cron, Docker Compose, Jest + Supertest

**Important:** No Claude attribution in any git commits.

---

## Task 1: Shared Types + Environment Config

**Files:**
- Create: `shared/types/events.ts`
- Create: `.env.example`

**Step 1: Create shared event types**

```typescript
// shared/types/events.ts

export interface PriceCheckRequestedEvent {
  productId: string;
  url: string;
  store: 'amazon' | 'generic';
}

export interface PriceDroppedEvent {
  productId: string;
  productName: string;
  url: string;
  oldPrice: number;
  newPrice: number;
  currency: string;
  alerts: AlertInfo[];
}

export interface AlertInfo {
  alertId: string;
  userEmail: string | null;
  discordWebhookUrl: string | null;
  notificationChannel: 'email' | 'discord' | 'both';
  targetPrice: number;
}

export const EXCHANGE_NAME = 'pricewatch.events';
export const QUEUES = {
  PRICE_CHECK_REQUESTED: 'price.check.requested',
  PRICE_DROPPED: 'price.dropped',
  PRICE_CHECK_DLQ: 'price.check.dlq',
} as const;

export const ROUTING_KEYS = {
  PRICE_CHECK_REQUESTED: 'price.check.requested',
  PRICE_DROPPED: 'price.dropped',
} as const;
```

**Step 2: Create .env.example**

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

**Step 3: Commit**

```bash
git add shared/ .env.example
git commit -m "feat: add shared event types and env config"
```

---

## Task 2: Prisma Schema + API Service Scaffold

**Files:**
- Create: `services/api/package.json`
- Create: `services/api/tsconfig.json`
- Create: `services/api/prisma/schema.prisma`
- Create: `services/api/src/lib/db.ts`
- Create: `services/api/src/index.ts`

**Step 1: Create API package.json**

```json
{
  "name": "@pricewatch/api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest --passWithNoTests",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@prisma/client": "^6.4.1",
    "amqplib": "^0.10.5",
    "express": "^4.21.2",
    "uuid": "^11.1.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/amqplib": "^0.10.6",
    "@types/express": "^5.0.1",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.13.10",
    "@types/uuid": "^10.0.0",
    "jest": "^29.7.0",
    "prisma": "^6.4.1",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2",
    "ts-jest": "^29.2.6",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "paths": {
      "@shared/*": ["../../shared/*"]
    },
    "baseUrl": "."
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create Prisma schema**

```prisma
// services/api/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id           String         @id @default(uuid())
  url          String
  name         String?
  store        String         @default("generic")
  scrapeStatus String         @default("active") @map("scrape_status")
  createdAt    DateTime       @default(now()) @map("created_at")
  alerts       Alert[]
  priceHistory PriceHistory[]

  @@map("products")
}

model Alert {
  id                  String   @id @default(uuid())
  productId           String   @map("product_id")
  userEmail           String?  @map("user_email")
  discordWebhookUrl   String?  @map("discord_webhook_url")
  targetPrice         Decimal  @map("target_price") @db.Decimal(10, 2)
  notificationChannel String   @default("both") @map("notification_channel")
  triggered           Boolean  @default(false)
  createdAt           DateTime @default(now()) @map("created_at")
  product             Product  @relation(fields: [productId], references: [id])

  @@map("alerts")
}

model PriceHistory {
  id        String   @id @default(uuid())
  productId String   @map("product_id")
  price     Decimal  @db.Decimal(10, 2)
  currency  String   @default("EUR")
  scrapedAt DateTime @default(now()) @map("scraped_at")
  product   Product  @relation(fields: [productId], references: [id])

  @@map("price_history")
}
```

**Step 4: Create Prisma client singleton**

```typescript
// services/api/src/lib/db.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;
```

**Step 5: Create minimal Express index.ts**

```typescript
// services/api/src/index.ts
import express from 'express';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API service running on port ${PORT}`);
});

export default app;
```

**Step 6: Install deps and commit**

```bash
cd services/api && npm install
npx prisma generate
cd ../..
git add services/api/
git commit -m "feat: scaffold API service with Prisma schema"
```

---

## Task 3: RabbitMQ Helper Library

**Files:**
- Create: `services/api/src/lib/rabbitmq.ts`

**Step 1: Create RabbitMQ connection + publish + consume helper**

```typescript
// services/api/src/lib/rabbitmq.ts
import amqplib, { Channel, Connection } from 'amqplib';
import { EXCHANGE_NAME, QUEUES } from '../../../../shared/types/events';

let connection: Connection | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ(): Promise<Channel> {
  if (channel) return channel;

  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

  connection = await amqplib.connect(url);
  channel = await connection.createChannel();

  // Declare topic exchange
  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

  // Declare queues
  await channel.assertQueue(QUEUES.PRICE_CHECK_DLQ, { durable: true });

  await channel.assertQueue(QUEUES.PRICE_CHECK_REQUESTED, {
    durable: true,
    deadLetterExchange: EXCHANGE_NAME,
    deadLetterRoutingKey: QUEUES.PRICE_CHECK_DLQ,
  });

  await channel.assertQueue(QUEUES.PRICE_DROPPED, { durable: true });

  // Bind queues to exchange
  await channel.bindQueue(QUEUES.PRICE_CHECK_REQUESTED, EXCHANGE_NAME, QUEUES.PRICE_CHECK_REQUESTED);
  await channel.bindQueue(QUEUES.PRICE_DROPPED, EXCHANGE_NAME, QUEUES.PRICE_DROPPED);
  await channel.bindQueue(QUEUES.PRICE_CHECK_DLQ, EXCHANGE_NAME, QUEUES.PRICE_CHECK_DLQ);

  console.log('Connected to RabbitMQ');
  return channel;
}

export async function publishMessage(routingKey: string, message: unknown): Promise<void> {
  const ch = await connectRabbitMQ();
  ch.publish(
    EXCHANGE_NAME,
    routingKey,
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );
}

export async function closeRabbitMQ(): Promise<void> {
  if (channel) await channel.close();
  if (connection) await connection.close();
  channel = null;
  connection = null;
}
```

**Step 2: Commit**

```bash
git add services/api/src/lib/rabbitmq.ts
git commit -m "feat: add RabbitMQ connection helper with DLQ setup"
```

---

## Task 4: API Middleware (Error Handler + Validation)

**Files:**
- Create: `services/api/src/middleware/errorHandler.ts`
- Create: `services/api/src/middleware/validate.ts`

**Step 1: Create error handler middleware**

```typescript
// services/api/src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
```

**Step 2: Create Zod validation middleware**

```typescript
// services/api/src/middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: err.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(err);
    }
  };
}
```

**Step 3: Commit**

```bash
git add services/api/src/middleware/
git commit -m "feat: add error handler and Zod validation middleware"
```

---

## Task 5: Products Controller + Routes

**Files:**
- Create: `services/api/src/controllers/products.controller.ts`
- Create: `services/api/src/routes/products.ts`
- Modify: `services/api/src/index.ts`

**Step 1: Create products controller**

```typescript
// services/api/src/controllers/products.controller.ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/db';
import { publishMessage } from '../lib/rabbitmq';
import { ROUTING_KEYS, PriceCheckRequestedEvent } from '../../../../shared/types/events';
import { AppError } from '../middleware/errorHandler';

function detectStore(url: string): 'amazon' | 'generic' {
  if (/amazon\.(com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp)/i.test(url)) {
    return 'amazon';
  }
  return 'generic';
}

export async function createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { url, name } = req.body;
    const store = detectStore(url);

    const product = await prisma.product.create({
      data: { url, name, store },
    });

    // Publish initial price check
    const event: PriceCheckRequestedEvent = {
      productId: product.id,
      url: product.url,
      store: product.store as 'amazon' | 'generic',
    };
    await publishMessage(ROUTING_KEYS.PRICE_CHECK_REQUESTED, event);

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
}

export async function listProducts(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const products = await prisma.product.findMany({
      include: {
        priceHistory: {
          orderBy: { scrapedAt: 'desc' },
          take: 1,
        },
        _count: { select: { alerts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = products.map((p) => ({
      id: p.id,
      url: p.url,
      name: p.name,
      store: p.store,
      scrapeStatus: p.scrapeStatus,
      createdAt: p.createdAt,
      latestPrice: p.priceHistory[0]?.price ?? null,
      currency: p.priceHistory[0]?.currency ?? null,
      lastScrapedAt: p.priceHistory[0]?.scrapedAt ?? null,
      alertCount: p._count.alerts,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function reactivateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { scrapeStatus: 'active' },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
```

**Step 2: Create products routes with Zod schemas**

```typescript
// services/api/src/routes/products.ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { createProduct, listProducts, reactivateProduct } from '../controllers/products.controller';

const router = Router();

const createProductSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
});

router.post('/', validate(createProductSchema), createProduct);
router.get('/', listProducts);
router.patch('/:id/reactivate', reactivateProduct);

export default router;
```

**Step 3: Update index.ts to wire routes**

```typescript
// services/api/src/index.ts
import express from 'express';
import productRoutes from './routes/products';
import alertRoutes from './routes/alerts';
import { errorHandler } from './middleware/errorHandler';
import { connectRabbitMQ } from './lib/rabbitmq';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/products', productRoutes);
app.use('/alerts', alertRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

async function start(): Promise<void> {
  await connectRabbitMQ();
  app.listen(PORT, () => {
    console.log(`API service running on port ${PORT}`);
  });
}

start().catch(console.error);

export default app;
```

**Step 4: Commit**

```bash
git add services/api/src/controllers/products.controller.ts services/api/src/routes/products.ts services/api/src/index.ts
git commit -m "feat: add products endpoints (POST, GET, PATCH reactivate)"
```

---

## Task 6: Alerts Controller + Routes

**Files:**
- Create: `services/api/src/controllers/alerts.controller.ts`
- Create: `services/api/src/routes/alerts.ts`

**Step 1: Create alerts controller**

```typescript
// services/api/src/controllers/alerts.controller.ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/db';
import { AppError } from '../middleware/errorHandler';

export async function createAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { productId, userEmail, discordWebhookUrl, targetPrice, notificationChannel } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    const alert = await prisma.alert.create({
      data: {
        productId,
        userEmail,
        discordWebhookUrl,
        targetPrice,
        notificationChannel: notificationChannel || 'both',
      },
    });

    res.status(201).json(alert);
  } catch (err) {
    next(err);
  }
}

export async function getAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            priceHistory: {
              orderBy: { scrapedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!alert) {
      throw new AppError(404, 'Alert not found');
    }

    res.json({
      ...alert,
      currentPrice: alert.product.priceHistory[0]?.price ?? null,
    });
  } catch (err) {
    next(err);
  }
}
```

**Step 2: Create alerts routes**

```typescript
// services/api/src/routes/alerts.ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { createAlert, getAlert } from '../controllers/alerts.controller';

const router = Router();

const createAlertSchema = z.object({
  productId: z.string().uuid(),
  userEmail: z.string().email().optional(),
  discordWebhookUrl: z.string().url().optional(),
  targetPrice: z.number().positive(),
  notificationChannel: z.enum(['email', 'discord', 'both']).default('both'),
}).refine(
  (data) => data.userEmail || data.discordWebhookUrl,
  { message: 'At least one of userEmail or discordWebhookUrl is required' }
);

router.post('/', validate(createAlertSchema), createAlert);
router.get('/:id', getAlert);

export default router;
```

**Step 3: Commit**

```bash
git add services/api/src/controllers/alerts.controller.ts services/api/src/routes/alerts.ts
git commit -m "feat: add alerts endpoints (POST, GET by ID)"
```

---

## Task 7: Scraper Service — Scaffold + Consumer

**Files:**
- Create: `services/scraper/package.json`
- Create: `services/scraper/tsconfig.json`
- Create: `services/scraper/src/index.ts`
- Create: `services/scraper/src/consumer.ts`

**Step 1: Create scraper package.json**

```json
{
  "name": "@pricewatch/scraper",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest --passWithNoTests"
  },
  "dependencies": {
    "@prisma/client": "^6.4.1",
    "amqplib": "^0.10.5",
    "axios": "^1.7.9",
    "cheerio": "^1.0.0"
  },
  "devDependencies": {
    "@types/amqplib": "^0.10.6",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.13.10",
    "jest": "^29.7.0",
    "prisma": "^6.4.1",
    "ts-jest": "^29.2.6",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2"
  }
}
```

**Step 2: Create tsconfig.json** (same pattern as API, rootDir ./src, outDir ./dist)

**Step 3: Create consumer**

```typescript
// services/scraper/src/consumer.ts
import amqplib, { Channel, ConsumeMessage } from 'amqplib';
import { EXCHANGE_NAME, QUEUES, ROUTING_KEYS, PriceCheckRequestedEvent, PriceDroppedEvent, AlertInfo } from '../../../shared/types/events';
import { scrapePrice } from './scrapers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MAX_RETRIES = 3;

export async function startConsumer(): Promise<void> {
  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  const connection = await amqplib.connect(url);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await channel.assertQueue(QUEUES.PRICE_CHECK_DLQ, { durable: true });
  await channel.assertQueue(QUEUES.PRICE_CHECK_REQUESTED, {
    durable: true,
    deadLetterExchange: EXCHANGE_NAME,
    deadLetterRoutingKey: QUEUES.PRICE_CHECK_DLQ,
  });
  await channel.bindQueue(QUEUES.PRICE_CHECK_REQUESTED, EXCHANGE_NAME, QUEUES.PRICE_CHECK_REQUESTED);
  await channel.bindQueue(QUEUES.PRICE_CHECK_DLQ, EXCHANGE_NAME, QUEUES.PRICE_CHECK_DLQ);

  await channel.prefetch(1);

  console.log('Scraper consumer waiting for messages...');

  await channel.consume(QUEUES.PRICE_CHECK_REQUESTED, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;
    const event: PriceCheckRequestedEvent = JSON.parse(msg.content.toString());

    console.log(`Processing price check for ${event.url} (attempt ${retryCount + 1})`);

    try {
      const result = await scrapePrice(event.url, event.store);

      // Save to price_history
      await prisma.priceHistory.create({
        data: {
          productId: event.productId,
          price: result.price,
          currency: result.currency,
        },
      });

      // Check alerts for price drops
      const alerts = await prisma.alert.findMany({
        where: {
          productId: event.productId,
          triggered: false,
          targetPrice: { gte: result.price },
        },
      });

      if (alerts.length > 0) {
        // Get previous price
        const previousPrices = await prisma.priceHistory.findMany({
          where: { productId: event.productId },
          orderBy: { scrapedAt: 'desc' },
          take: 2,
        });

        const oldPrice = previousPrices[1]?.price ?? result.price;

        const product = await prisma.product.findUnique({ where: { id: event.productId } });

        const alertInfos: AlertInfo[] = alerts.map((a) => ({
          alertId: a.id,
          userEmail: a.userEmail,
          discordWebhookUrl: a.discordWebhookUrl,
          notificationChannel: a.notificationChannel as 'email' | 'discord' | 'both',
          targetPrice: Number(a.targetPrice),
        }));

        const dropEvent: PriceDroppedEvent = {
          productId: event.productId,
          productName: product?.name || 'Unknown Product',
          url: event.url,
          oldPrice: Number(oldPrice),
          newPrice: result.price,
          currency: result.currency,
          alerts: alertInfos,
        };

        channel.publish(
          EXCHANGE_NAME,
          ROUTING_KEYS.PRICE_DROPPED,
          Buffer.from(JSON.stringify(dropEvent)),
          { persistent: true }
        );

        // Mark alerts as triggered
        await prisma.alert.updateMany({
          where: { id: { in: alerts.map((a) => a.id) } },
          data: { triggered: true },
        });
      }

      channel.ack(msg);
    } catch (err) {
      console.error(`Scrape failed for ${event.url}:`, err);

      if (retryCount < MAX_RETRIES - 1) {
        // Retry with exponential backoff
        const delay = Math.pow(2, retryCount) * 1000;
        setTimeout(() => {
          channel.publish(
            EXCHANGE_NAME,
            ROUTING_KEYS.PRICE_CHECK_REQUESTED,
            Buffer.from(JSON.stringify(event)),
            {
              persistent: true,
              headers: { 'x-retry-count': retryCount + 1 },
            }
          );
          channel.ack(msg);
        }, delay);
      } else {
        // Max retries exceeded — send to DLQ
        channel.nack(msg, false, false);
      }
    }
  });
}
```

**Step 4: Create scraper index.ts**

```typescript
// services/scraper/src/index.ts
import { startConsumer } from './consumer';
import { startDlqConsumer } from './dlq.consumer';

async function main(): Promise<void> {
  console.log('Starting scraper service...');
  await startConsumer();
  await startDlqConsumer();
}

main().catch(console.error);
```

**Step 5: Install deps and commit**

```bash
cd services/scraper && npm install
cd ../..
git add services/scraper/
git commit -m "feat: add scraper service with consumer and retry logic"
```

---

## Task 8: Scraper Parsers (Amazon + JSON-LD)

**Files:**
- Create: `services/scraper/src/scrapers/amazon.ts`
- Create: `services/scraper/src/scrapers/jsonld.ts`
- Create: `services/scraper/src/scrapers/index.ts`

**Step 1: Create Amazon parser**

```typescript
// services/scraper/src/scrapers/amazon.ts
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapeResult {
  price: number;
  currency: string;
}

export async function scrapeAmazon(url: string): Promise<ScrapeResult> {
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 10000,
  });

  const $ = cheerio.load(html);

  // Try multiple Amazon price selectors
  const selectors = [
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price-whole',
    'span.a-color-price',
  ];

  let priceText: string | null = null;

  for (const selector of selectors) {
    const el = $(selector).first();
    if (el.length) {
      priceText = el.text().trim();
      break;
    }
  }

  if (!priceText) {
    throw new Error('Could not find price on Amazon page');
  }

  // Parse price: remove currency symbols, handle commas
  const cleaned = priceText.replace(/[^0-9.,]/g, '');
  // Handle European format (1.234,56) vs US format (1,234.56)
  let price: number;
  if (cleaned.includes(',') && cleaned.indexOf(',') > cleaned.lastIndexOf('.')) {
    price = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  } else {
    price = parseFloat(cleaned.replace(/,/g, ''));
  }

  if (isNaN(price)) {
    throw new Error(`Could not parse price from: ${priceText}`);
  }

  // Detect currency from symbol
  const currency = priceText.includes('$') ? 'USD' :
                   priceText.includes('£') ? 'GBP' :
                   priceText.includes('€') ? 'EUR' : 'USD';

  return { price, currency };
}
```

**Step 2: Create JSON-LD / meta tag parser**

```typescript
// services/scraper/src/scrapers/jsonld.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScrapeResult } from './amazon';

export async function scrapeJsonLd(url: string): Promise<ScrapeResult> {
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    timeout: 10000,
  });

  const $ = cheerio.load(html);

  // Try JSON-LD first
  const jsonLdScripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLdScripts.length; i++) {
    try {
      const data = JSON.parse($(jsonLdScripts[i]).html() || '');
      const result = extractFromJsonLd(data);
      if (result) return result;
    } catch {
      continue;
    }
  }

  // Fallback: OpenGraph meta tags
  const ogPrice = $('meta[property="og:price:amount"]').attr('content')
    || $('meta[property="product:price:amount"]').attr('content');
  const ogCurrency = $('meta[property="og:price:currency"]').attr('content')
    || $('meta[property="product:price:currency"]').attr('content')
    || 'EUR';

  if (ogPrice) {
    const price = parseFloat(ogPrice);
    if (!isNaN(price)) {
      return { price, currency: ogCurrency };
    }
  }

  throw new Error('Could not extract price from JSON-LD or meta tags');
}

function extractFromJsonLd(data: unknown): ScrapeResult | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = extractFromJsonLd(item);
      if (result) return result;
    }
    return null;
  }

  if (typeof data !== 'object' || data === null) return null;

  const obj = data as Record<string, unknown>;

  if (obj['@type'] === 'Product' || obj['@type'] === 'IndividualProduct') {
    const offers = obj['offers'] as Record<string, unknown> | Record<string, unknown>[] | undefined;
    if (offers) {
      return extractFromOffers(offers);
    }
  }

  // Check @graph
  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    return extractFromJsonLd(obj['@graph']);
  }

  return null;
}

function extractFromOffers(offers: unknown): ScrapeResult | null {
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const result = extractFromOffers(offer);
      if (result) return result;
    }
    return null;
  }

  if (typeof offers !== 'object' || offers === null) return null;

  const obj = offers as Record<string, unknown>;
  const price = parseFloat(String(obj['price'] || obj['lowPrice'] || ''));
  const currency = String(obj['priceCurrency'] || 'EUR');

  if (!isNaN(price) && price > 0) {
    return { price, currency };
  }

  return null;
}
```

**Step 3: Create scraper router**

```typescript
// services/scraper/src/scrapers/index.ts
import { scrapeAmazon, ScrapeResult } from './amazon';
import { scrapeJsonLd } from './jsonld';

export type { ScrapeResult };

export async function scrapePrice(url: string, store: string): Promise<ScrapeResult> {
  if (store === 'amazon') {
    return scrapeAmazon(url);
  }
  return scrapeJsonLd(url);
}
```

**Step 4: Commit**

```bash
git add services/scraper/src/scrapers/
git commit -m "feat: add Amazon and JSON-LD price scrapers"
```

---

## Task 9: DLQ Consumer

**Files:**
- Create: `services/scraper/src/dlq.consumer.ts`

**Step 1: Create DLQ consumer**

```typescript
// services/scraper/src/dlq.consumer.ts
import amqplib, { ConsumeMessage } from 'amqplib';
import { EXCHANGE_NAME, QUEUES, PriceCheckRequestedEvent } from '../../../shared/types/events';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function startDlqConsumer(): Promise<void> {
  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  const connection = await amqplib.connect(url);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await channel.assertQueue(QUEUES.PRICE_CHECK_DLQ, { durable: true });
  await channel.bindQueue(QUEUES.PRICE_CHECK_DLQ, EXCHANGE_NAME, QUEUES.PRICE_CHECK_DLQ);

  console.log('DLQ consumer waiting for failed messages...');

  await channel.consume(QUEUES.PRICE_CHECK_DLQ, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    const event: PriceCheckRequestedEvent = JSON.parse(msg.content.toString());
    console.error(`DEAD LETTER: Product ${event.productId} (${event.url}) failed after max retries`);

    await prisma.product.update({
      where: { id: event.productId },
      data: { scrapeStatus: 'failed' },
    });

    channel.ack(msg);
  });
}
```

**Step 2: Commit**

```bash
git add services/scraper/src/dlq.consumer.ts
git commit -m "feat: add DLQ consumer to mark failed products"
```

---

## Task 10: Notification Service

**Files:**
- Create: `services/notification/package.json`
- Create: `services/notification/tsconfig.json`
- Create: `services/notification/src/channels/discord.ts`
- Create: `services/notification/src/channels/email.ts`
- Create: `services/notification/src/consumer.ts`
- Create: `services/notification/src/index.ts`

**Step 1: Create notification package.json**

```json
{
  "name": "@pricewatch/notification",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest --passWithNoTests"
  },
  "dependencies": {
    "amqplib": "^0.10.5",
    "axios": "^1.7.9",
    "nodemailer": "^6.9.16"
  },
  "devDependencies": {
    "@types/amqplib": "^0.10.6",
    "@types/nodemailer": "^6.4.17",
    "@types/node": "^22.13.10",
    "@types/jest": "^29.5.14",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.6",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2"
  }
}
```

**Step 2: Create Discord webhook sender**

```typescript
// services/notification/src/channels/discord.ts
import axios from 'axios';
import { PriceDroppedEvent, AlertInfo } from '../../../../shared/types/events';

export async function sendDiscordNotification(
  event: PriceDroppedEvent,
  alert: AlertInfo
): Promise<void> {
  const webhookUrl = alert.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn(`No Discord webhook URL for alert ${alert.alertId}`);
    return;
  }

  const embed = {
    title: 'Price Drop Alert!',
    color: 0x00ff00,
    fields: [
      { name: 'Product', value: event.productName, inline: true },
      { name: 'Old Price', value: `${event.oldPrice} ${event.currency}`, inline: true },
      { name: 'New Price', value: `**${event.newPrice} ${event.currency}**`, inline: true },
      { name: 'Target Price', value: `${alert.targetPrice} ${event.currency}`, inline: true },
      { name: 'Savings', value: `${(event.oldPrice - event.newPrice).toFixed(2)} ${event.currency}`, inline: true },
    ],
    url: event.url,
    timestamp: new Date().toISOString(),
    footer: { text: 'PriceWatch' },
  };

  await axios.post(webhookUrl, {
    embeds: [embed],
  });

  console.log(`Discord notification sent for alert ${alert.alertId}`);
}
```

**Step 3: Create email sender**

```typescript
// services/notification/src/channels/email.ts
import nodemailer from 'nodemailer';
import { PriceDroppedEvent, AlertInfo } from '../../../../shared/types/events';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmailNotification(
  event: PriceDroppedEvent,
  alert: AlertInfo
): Promise<void> {
  if (!alert.userEmail) {
    console.warn(`No email for alert ${alert.alertId}`);
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2d9c2d;">Price Drop Alert!</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Product</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.productName}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Old Price</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.oldPrice} ${event.currency}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>New Price</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; color: #2d9c2d; font-weight: bold;">${event.newPrice} ${event.currency}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Your Target</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${alert.targetPrice} ${event.currency}</td>
        </tr>
        <tr>
          <td style="padding: 8px;"><strong>Savings</strong></td>
          <td style="padding: 8px; color: #2d9c2d;">${(event.oldPrice - event.newPrice).toFixed(2)} ${event.currency}</td>
        </tr>
      </table>
      <p style="margin-top: 20px;">
        <a href="${event.url}" style="background: #2d9c2d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
          View Product
        </a>
      </p>
      <p style="color: #888; font-size: 12px; margin-top: 30px;">Sent by PriceWatch</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: alert.userEmail,
    subject: `Price Drop: ${event.productName} is now ${event.newPrice} ${event.currency}`,
    html,
  });

  console.log(`Email notification sent to ${alert.userEmail} for alert ${alert.alertId}`);
}
```

**Step 4: Create notification consumer**

```typescript
// services/notification/src/consumer.ts
import amqplib, { ConsumeMessage } from 'amqplib';
import { EXCHANGE_NAME, QUEUES, PriceDroppedEvent } from '../../../shared/types/events';
import { sendDiscordNotification } from './channels/discord';
import { sendEmailNotification } from './channels/email';

export async function startConsumer(): Promise<void> {
  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  const connection = await amqplib.connect(url);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await channel.assertQueue(QUEUES.PRICE_DROPPED, { durable: true });
  await channel.bindQueue(QUEUES.PRICE_DROPPED, EXCHANGE_NAME, QUEUES.PRICE_DROPPED);

  await channel.prefetch(1);

  console.log('Notification consumer waiting for messages...');

  await channel.consume(QUEUES.PRICE_DROPPED, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    const event: PriceDroppedEvent = JSON.parse(msg.content.toString());
    console.log(`Price drop detected for ${event.productName}: ${event.oldPrice} -> ${event.newPrice}`);

    const promises: Promise<void>[] = [];

    for (const alert of event.alerts) {
      const channel = alert.notificationChannel;

      if (channel === 'discord' || channel === 'both') {
        promises.push(
          sendDiscordNotification(event, alert).catch((err) =>
            console.error(`Discord notification failed for alert ${alert.alertId}:`, err)
          )
        );
      }

      if (channel === 'email' || channel === 'both') {
        promises.push(
          sendEmailNotification(event, alert).catch((err) =>
            console.error(`Email notification failed for alert ${alert.alertId}:`, err)
          )
        );
      }
    }

    await Promise.all(promises);
    channel.ack(msg);
  });
}
```

Note: the `channel` variable inside the loop shadows the AMQP channel. Rename the loop variable to `notifChannel` during implementation.

**Step 5: Create notification index.ts**

```typescript
// services/notification/src/index.ts
import { startConsumer } from './consumer';

async function main(): Promise<void> {
  console.log('Starting notification service...');
  await startConsumer();
}

main().catch(console.error);
```

**Step 6: Install deps and commit**

```bash
cd services/notification && npm install
cd ../..
git add services/notification/
git commit -m "feat: add notification service with Discord and email channels"
```

---

## Task 11: Scheduler Service

**Files:**
- Create: `services/scheduler/package.json`
- Create: `services/scheduler/tsconfig.json`
- Create: `services/scheduler/src/scheduler.ts`
- Create: `services/scheduler/src/index.ts`

**Step 1: Create scheduler package.json**

```json
{
  "name": "@pricewatch/scheduler",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest --passWithNoTests"
  },
  "dependencies": {
    "@prisma/client": "^6.4.1",
    "amqplib": "^0.10.5",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "@types/amqplib": "^0.10.6",
    "@types/node": "^22.13.10",
    "@types/node-cron": "^3.0.11",
    "@types/jest": "^29.5.14",
    "jest": "^29.7.0",
    "prisma": "^6.4.1",
    "ts-jest": "^29.2.6",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2"
  }
}
```

**Step 2: Create scheduler logic**

```typescript
// services/scheduler/src/scheduler.ts
import cron from 'node-cron';
import amqplib from 'amqplib';
import { PrismaClient } from '@prisma/client';
import { EXCHANGE_NAME, ROUTING_KEYS, PriceCheckRequestedEvent } from '../../../shared/types/events';

const prisma = new PrismaClient();

export async function startScheduler(): Promise<void> {
  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  const connection = await amqplib.connect(url);
  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

  const intervalMinutes = Number(process.env.CHECK_INTERVAL_MINUTES) || 30;
  const cronExpression = `*/${intervalMinutes} * * * *`;

  console.log(`Scheduler running every ${intervalMinutes} minutes`);

  cron.schedule(cronExpression, async () => {
    console.log(`[${new Date().toISOString()}] Running scheduled price check...`);

    const activeProducts = await prisma.product.findMany({
      where: { scrapeStatus: 'active' },
    });

    console.log(`Found ${activeProducts.length} active products`);

    for (const product of activeProducts) {
      const event: PriceCheckRequestedEvent = {
        productId: product.id,
        url: product.url,
        store: product.store as 'amazon' | 'generic',
      };

      channel.publish(
        EXCHANGE_NAME,
        ROUTING_KEYS.PRICE_CHECK_REQUESTED,
        Buffer.from(JSON.stringify(event)),
        { persistent: true }
      );
    }

    console.log(`Published ${activeProducts.length} price check requests`);
  });
}
```

**Step 3: Create scheduler index.ts**

```typescript
// services/scheduler/src/index.ts
import { startScheduler } from './scheduler';

async function main(): Promise<void> {
  console.log('Starting scheduler service...');
  await startScheduler();
}

main().catch(console.error);
```

**Step 4: Install deps and commit**

```bash
cd services/scheduler && npm install
cd ../..
git add services/scheduler/
git commit -m "feat: add scheduler service with cron-based price checking"
```

---

## Task 12: Docker Compose + Dockerfiles

**Files:**
- Create: `docker-compose.yml`
- Create: `services/api/Dockerfile`
- Create: `services/scraper/Dockerfile`
- Create: `services/notification/Dockerfile`
- Create: `services/scheduler/Dockerfile`

**Step 1: Create docker-compose.yml**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: pricewatch
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build: ./services/api
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/pricewatch
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
      PORT: "3000"
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

  scraper:
    build: ./services/scraper
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/pricewatch
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

  notification:
    build: ./services/notification
    environment:
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
      SMTP_HOST: ${SMTP_HOST:-smtp.gmail.com}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
      DISCORD_WEBHOOK_URL: ${DISCORD_WEBHOOK_URL:-}
    depends_on:
      rabbitmq:
        condition: service_healthy

  scheduler:
    build: ./services/scheduler
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/pricewatch
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
      CHECK_INTERVAL_MINUTES: ${CHECK_INTERVAL_MINUTES:-30}
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

volumes:
  pgdata:
```

**Step 2: Create Dockerfile for each service** (all follow same pattern)

```dockerfile
# services/api/Dockerfile (and similar for others)
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
COPY ../../shared /shared

RUN npx prisma generate
RUN npm run build

CMD ["npm", "start"]
```

Note: scraper/scheduler also need prisma generate. Notification does not need Prisma. Adjust shared path to use a build context or copy shared types in each Dockerfile.

Actual Dockerfiles will use a multi-stage approach copying shared types:

```dockerfile
# services/api/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
COPY --from=shared /types ./src/shared-types
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
CMD ["npm", "start"]
```

Implementation note: since shared types are imported via relative paths (`../../../shared/types/events`), the simplest Docker approach is to set build context to project root and use a common Dockerfile pattern. Alternatively, copy shared/ into each service during build. Decide during implementation — the key constraint is that relative imports must resolve.

**Step 3: Commit**

```bash
git add docker-compose.yml services/*/Dockerfile
git commit -m "feat: add Docker Compose and Dockerfiles for all services"
```

---

## Task 13: Jest + Supertest Tests for API

**Files:**
- Create: `services/api/jest.config.js`
- Create: `services/api/src/__tests__/products.test.ts`
- Create: `services/api/src/__tests__/alerts.test.ts`

**Step 1: Create Jest config**

```javascript
// services/api/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
```

**Step 2: Write products endpoint tests**

Test POST /products (valid, invalid URL), GET /products (empty, with data). Mock Prisma and RabbitMQ.

```typescript
// services/api/src/__tests__/products.test.ts
import request from 'supertest';
import express from 'express';
import productRoutes from '../routes/products';
import { errorHandler } from '../middleware/errorHandler';

// Mock prisma
jest.mock('../lib/db', () => ({
  __esModule: true,
  default: {
    product: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock rabbitmq
jest.mock('../lib/rabbitmq', () => ({
  publishMessage: jest.fn(),
  connectRabbitMQ: jest.fn(),
}));

import prisma from '../lib/db';

const app = express();
app.use(express.json());
app.use('/products', productRoutes);
app.use(errorHandler);

describe('POST /products', () => {
  it('creates a product with valid URL', async () => {
    const mockProduct = {
      id: 'test-uuid',
      url: 'https://www.amazon.com/dp/B0BShKHB2H',
      name: 'Test Product',
      store: 'amazon',
      scrapeStatus: 'active',
      createdAt: new Date(),
    };

    (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);

    const res = await request(app)
      .post('/products')
      .send({ url: 'https://www.amazon.com/dp/B0BShKHB2H', name: 'Test Product' });

    expect(res.status).toBe(201);
    expect(res.body.store).toBe('amazon');
  });

  it('rejects invalid URL', async () => {
    const res = await request(app)
      .post('/products')
      .send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
  });
});

describe('GET /products', () => {
  it('returns empty array when no products', async () => {
    (prisma.product.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get('/products');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
```

**Step 3: Write alerts endpoint tests**

```typescript
// services/api/src/__tests__/alerts.test.ts
import request from 'supertest';
import express from 'express';
import alertRoutes from '../routes/alerts';
import { errorHandler } from '../middleware/errorHandler';

jest.mock('../lib/db', () => ({
  __esModule: true,
  default: {
    product: { findUnique: jest.fn() },
    alert: { create: jest.fn(), findUnique: jest.fn() },
  },
}));

import prisma from '../lib/db';

const app = express();
app.use(express.json());
app.use('/alerts', alertRoutes);
app.use(errorHandler);

describe('POST /alerts', () => {
  it('creates alert when product exists', async () => {
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({ id: 'prod-1' });
    (prisma.alert.create as jest.Mock).mockResolvedValue({
      id: 'alert-1',
      productId: 'prod-1',
      userEmail: 'test@test.com',
      targetPrice: 100,
      notificationChannel: 'email',
      triggered: false,
    });

    const res = await request(app)
      .post('/alerts')
      .send({
        productId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        userEmail: 'test@test.com',
        targetPrice: 100,
        notificationChannel: 'email',
      });

    expect(res.status).toBe(201);
  });

  it('rejects alert without email or discord webhook', async () => {
    const res = await request(app)
      .post('/alerts')
      .send({
        productId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        targetPrice: 100,
      });

    expect(res.status).toBe(400);
  });
});
```

**Step 4: Run tests**

```bash
cd services/api && npx jest --verbose
```

**Step 5: Commit**

```bash
cd ../..
git add services/api/jest.config.js services/api/src/__tests__/
git commit -m "test: add API endpoint tests for products and alerts"
```

---

## Task 14: Scraper Unit Tests

**Files:**
- Create: `services/scraper/jest.config.js`
- Create: `services/scraper/src/__tests__/amazon.test.ts`
- Create: `services/scraper/src/__tests__/jsonld.test.ts`

**Step 1: Create Jest config** (same pattern as API)

**Step 2: Write Amazon parser test with mocked axios**

```typescript
// services/scraper/src/__tests__/amazon.test.ts
import { scrapeAmazon } from '../scrapers/amazon';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('scrapeAmazon', () => {
  it('extracts price from .a-price .a-offscreen', async () => {
    mockedAxios.get.mockResolvedValue({
      data: `
        <html><body>
          <span class="a-price"><span class="a-offscreen">$299.99</span></span>
        </body></html>
      `,
    });

    const result = await scrapeAmazon('https://www.amazon.com/dp/B0BShKHB2H');
    expect(result.price).toBe(299.99);
    expect(result.currency).toBe('USD');
  });

  it('throws when no price found', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html><body>No price</body></html>' });

    await expect(scrapeAmazon('https://www.amazon.com/dp/X')).rejects.toThrow('Could not find price');
  });
});
```

**Step 3: Write JSON-LD parser test**

```typescript
// services/scraper/src/__tests__/jsonld.test.ts
import { scrapeJsonLd } from '../scrapers/jsonld';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('scrapeJsonLd', () => {
  it('extracts price from JSON-LD Product schema', async () => {
    mockedAxios.get.mockResolvedValue({
      data: `
        <html><head>
          <script type="application/ld+json">
            {"@type": "Product", "name": "Test", "offers": {"price": "149.99", "priceCurrency": "EUR"}}
          </script>
        </head></html>
      `,
    });

    const result = await scrapeJsonLd('https://example.com/product');
    expect(result.price).toBe(149.99);
    expect(result.currency).toBe('EUR');
  });

  it('falls back to og:price meta tags', async () => {
    mockedAxios.get.mockResolvedValue({
      data: `
        <html><head>
          <meta property="og:price:amount" content="79.99" />
          <meta property="og:price:currency" content="USD" />
        </head></html>
      `,
    });

    const result = await scrapeJsonLd('https://example.com/product');
    expect(result.price).toBe(79.99);
    expect(result.currency).toBe('USD');
  });

  it('throws when no price data found', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html><body>Nothing</body></html>' });

    await expect(scrapeJsonLd('https://example.com/nope')).rejects.toThrow(
      'Could not extract price'
    );
  });
});
```

**Step 4: Run tests**

```bash
cd services/scraper && npx jest --verbose
```

**Step 5: Commit**

```bash
cd ../..
git add services/scraper/jest.config.js services/scraper/src/__tests__/
git commit -m "test: add unit tests for Amazon and JSON-LD scrapers"
```

---

## Task 15: ESLint + Prettier Configuration

**Files:**
- Create: `.eslintrc.json` (root)
- Create: `.prettierrc` (root)
- Update: each service `package.json` to add lint script

**Step 1: Create root ESLint config**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "no-console": "off"
  },
  "env": {
    "node": true,
    "jest": true
  }
}
```

**Step 2: Create Prettier config**

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100
}
```

**Step 3: Create root package.json for workspace lint commands**

```json
{
  "name": "pricewatch",
  "private": true,
  "scripts": {
    "lint": "eslint 'services/*/src/**/*.ts' 'shared/**/*.ts'",
    "lint:fix": "eslint 'services/*/src/**/*.ts' 'shared/**/*.ts' --fix",
    "format": "prettier --write 'services/*/src/**/*.ts' 'shared/**/*.ts'"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.26.0",
    "@typescript-eslint/parser": "^8.26.0",
    "eslint": "^9.22.0",
    "eslint-config-prettier": "^10.1.1",
    "prettier": "^3.5.3"
  }
}
```

**Step 4: Install and commit**

```bash
npm install
git add .eslintrc.json .prettierrc package.json package-lock.json
git commit -m "feat: add ESLint and Prettier configuration"
```

---

## Task 16: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint

  test-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd services/api && npm ci
      - run: cd services/api && npx jest --ci --verbose

  test-scraper:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd services/scraper && npm ci
      - run: cd services/scraper && npx jest --ci --verbose
```

**Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for lint and tests"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Shared types + env | `shared/types/events.ts`, `.env.example` |
| 2 | API scaffold + Prisma | `services/api/*`, `prisma/schema.prisma` |
| 3 | RabbitMQ helper | `services/api/src/lib/rabbitmq.ts` |
| 4 | API middleware | `errorHandler.ts`, `validate.ts` |
| 5 | Products endpoints | controller + routes + wired index.ts |
| 6 | Alerts endpoints | controller + routes |
| 7 | Scraper scaffold | consumer + retry + DLQ |
| 8 | Scraper parsers | Amazon + JSON-LD + router |
| 9 | DLQ consumer | marks failed products |
| 10 | Notification service | Discord + email channels |
| 11 | Scheduler service | cron + batch publish |
| 12 | Docker Compose | all Dockerfiles + compose |
| 13 | API tests | Jest + Supertest |
| 14 | Scraper tests | mocked axios tests |
| 15 | ESLint + Prettier | root config |
| 16 | GitHub Actions CI | lint + test pipeline |

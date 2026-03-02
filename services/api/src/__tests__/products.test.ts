import request from 'supertest';
import express from 'express';
import productRoutes from '../routes/products';
import { errorHandler } from '../middleware/errorHandler';

// Mock Prisma
jest.mock('../lib/db', () => ({
  __esModule: true,
  default: {
    product: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

// Mock RabbitMQ
jest.mock('../lib/rabbitmq', () => ({
  publishMessage: jest.fn().mockResolvedValue(undefined),
}));

// Mock the shared events module
jest.mock('../../../../shared/types/events', () => ({
  ROUTING_KEYS: { PRICE_CHECK_REQUESTED: 'price.check.requested' },
  EXCHANGE_NAME: 'pricewatch.events',
  QUEUES: {
    PRICE_CHECK_REQUESTED: 'price.check.requested',
    PRICE_DROPPED: 'price.dropped',
    PRICE_CHECK_DLQ: 'price.check.dlq',
  },
}));

import prisma from '../lib/db';
import { publishMessage } from '../lib/rabbitmq';

const app = express();
app.use(express.json());
app.use('/products', productRoutes);
app.use(errorHandler);

describe('POST /products', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a product with a valid URL', async () => {
    const mockProduct = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      url: 'https://www.amazon.com/dp/B08N5WRWNW',
      name: 'Test Product',
      store: 'amazon',
      scrapeStatus: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);

    const res = await request(app)
      .post('/products')
      .send({ url: 'https://www.amazon.com/dp/B08N5WRWNW', name: 'Test Product' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(mockProduct);
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        url: 'https://www.amazon.com/dp/B08N5WRWNW',
        name: 'Test Product',
        store: 'amazon',
      },
    });
    expect(publishMessage).toHaveBeenCalledWith(
      'price.check.requested',
      expect.objectContaining({
        productId: mockProduct.id,
        url: mockProduct.url,
        store: 'amazon',
      }),
    );
  });

  it('should detect generic store for non-Amazon URLs', async () => {
    const mockProduct = {
      id: '223e4567-e89b-12d3-a456-426614174000',
      url: 'https://www.bestbuy.com/product/123',
      name: null,
      store: 'generic',
      scrapeStatus: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);

    const res = await request(app)
      .post('/products')
      .send({ url: 'https://www.bestbuy.com/product/123' });

    expect(res.status).toBe(201);
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        url: 'https://www.bestbuy.com/product/123',
        name: undefined,
        store: 'generic',
      },
    });
  });

  it('should return 400 for an invalid URL', async () => {
    const res = await request(app)
      .post('/products')
      .send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('should return 400 when URL is missing', async () => {
    const res = await request(app)
      .post('/products')
      .send({ name: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('GET /products', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return a list of products with latest price info', async () => {
    const mockProducts = [
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        url: 'https://www.amazon.com/dp/B08N5WRWNW',
        name: 'Test Product',
        store: 'amazon',
        scrapeStatus: 'active',
        createdAt: new Date('2025-01-01'),
        priceHistory: [
          { price: 29.99, currency: 'USD', scrapedAt: new Date('2025-01-02') },
        ],
        _count: { alerts: 2 },
      },
    ];

    (prisma.product.findMany as jest.Mock).mockResolvedValue(mockProducts);

    const res = await request(app).get('/products');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        url: 'https://www.amazon.com/dp/B08N5WRWNW',
        name: 'Test Product',
        store: 'amazon',
        scrapeStatus: 'active',
        createdAt: '2025-01-01T00:00:00.000Z',
        latestPrice: 29.99,
        currency: 'USD',
        lastScrapedAt: '2025-01-02T00:00:00.000Z',
        alertCount: 2,
      },
    ]);
  });

  it('should return null for price fields when no price history exists', async () => {
    const mockProducts = [
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        url: 'https://example.com/product',
        name: null,
        store: 'generic',
        scrapeStatus: 'active',
        createdAt: new Date('2025-01-01'),
        priceHistory: [],
        _count: { alerts: 0 },
      },
    ];

    (prisma.product.findMany as jest.Mock).mockResolvedValue(mockProducts);

    const res = await request(app).get('/products');

    expect(res.status).toBe(200);
    expect(res.body[0].latestPrice).toBeNull();
    expect(res.body[0].currency).toBeNull();
    expect(res.body[0].lastScrapedAt).toBeNull();
  });
});

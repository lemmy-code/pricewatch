import request from 'supertest';
import express from 'express';
import alertRoutes from '../routes/alerts';
import { errorHandler } from '../middleware/errorHandler';

// Mock Prisma
jest.mock('../lib/db', () => ({
  __esModule: true,
  default: {
    product: {
      findUnique: jest.fn(),
    },
    alert: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import prisma from '../lib/db';

const app = express();
app.use(express.json());
app.use('/alerts', alertRoutes);
app.use(errorHandler);

const validProductId = '123e4567-e89b-12d3-a456-426614174000';
const validAlertId = '223e4567-e89b-12d3-a456-426614174000';

describe('POST /alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create an alert with valid data', async () => {
    const mockAlert = {
      id: validAlertId,
      productId: validProductId,
      userEmail: 'user@example.com',
      discordWebhookUrl: null,
      targetPrice: 25.0,
      notificationChannel: 'email',
      active: true,
      createdAt: new Date().toISOString(),
    };

    (prisma.product.findUnique as jest.Mock).mockResolvedValue({ id: validProductId });
    (prisma.alert.create as jest.Mock).mockResolvedValue(mockAlert);

    const res = await request(app)
      .post('/alerts')
      .send({
        productId: validProductId,
        userEmail: 'user@example.com',
        targetPrice: 25.0,
        notificationChannel: 'email',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(mockAlert);
    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: {
        productId: validProductId,
        userEmail: 'user@example.com',
        discordWebhookUrl: undefined,
        targetPrice: 25.0,
        notificationChannel: 'email',
      },
    });
  });

  it('should return 400 when neither email nor webhook is provided', async () => {
    const res = await request(app)
      .post('/alerts')
      .send({
        productId: validProductId,
        targetPrice: 25.0,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should return 400 for invalid productId format', async () => {
    const res = await request(app)
      .post('/alerts')
      .send({
        productId: 'not-a-uuid',
        userEmail: 'user@example.com',
        targetPrice: 25.0,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should return 400 for non-positive targetPrice', async () => {
    const res = await request(app)
      .post('/alerts')
      .send({
        productId: validProductId,
        userEmail: 'user@example.com',
        targetPrice: -5,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should return 404 when product does not exist', async () => {
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post('/alerts')
      .send({
        productId: validProductId,
        userEmail: 'user@example.com',
        targetPrice: 25.0,
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Product not found');
  });
});

describe('GET /alerts/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an alert with current price', async () => {
    const mockAlert = {
      id: validAlertId,
      productId: validProductId,
      userEmail: 'user@example.com',
      discordWebhookUrl: null,
      targetPrice: 25.0,
      notificationChannel: 'email',
      active: true,
      createdAt: new Date().toISOString(),
      product: {
        priceHistory: [{ price: 29.99 }],
      },
    };

    (prisma.alert.findUnique as jest.Mock).mockResolvedValue(mockAlert);

    const res = await request(app).get(`/alerts/${validAlertId}`);

    expect(res.status).toBe(200);
    expect(res.body.currentPrice).toBe(29.99);
    expect(res.body.id).toBe(validAlertId);
  });

  it('should return null currentPrice when no price history', async () => {
    const mockAlert = {
      id: validAlertId,
      productId: validProductId,
      userEmail: 'user@example.com',
      discordWebhookUrl: null,
      targetPrice: 25.0,
      notificationChannel: 'email',
      active: true,
      createdAt: new Date().toISOString(),
      product: {
        priceHistory: [],
      },
    };

    (prisma.alert.findUnique as jest.Mock).mockResolvedValue(mockAlert);

    const res = await request(app).get(`/alerts/${validAlertId}`);

    expect(res.status).toBe(200);
    expect(res.body.currentPrice).toBeNull();
  });

  it('should return 404 when alert does not exist', async () => {
    (prisma.alert.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get(`/alerts/${validAlertId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Alert not found');
  });
});

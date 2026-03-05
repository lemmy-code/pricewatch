import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import productRoutes from './routes/products';
import alertRoutes from './routes/alerts';
import { errorHandler } from './middleware/errorHandler';
import { connectRabbitMQ, closeRabbitMQ, publishMessage } from './lib/rabbitmq';
import prisma from './lib/db';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH'],
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}));
app.use(express.json({ limit: '10kb' }));
app.use(morgan('short'));

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'disconnected' });
  }
});

app.use('/products', productRoutes);
app.use('/alerts', alertRoutes);

// Test endpoint: simulate a price drop to trigger notifications
app.post('/test/price-drop', async (req, res, next) => {
  try {
    const { productId } = req.body;
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { alerts: true },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const alerts = product.alerts
      .filter((a) => !a.triggered)
      .map((a) => ({
        alertId: a.id,
        userEmail: a.userEmail,
        discordWebhookUrl: a.discordWebhookUrl,
        notificationChannel: a.notificationChannel as 'email' | 'discord' | 'both',
        targetPrice: Number(a.targetPrice),
      }));

    if (alerts.length === 0) {
      res.status(400).json({ error: 'No active alerts for this product' });
      return;
    }

    const dropEvent = {
      productId: product.id,
      productName: product.name || 'Test Product',
      url: product.url,
      oldPrice: 399.99,
      newPrice: 249.99,
      currency: 'USD',
      alerts,
    };

    await publishMessage('price.dropped', dropEvent);

    res.json({ message: 'Price drop event published', alerts: alerts.length });
  } catch (err) {
    next(err);
  }
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

async function start(): Promise<void> {
  await connectRabbitMQ();
  const server = app.listen(PORT, () => {
    console.log(`API service running on port ${PORT}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down gracefully...`);
    server.close();
    await closeRabbitMQ();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(console.error);

export default app;

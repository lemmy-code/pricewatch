import express from 'express';
import productRoutes from './routes/products';
import { errorHandler } from './middleware/errorHandler';
import { connectRabbitMQ } from './lib/rabbitmq';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/products', productRoutes);

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

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

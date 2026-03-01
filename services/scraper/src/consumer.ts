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

      await prisma.priceHistory.create({
        data: {
          productId: event.productId,
          price: result.price,
          currency: result.currency,
        },
      });

      const alerts = await prisma.alert.findMany({
        where: {
          productId: event.productId,
          triggered: false,
          targetPrice: { gte: result.price },
        },
      });

      if (alerts.length > 0) {
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

        await prisma.alert.updateMany({
          where: { id: { in: alerts.map((a) => a.id) } },
          data: { triggered: true },
        });
      }

      channel.ack(msg);
    } catch (err) {
      console.error(`Scrape failed for ${event.url}:`, err);

      if (retryCount < MAX_RETRIES - 1) {
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
        channel.nack(msg, false, false);
      }
    }
  });
}

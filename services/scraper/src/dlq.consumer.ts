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

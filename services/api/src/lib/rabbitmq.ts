import amqplib from 'amqplib';
import { EXCHANGE_NAME, QUEUES } from '../../../../shared/types/events';

let connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
let channel: Awaited<ReturnType<Awaited<ReturnType<typeof amqplib.connect>>['createChannel']>> | null = null;

export async function connectRabbitMQ() {
  if (channel) return channel;

  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

  connection = await amqplib.connect(url);
  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

  await channel.assertQueue(QUEUES.PRICE_CHECK_DLQ, { durable: true });

  await channel.assertQueue(QUEUES.PRICE_CHECK_REQUESTED, {
    durable: true,
    deadLetterExchange: EXCHANGE_NAME,
    deadLetterRoutingKey: QUEUES.PRICE_CHECK_DLQ,
  });

  await channel.assertQueue(QUEUES.PRICE_DROPPED, { durable: true });

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

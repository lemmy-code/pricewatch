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
      const notifChannel = alert.notificationChannel;

      if (notifChannel === 'discord' || notifChannel === 'both') {
        promises.push(
          sendDiscordNotification(event, alert).catch((err) =>
            console.error(`Discord notification failed for alert ${alert.alertId}:`, err)
          )
        );
      }

      if (notifChannel === 'email' || notifChannel === 'both') {
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

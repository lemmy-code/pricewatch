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

  await axios.post(webhookUrl, { embeds: [embed] });
  console.log(`Discord notification sent for alert ${alert.alertId}`);
}

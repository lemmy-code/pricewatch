import nodemailer from 'nodemailer';
import { PriceDroppedEvent, AlertInfo } from '../../../../shared/types/events';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmailNotification(
  event: PriceDroppedEvent,
  alert: AlertInfo
): Promise<void> {
  if (!alert.userEmail) {
    console.warn(`No email for alert ${alert.alertId}`);
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2d9c2d;">Price Drop Alert!</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Product</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.productName}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Old Price</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.oldPrice} ${event.currency}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>New Price</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; color: #2d9c2d; font-weight: bold;">${event.newPrice} ${event.currency}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Your Target</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${alert.targetPrice} ${event.currency}</td>
        </tr>
        <tr>
          <td style="padding: 8px;"><strong>Savings</strong></td>
          <td style="padding: 8px; color: #2d9c2d;">${(event.oldPrice - event.newPrice).toFixed(2)} ${event.currency}</td>
        </tr>
      </table>
      <p style="margin-top: 20px;">
        <a href="${event.url}" style="background: #2d9c2d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">View Product</a>
      </p>
      <p style="color: #888; font-size: 12px; margin-top: 30px;">Sent by PriceWatch</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: alert.userEmail,
    subject: `Price Drop: ${event.productName} is now ${event.newPrice} ${event.currency}`,
    html,
  });

  console.log(`Email notification sent to ${alert.userEmail} for alert ${alert.alertId}`);
}

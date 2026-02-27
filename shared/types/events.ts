export interface PriceCheckRequestedEvent {
  productId: string;
  url: string;
  store: 'amazon' | 'generic';
}

export interface PriceDroppedEvent {
  productId: string;
  productName: string;
  url: string;
  oldPrice: number;
  newPrice: number;
  currency: string;
  alerts: AlertInfo[];
}

export interface AlertInfo {
  alertId: string;
  userEmail: string | null;
  discordWebhookUrl: string | null;
  notificationChannel: 'email' | 'discord' | 'both';
  targetPrice: number;
}

export const EXCHANGE_NAME = 'pricewatch.events';
export const QUEUES = {
  PRICE_CHECK_REQUESTED: 'price.check.requested',
  PRICE_DROPPED: 'price.dropped',
  PRICE_CHECK_DLQ: 'price.check.dlq',
} as const;

export const ROUTING_KEYS = {
  PRICE_CHECK_REQUESTED: 'price.check.requested',
  PRICE_DROPPED: 'price.dropped',
} as const;

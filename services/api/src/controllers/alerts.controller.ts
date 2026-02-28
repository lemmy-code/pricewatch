import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/db';
import { AppError } from '../middleware/errorHandler';

export async function createAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { productId, userEmail, discordWebhookUrl, targetPrice, notificationChannel } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    const alert = await prisma.alert.create({
      data: {
        productId,
        userEmail,
        discordWebhookUrl,
        targetPrice,
        notificationChannel: notificationChannel || 'both',
      },
    });

    res.status(201).json(alert);
  } catch (err) {
    next(err);
  }
}

export async function getAlert(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            priceHistory: {
              orderBy: { scrapedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!alert) {
      throw new AppError(404, 'Alert not found');
    }

    const alertWithProduct = alert as typeof alert & {
      product: { priceHistory: Array<{ price: unknown }> };
    };

    res.json({
      ...alert,
      currentPrice: alertWithProduct.product.priceHistory[0]?.price ?? null,
    });
  } catch (err) {
    next(err);
  }
}

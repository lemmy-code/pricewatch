import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/db';
import { publishMessage } from '../lib/rabbitmq';
import { ROUTING_KEYS, PriceCheckRequestedEvent } from '../../../../shared/types/events';
import { AppError } from '../middleware/errorHandler';

function detectStore(url: string): 'amazon' | 'generic' {
  if (/amazon\.(com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp)/i.test(url)) {
    return 'amazon';
  }
  return 'generic';
}

export async function createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { url, name } = req.body;
    const store = detectStore(url);

    const product = await prisma.product.create({
      data: { url, name, store },
    });

    const event: PriceCheckRequestedEvent = {
      productId: product.id,
      url: product.url,
      store: product.store as 'amazon' | 'generic',
    };
    await publishMessage(ROUTING_KEYS.PRICE_CHECK_REQUESTED, event);

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
}

export async function listProducts(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const products = await prisma.product.findMany({
      include: {
        priceHistory: {
          orderBy: { scrapedAt: 'desc' },
          take: 1,
        },
        _count: { select: { alerts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = products.map((p) => ({
      id: p.id,
      url: p.url,
      name: p.name,
      store: p.store,
      scrapeStatus: p.scrapeStatus,
      createdAt: p.createdAt,
      latestPrice: p.priceHistory[0]?.price ?? null,
      currency: p.priceHistory[0]?.currency ?? null,
      lastScrapedAt: p.priceHistory[0]?.scrapedAt ?? null,
      alertCount: p._count.alerts,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function reactivateProduct(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { scrapeStatus: 'active' },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

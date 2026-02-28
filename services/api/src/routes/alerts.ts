import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { createAlert, getAlert } from '../controllers/alerts.controller';

const router = Router();

const createAlertSchema = z.object({
  productId: z.string().uuid(),
  userEmail: z.string().email().optional(),
  discordWebhookUrl: z.string().url().optional(),
  targetPrice: z.number().positive(),
  notificationChannel: z.enum(['email', 'discord', 'both']).default('both'),
}).refine(
  (data) => data.userEmail || data.discordWebhookUrl,
  { message: 'At least one of userEmail or discordWebhookUrl is required' }
);

router.post('/', validate(createAlertSchema), createAlert);
router.get('/:id', getAlert);

export default router;

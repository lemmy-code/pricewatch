import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { createProduct, listProducts, reactivateProduct } from '../controllers/products.controller';

const router = Router();

const createProductSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
});

router.post('/', validate(createProductSchema), createProduct);
router.get('/', listProducts);
router.patch('/:id/reactivate', reactivateProduct);

export default router;

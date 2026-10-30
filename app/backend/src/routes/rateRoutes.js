import express from 'express';
import { getRates, upsertRate } from '../controllers/rateController.js';
import { auth, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getRates);
router.put('/', auth, adminOnly, upsertRate);

export default router;



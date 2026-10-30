import express from 'express';
import { auth } from '../middleware/authMiddleware.js';
import { createOrder, verifyPayment } from '../controllers/paymentController.js';

const router = express.Router();

router.post('/order', auth, createOrder);
router.post('/verify', auth, verifyPayment);

export default router;



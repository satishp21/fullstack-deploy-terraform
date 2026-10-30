import express from 'express';
import { body } from 'express-validator';
import {
  createBooking,
  getMyBookings,
  cancelBooking,
  adminListBookings,
  getRevenueSummary,
  downloadInvoice,
  getAvailability
} from '../controllers/bookingController.js';
import { auth, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post(
  '/',
  auth,
  [
    body('deviceType')
      .isIn(['gaming-pc', 'normal-pc', 'ps5'])
      .withMessage('Invalid device type'),
    body('date').notEmpty().withMessage('Date is required'),
    body('startTime').notEmpty().withMessage('Start time is required'),
    body('durationHours')
      .isInt({ min: 1, max: 6 })
      .withMessage('Duration must be between 1 and 6 hours'),
    body('gameName')
      .optional()
      .isString()
      .isLength({ max: 100 })
      .withMessage('Game name must be at most 100 characters')
  ],
  createBooking
);

router.get('/availability', getAvailability);
router.get('/me', auth, getMyBookings);
router.delete('/:id', auth, cancelBooking);

router.get('/', auth, adminOnly, adminListBookings);
router.get('/revenue/summary', auth, adminOnly, getRevenueSummary);
router.get('/:id/invoice', auth, adminOnly, downloadInvoice);

export default router;



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
      .isIn(['gaming-pc', 'normal-pc', 'ps5', 'racing-sim'])
      .withMessage('Invalid device type'),
    body('date').notEmpty().withMessage('Date is required'),
    body('startTime')
      .matches(/^(1[2-9]|2[0-3]):00$/)
      .withMessage('Bookings are available from 12:00 PM through 11:00 PM'),
    body('durationHours')
      .isInt({ min: 1, max: 6 })
      .withMessage('Duration must be between 1 and 6 hours')
      .bail()
      .custom((durationHours, { req }) => {
        const startHour = Number.parseInt(req.body.startTime, 10);
        return startHour + Number(durationHours) <= 24;
      })
      .withMessage('Bookings must end by 12:00 AM'),
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


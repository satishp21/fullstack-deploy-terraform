import Razorpay from 'razorpay';
import crypto from 'crypto';
import Booking from '../models/Booking.js';

const razorpayInstance =
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      })
    : null;

export const createOrder = async (req, res) => {
  if (!razorpayInstance) {
    return res
      .status(500)
      .json({ message: 'Razorpay keys not configured on server' });
  }

  const { bookingId, mode } = req.body; // mode: 'full' | 'partial'

  try {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const factor = mode === 'partial' ? 0.5 : 1;
    const amount = Math.round(booking.totalAmount * factor * 100); // in paise

    const order = await razorpayInstance.orders.create({
      amount,
      currency: 'INR',
      receipt: `JAYNETIC-${booking._id}`
    });

    booking.razorpayOrderId = order.id;
    await booking.save();

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      order
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create Razorpay order' });
  }
};

export const verifyPayment = async (req, res) => {
  const { bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature } =
    req.body;

  try {
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    booking.razorpayPaymentId = razorpayPaymentId;
    booking.paymentStatus = 'paid';
    booking.status = 'confirmed';
    await booking.save();

    res.json({ message: 'Payment verified', booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Payment verification failed' });
  }
};



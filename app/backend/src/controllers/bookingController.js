import { validationResult } from 'express-validator';
import PDFDocument from 'pdfkit';
import Booking from '../models/Booking.js';
import Device from '../models/Device.js';
import Rate from '../models/Rate.js';
import User from '../models/User.js';
import { findAvailableDevice, getTimeRange } from '../utils/availability.js';
import { sendBookingNotificationToAdmin } from '../utils/mailer.js';

export const createBooking = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { deviceType, date, startTime, durationHours, gameName } = req.body;
  try {
    const rate = await Rate.findOne({ type: deviceType });
    if (!rate) {
      return res.status(400).json({ message: 'Rate not configured for this device type' });
    }
    const bookingDate = new Date(date);

    const device = await findAvailableDevice(
      deviceType,
      bookingDate,
      startTime,
      durationHours
    );
    if (!device) {
      return res.status(400).json({ message: 'No available device for this slot. Please choose a different time or device.' });
    }

    const totalAmount = rate.pricePerHour * durationHours;
    const booking = await Booking.create({
      user: req.user._id,
      deviceType,
      device: device._id,
      date: bookingDate,
      startTime,
      durationHours,
      gameName: gameName || undefined,
      totalAmount,
      status: 'confirmed',
      paymentStatus: 'unpaid'
    });

    // Populate for response
    await booking.populate('device');

    // Send admin email notification and handle failures gracefully
    const user = await User.findById(req.user._id).select('name email phone');
    let notified = true;
    try {
      notified = await sendBookingNotificationToAdmin(booking, user);
    } catch (mailErr) {
      console.error('Error while sending booking notification:', mailErr);
      notified = false;
    }

    if (!notified) {
      console.warn(`Booking ${booking._id} created but admin notification failed`);
      return res.status(500).json({ message: 'Booking failed. Please call us directly at +91-87581-73436 to book your session' });
    }

    res.status(201).json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate('device')
      .sort({ date: -1, startTime: -1 });
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      user: req.user._id
    });
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    if (booking.status !== 'pending' && booking.status !== 'confirmed') {
      return res
        .status(400)
        .json({ message: 'Only upcoming bookings can be cancelled' });
    }
    booking.status = 'cancelled';
    await booking.save();
    res.json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const adminListBookings = async (req, res) => {
  try {
    const { range } = req.query; // today|upcoming|past
    const now = new Date();
    let filter = {};
    if (range === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      filter.date = { $gte: start, $lt: end };
    } else if (range === 'upcoming') {
      filter.date = { $gte: now };
    } else if (range === 'past') {
      filter.date = { $lt: now };
    }
    const bookings = await Booking.find(filter)
      .populate('user', 'name email')
      .populate('device')
      .sort({ date: -1, startTime: -1 });
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getRevenueSummary = async (req, res) => {
  try {
    const { range } = req.query; // daily|weekly|monthly
    const now = new Date();
    let from = new Date(now);

    if (range === 'weekly') {
      from.setDate(from.getDate() - 7);
    } else if (range === 'monthly') {
      from.setMonth(from.getMonth() - 1);
    } else {
      from.setDate(from.getDate() - 1);
    }

    const pipeline = [
      {
        $match: {
          createdAt: { $gte: from, $lte: now },
          paymentStatus: { $in: ['partial', 'paid'] }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          count: { $sum: 1 }
        }
      }
    ];

    const [result] = await Booking.aggregate(pipeline);
    res.json(result || { totalRevenue: 0, count: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const downloadInvoice = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('user', 'name email')
      .populate('device');
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoice-${booking._id}.pdf`
    );
    doc.pipe(res);

    doc.fontSize(20).text('Jaynetic Zone - Invoice', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Vadodara, Gujarat, India`);
    doc.text(`Date: ${new Date().toLocaleString('en-IN')}`);
    doc.moveDown();
    doc.text(`Customer: ${booking.user?.name || 'Walk-in'}`);
    doc.text(`Email: ${booking.user?.email || '-'}`);
    doc.moveDown();
    doc.text(`Booking ID: ${booking._id}`);
    doc.text(`Device Type: ${booking.deviceType}`);
    doc.text(`Station: ${booking.device?.stationNumber || '-'}`);
    doc.text(`Date: ${booking.date.toDateString()}`);
    doc.text(`Start Time: ${booking.startTime}`);
    doc.text(`Duration: ${booking.durationHours} hour(s)`);
    if (booking.gameName) {
      doc.text(`Game: ${booking.gameName}`);
    }
    doc.moveDown();
    doc.fontSize(14).text(`Total Amount: ₹${booking.totalAmount}`, {
      align: 'right'
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to generate invoice' });
  }
};

export const getAvailability = async (req, res) => {
  try {
    const { deviceType, date } = req.query;
    if (!deviceType || !date) {
      return res
        .status(400)
        .json({ message: 'deviceType and date query params are required' });
    }
    const bookingDate = new Date(date);
    const sameDay = new Date(bookingDate);
    sameDay.setHours(0, 0, 0, 0);
    const nextDay = new Date(sameDay);
    nextDay.setDate(nextDay.getDate() + 1);

    // Get all active devices of this type
    const devices = await Device.find({ type: deviceType, isActive: true });

    if (!devices.length) {
      return res.json({ slots: [], devices: [] });
    }

    const bookings = await Booking.find({
      deviceType,
      status: { $in: ['pending', 'confirmed'] },
      date: { $gte: sameDay, $lt: nextDay }
    });

    // Operating hours: 12 AM to 11 PM
    const hours = [];
    for (let h = 0; h <= 23; h += 1) {
      hours.push(`${h.toString().padStart(2, '0')}:00`);
    }

    // Build per-slot availability showing which devices are free
    const slots = hours.map((startTime) => {
      const target = getTimeRange(startTime, 1);

      const deviceAvailability = devices.map((d) => {
        const deviceBookings = bookings.filter(
          (b) => b.device && b.device.toString() === d._id.toString()
        );
        const hasConflict = deviceBookings.some((b) => {
          const range = getTimeRange(b.startTime, b.durationHours);
          return target.start < range.end && range.start < target.end;
        });
        return {
          deviceId: d._id,
          name: d.name,
          stationNumber: d.stationNumber,
          available: !hasConflict
        };
      });

      const totalAvailable = deviceAvailability.filter((d) => d.available).length;

      return {
        startTime,
        available: totalAvailable > 0,
        totalDevices: devices.length,
        availableCount: totalAvailable,
        devices: deviceAvailability
      };
    });

    res.json({
      slots,
      devices: devices.map((d) => ({
        _id: d._id,
        name: d.name,
        stationNumber: d.stationNumber,
        type: d.type
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to compute availability' });
  }
};




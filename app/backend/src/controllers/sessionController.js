import Session from '../models/Session.js';
import Booking from '../models/Booking.js';

export const startSession = async (req, res) => {
  const { deviceId, userId, bookingId, durationHours } = req.body;
  try {
    const startedAt = new Date();
    const endsAt = durationHours
      ? new Date(startedAt.getTime() + durationHours * 60 * 60 * 1000)
      : null;
    const session = await Session.create({
      device: deviceId,
      user: userId || null,
      booking: bookingId || null,
      startedAt,
      endsAt,
      walkIn: !bookingId
    });
    if (bookingId) {
      await Booking.findByIdAndUpdate(bookingId, { status: 'confirmed' });
    }
    res.status(201).json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const endSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session || !session.isActive) {
      return res.status(404).json({ message: 'Active session not found' });
    }
    session.isActive = false;
    session.endsAt = session.endsAt || new Date();
    await session.save();
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getActiveSessions = async (req, res) => {
  try {
    const sessions = await Session.find({ isActive: true })
      .populate('user', 'name email')
      .populate('device')
      .populate('booking');
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getMyActiveSession = async (req, res) => {
  try {
    const session = await Session.findOne({
      user: req.user._id,
      isActive: true
    }).populate('device');
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};



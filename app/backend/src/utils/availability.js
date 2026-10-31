import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import Device from '../models/Device.js';

// Convert 'HH:MM' and duration (hours) to absolute minutes range in a day
export const getTimeRange = (startTime, durationHours) => {
  const [h, m] = startTime.split(':').map(Number);
  const start = h * 60 + m;
  const end = start + durationHours * 60;
  return { start, end };
};

const rangesOverlap = (r1, r2) => {
  return r1.start < r2.end && r2.start < r1.end;
};

export const findAvailableDevice = async (
  deviceType,
  date,
  startTime,
  durationHours
) => {
  const targetRange = getTimeRange(startTime, durationHours);

  const devices = await Device.find({ type: deviceType, isActive: true });
  if (!devices.length) return null;

  const sameDay = new Date(date);
  sameDay.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(sameDay);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const bookings = await Booking.find({
    deviceType,
    status: { $in: ['pending', 'confirmed'] },
    date: { $gte: sameDay, $lt: nextDay }
  });

  const activeSessions = await Session.find({
    isActive: true
  }).populate('device');

  for (const device of devices) {
    const deviceBookings = bookings.filter(
      (b) => b.device && b.device.toString() === device._id.toString()
    );
    const hasBookingConflict = deviceBookings.some((b) =>
      rangesOverlap(targetRange, getTimeRange(b.startTime, b.durationHours))
    );
    if (hasBookingConflict) continue;

    const deviceSessions = activeSessions.filter(
      (s) => s.device && s.device._id.toString() === device._id.toString()
    );
    const hasSessionConflict = deviceSessions.some((s) => {
      if (!s.endsAt) return true;
      const sessionStart = s.startedAt;
      const sessionEnd = s.endsAt;
      const startMinutes = sessionStart.getHours() * 60 + sessionStart.getMinutes();
      const endMinutes = sessionEnd.getHours() * 60 + sessionEnd.getMinutes();
      return rangesOverlap(targetRange, { start: startMinutes, end: endMinutes });
    });
    if (hasSessionConflict) continue;

    return device;
  }

  return null;
};


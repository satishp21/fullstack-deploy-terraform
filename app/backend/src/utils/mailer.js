import nodemailer from 'nodemailer';

export const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

export const buildTransporter = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

const DEVICE_LABELS = {
  ps5: 'PS5 Console',
  'gaming-pc': 'Gaming PC',
  'normal-pc': 'Normal PC'
};

export const sendBookingNotificationToAdmin = async (booking, user) => {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  if (!adminEmail) {
    console.warn('No ADMIN_EMAIL or SMTP_USER configured – skipping booking notification');
    return false;
  }

  try {
    const transporter = buildTransporter();
    const deviceLabel = DEVICE_LABELS[booking.deviceType] || booking.deviceType;
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN');

    await transporter.sendMail({
      from: `"Jaynetic Zone Bookings" <${process.env.SMTP_USER}>`,
      to: adminEmail,
      subject: `New Booking: ${escapeHtml(user.name)} – ${deviceLabel} on ${dateStr}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#7c3aed;">🎮 New Booking Received</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Customer</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(user.name)} (${escapeHtml(user.email)})</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Phone</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(user.phone) || 'N/A'}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Device</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(deviceLabel)}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Date</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${dateStr}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Time</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(booking.startTime)} (${booking.durationHours} hr${booking.durationHours > 1 ? 's' : ''})</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Game</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(booking.gameName) || 'Not specified'}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Amount</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">₹${booking.totalAmount}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Booking ID</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${booking._id}</td></tr>
          </table>
          <p style="color:#666;font-size:12px;margin-top:24px;">
            This is an automated notification from Jaynetic Zone booking system.
          </p>
        </div>
      `
    });
    console.log('Admin booking notification sent');
    return true;
  } catch (err) {
    // Log but don't throw – the booking was already created successfully
    console.error('Failed to send admin booking notification:', err?.message || err);
    return false;
  }
};

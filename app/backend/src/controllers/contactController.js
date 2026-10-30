import { buildTransporter, escapeHtml } from '../utils/mailer.js';

export const sendContactMessage = async (req, res) => {
  const { name, email, phone, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ message: 'Name, email and message are required' });
  }

  try {
    const transporter = buildTransporter();
    await transporter.sendMail({
      from: `"Jaynetic Zone Website" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: `New contact from ${escapeHtml(name)}`,
      html: `
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone) || 'N/A'}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message)}</p>
      `
    });

    res.json({ message: 'Message sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to send message' });
  }
};



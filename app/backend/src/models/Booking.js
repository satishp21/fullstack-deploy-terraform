import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deviceType: {
      type: String,
      enum: ['gaming-pc', 'normal-pc', 'ps5', 'racing-sim'],
      required: true
    },
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
    date: { type: Date, required: true },
    startTime: { type: String, required: true }, // '10:00'
    durationHours: { type: Number, required: true, min: 1 },
    gameName: { type: String, trim: true, maxlength: 100 },
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending'
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid', 'refunded'],
      default: 'unpaid'
    },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String }
  },
  { timestamps: true }
);

export default mongoose.model('Booking', bookingSchema);


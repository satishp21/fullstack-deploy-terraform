import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    startedAt: { type: Date, default: Date.now },
    endsAt: { type: Date },
    isActive: { type: Boolean, default: true },
    walkIn: { type: Boolean, default: false },
    totalAmount: { type: Number }
  },
  { timestamps: true }
);

export default mongoose.model('Session', sessionSchema);



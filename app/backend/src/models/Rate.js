import mongoose from 'mongoose';

const rateSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['gaming-pc', 'normal-pc', 'ps5', 'racing-sim'], required: true, unique: true },
    pricePerHour: { type: Number, required: true },
    currency: { type: String, default: 'INR' }
  },
  { timestamps: true }
);

export default mongoose.model('Rate', rateSchema);



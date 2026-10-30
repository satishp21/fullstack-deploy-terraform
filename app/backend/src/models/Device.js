import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['gaming-pc', 'normal-pc', 'ps5', 'racing-sim'], required: true },
    name: { type: String, required: true },
    stationNumber: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
    notes: { type: String }
  },
  { timestamps: true }
);

deviceSchema.index({ type: 1, stationNumber: 1 }, { unique: true });

export default mongoose.model('Device', deviceSchema);



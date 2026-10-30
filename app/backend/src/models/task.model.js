import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title must be at most 200 characters'],
    },
    completed: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true, // exposes `id` (string) instead of `_id`
      versionKey: false,
      transform: (_doc, ret) => {
        delete ret._id;
        return ret;
      },
    },
  },
);

export const Task = mongoose.model('Task', taskSchema);

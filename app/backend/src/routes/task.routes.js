import { Router } from 'express';
import mongoose from 'mongoose';
import { Task } from '../models/task.model.js';

export const taskRouter = Router();

// Any :id that is not a valid ObjectId cannot exist - answer 404 before querying.
taskRouter.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ error: 'Task not found' });
  }
  return next();
});

// Express 5 forwards rejected promises from async handlers to the error handler.
taskRouter.get('/', async (_req, res) => {
  const tasks = await Task.find().sort({ createdAt: -1 }).limit(500);
  res.json(tasks);
});

taskRouter.post('/', async (req, res) => {
  const task = await Task.create({ title: req.body?.title });
  res.status(201).json(task);
});

taskRouter.patch('/:id', async (req, res) => {
  const updates = {};
  if (req.body?.title !== undefined) updates.title = req.body.title;
  if (req.body?.completed !== undefined) {
    if (typeof req.body.completed !== 'boolean') {
      return res.status(400).json({ error: '`completed` must be true or false' });
    }
    updates.completed = req.body.completed;
  }

  const task = await Task.findByIdAndUpdate(req.params.id, updates, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.json(task);
});

taskRouter.delete('/:id', async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.status(204).end();
});

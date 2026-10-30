import express from 'express';
import {
  getDevicesSummary,
  createDevice,
  updateDevice
} from '../controllers/deviceController.js';
import { auth, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getDevicesSummary);
router.post('/', auth, adminOnly, createDevice);
router.put('/:id', auth, adminOnly, updateDevice);

export default router;



import express from 'express';
import {
  startSession,
  endSession,
  getActiveSessions,
  getMyActiveSession
} from '../controllers/sessionController.js';
import { auth, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', auth, adminOnly, startSession);
router.put('/:id/end', auth, adminOnly, endSession);
router.get('/', auth, adminOnly, getActiveSessions);
router.get('/me', auth, getMyActiveSession);

export default router;



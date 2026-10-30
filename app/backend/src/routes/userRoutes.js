import express from 'express';
import { auth, adminOnly } from '../middleware/authMiddleware.js';
import { getUsers, updateProfile } from '../controllers/userController.js';

const router = express.Router();

router.get('/', auth, adminOnly, getUsers);
router.put('/me', auth, updateProfile);

export default router;



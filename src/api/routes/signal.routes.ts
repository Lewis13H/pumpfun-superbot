// src/api/routes/signal.routes.ts
import { Router } from 'express';
import { SignalController } from '../controllers/signal.controller';

const router = Router();
const signalController = new SignalController();

router.get('/history', signalController.getSignalHistory);
router.get('/stats', signalController.getSignalStats);
router.get('/profit-history', signalController.getProfitHistory);

export const signalRoutes = router;
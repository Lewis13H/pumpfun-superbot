// src/api/routes/signal.routes.ts
import { Router } from 'express';
import { SignalController } from '../controllers/signal.controller';

const router = Router();
const signalController = new SignalController();

router.get('/signals/history', signalController.getSignalHistory);
router.get('/signals/stats', signalController.getSignalStats);
router.get('/signals/profit-history', signalController.getProfitHistory);

export const signalRoutes = router;
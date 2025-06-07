// src/api/routes/monitor.routes.ts
import { Router } from 'express';
import { MonitorController } from '../controllers/monitor.controller';

const router = Router();
const monitorController = new MonitorController();

router.get('/status', monitorController.getApiStatus);
router.get('/cost-history', monitorController.getCostHistory);
router.get('/errors', monitorController.getErrorLogs);

export const monitorRoutes = router;

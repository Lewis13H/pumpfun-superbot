// src/api/routes/monitor.routes.ts
import { Router } from 'express';
import { MonitorController } from '../controllers/monitor.controller';

const router = Router();
const monitorController = new MonitorController();

router.get('/monitor/status', monitorController.getApiStatus);
router.get('/monitor/cost-history', monitorController.getCostHistory);
router.get('/monitor/errors', monitorController.getErrorLogs);

export const monitorRoutes = router;
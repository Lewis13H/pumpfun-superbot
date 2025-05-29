// src/api/routes/market.routes.ts
import { Router } from 'express';
import { MarketController } from '../controllers/market.controller';

const router = Router();
const marketController = new MarketController();

router.get('/market/metrics', marketController.getMarketMetrics);
router.get('/market/trends', marketController.getMarketTrends);

export const marketRoutes = router;
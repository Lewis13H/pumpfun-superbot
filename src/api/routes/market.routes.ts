// src/api/routes/market.routes.ts
import { Router } from 'express';
import { MarketController } from '../controllers/market.controller';

const router = Router();
const marketController = new MarketController();

router.get('/metrics', marketController.getMarketMetrics);
router.get('/trends', marketController.getMarketTrends);

export const marketRoutes = router;

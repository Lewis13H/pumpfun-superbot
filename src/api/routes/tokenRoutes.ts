// src/api/routes/token.routes.ts
import { Router } from 'express';
import { TokenController } from '../controllers/token.controller';

const router = Router();
const tokenController = new TokenController();

// Get all tokens with filters
router.get('/tokens', tokenController.getTokens);

// Get token details by address
router.get('/tokens/:address', tokenController.getTokenDetail);

export const tokenRoutes = router;
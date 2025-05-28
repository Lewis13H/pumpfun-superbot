import { Router } from 'express';
import { tokenController } from '../controllers/tokenController';

const router = Router();

router.get('/live', tokenController.getLiveTokens);
router.get('/:address', tokenController.getTokenDetails);

export default router;
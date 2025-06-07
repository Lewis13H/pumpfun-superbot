// src/api/routes/settings.routes.ts
import { Router } from 'express';
import { SettingsController } from '../controllers/settings.controller';

const router = Router();
const settingsController = new SettingsController();

router.get('/', settingsController.getSettings);
router.put('/', settingsController.updateSettings);

export const settingsRoutes = router;

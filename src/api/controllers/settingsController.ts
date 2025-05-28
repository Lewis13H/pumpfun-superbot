import { Request, Response } from 'express';
import { SettingsService } from '../services/settingsService';

const settingsService = new SettingsService();

export const settingsController = {
  async getSettings(req: Request, res: Response) {
    try {
      const settings = await settingsService.getSettings();

      res.json({
        success: true,
        data: settings,
        timestamp: new Date()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: 'Failed to fetch settings'
        }
      });
    }
  },

  async updateSettings(req: Request, res: Response) {
    try {
      const result = await settingsService.updateSettings(req.body);

      res.json({
        success: true,
        message: 'Settings updated successfully',
        updated: result.updated,
        timestamp: new Date()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_ERROR',
          message: 'Failed to update settings'
        }
      });
    }
  }
};
import { Request, Response } from 'express';
import { TokenService } from '../services/tokenService';

const tokenService = new TokenService();

export const tokenController = {
  async getLiveTokens(req: Request, res: Response) {
    try {
      const filters = {
        filter: req.query.filter,
        timeframe: req.query.timeframe,
        minMarketCap: req.query.minMarketCap ? Number(req.query.minMarketCap) : undefined,
        platform: req.query.platform,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0
      };

      const result = await tokenService.getLiveTokens(filters);

      res.json({
        success: true,
        data: result,
        timestamp: new Date()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: 'Failed to fetch tokens'
        }
      });
    }
  },

  async getTokenDetails(req: Request, res: Response) {
    try {
      const { address } = req.params;
      const token = await tokenService.getTokenDetails(address);

      res.json({
        success: true,
        data: { token },
        timestamp: new Date()
      });
    } catch (error: any) {
      if (error.message === 'Token not found') {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Token not found'
          }
        });
      } else {
        res.status(500).json({
          success: false,
          error: {
            code: 'FETCH_ERROR',
            message: 'Failed to fetch token details'
          }
        });
      }
    }
  }
};
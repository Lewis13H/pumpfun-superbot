// src/services/liquidity-milestone-alerts.ts

import { EventEmitter } from 'events';
import { db } from '../database/postgres';
import { logger } from '../utils/logger2';

export interface MilestoneAlert {
  tokenAddress: string;
  symbol?: string;
  name?: string;
  milestoneType: 'LIQUIDITY_USD' | 'LIQUIDITY_SOL' | 'GRADUATION_PROGRESS' | 'VELOCITY';
  threshold: number;
  currentValue: number;
  previousValue: number;
  timestamp: Date;
  significance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  actionable: boolean;
}

export interface MilestoneConfig {
  liquidityUsdMilestones: number[];     // USD thresholds: [5000, 10000, 25000, 50000, 100000]
  liquiditySolMilestones: number[];     // SOL thresholds: [25, 50, 73] (graduation at 73)
  graduationMilestones: number[];       // Graduation %: [50, 70, 80, 90, 95]
  velocityMilestones: number[];         // SOL/hour growth: [1, 5, 10, 20]
  cooldownMinutes: number;              // Prevent spam alerts
}

export class LiquidityMilestoneAlerts extends EventEmitter {
  private milestoneHistory = new Map<string, Map<string, Date>>(); // token -> milestone -> lastAlert
  private lastValues = new Map<string, any>(); // token -> last known values
  
  private config: MilestoneConfig = {
    liquidityUsdMilestones: [2500, 5000, 7500, 10000, 15000, 25000, 50000, 75000, 100000],
    liquiditySolMilestones: [10, 20, 30, 40, 50, 60, 70, 73], // 73 = graduation
    graduationMilestones: [25, 50, 60, 70, 80, 85, 90, 95, 99],
    velocityMilestones: [1, 2, 5, 10, 15, 20, 30], // SOL/hour
    cooldownMinutes: 30 // 30 minutes between same milestone alerts
  };

  constructor(customConfig?: Partial<MilestoneConfig>) {
    super();
    if (customConfig) {
      this.config = { ...this.config, ...customConfig };
    }
  }

  /**
   * STEP 1: Main function - check all milestones for a token
   */
  async checkMilestones(tokenAddress: string, currentData: any): Promise<MilestoneAlert[]> {
    const alerts: MilestoneAlert[] = [];
    
    try {
      // Get token metadata for better alerts
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      const previousData = this.lastValues.get(tokenAddress);

      if (!previousData) {
        // First time seeing this token - store baseline
        this.lastValues.set(tokenAddress, currentData);
        return [];
      }

      // Check each milestone type
      const liquidityUsdAlerts = await this.checkLiquidityUsdMilestones(tokenAddress, currentData, previousData, tokenInfo);
      const liquiditySolAlerts = await this.checkLiquiditySolMilestones(tokenAddress, currentData, previousData, tokenInfo);
      const graduationAlerts = await this.checkGraduationMilestones(tokenAddress, currentData, previousData, tokenInfo);
      const velocityAlerts = await this.checkVelocityMilestones(tokenAddress, currentData, previousData, tokenInfo);

      alerts.push(...liquidityUsdAlerts, ...liquiditySolAlerts, ...graduationAlerts, ...velocityAlerts);

      // Update stored values
      this.lastValues.set(tokenAddress, currentData);

      // Store alerts in database
      await this.storeAlerts(alerts);

      // Emit events for each alert
      alerts.forEach(alert => {
        this.emit('milestoneAlert', alert);
        
        // Emit specific event types for easier handling
        switch (alert.significance) {
          case 'CRITICAL':
            this.emit('criticalMilestone', alert);
            break;
          case 'HIGH':
            this.emit('highMilestone', alert);
            break;
        }
      });

      return alerts;

    } catch (error) {
      logger.error(`Error checking milestones for ${tokenAddress}:`, error);
      return [];
    }
  }

  /**
   * STEP 2: Check USD liquidity milestones
   */
  private async checkLiquidityUsdMilestones(
    tokenAddress: string, 
    current: any, 
    previous: any, 
    tokenInfo: any
  ): Promise<MilestoneAlert[]> {
    const alerts: MilestoneAlert[] = [];
    const currentUsd = Number(current.liquidity_usd || 0);
    const previousUsd = Number(previous.liquidity_usd || 0);

    for (const threshold of this.config.liquidityUsdMilestones) {
      // Check if crossed upward
      if (previousUsd < threshold && currentUsd >= threshold) {
        const milestoneKey = `liquidity_usd_${threshold}`;
        
        if (await this.shouldAlert(tokenAddress, milestoneKey)) {
          alerts.push({
            tokenAddress,
            symbol: tokenInfo?.symbol,
            name: tokenInfo?.name,
            milestoneType: 'LIQUIDITY_USD',
            threshold,
            currentValue: currentUsd,
            previousValue: previousUsd,
            timestamp: new Date(),
            significance: this.getUsdSignificance(threshold),
            message: this.formatUsdMilestoneMessage(tokenInfo, threshold, currentUsd),
            actionable: threshold >= 7500 // Your trading threshold
          });

          await this.markAlerted(tokenAddress, milestoneKey);
        }
      }
    }

    return alerts;
  }

  /**
   * STEP 3: Check SOL liquidity milestones
   */
  private async checkLiquiditySolMilestones(
    tokenAddress: string,
    current: any,
    previous: any,
    tokenInfo: any
  ): Promise<MilestoneAlert[]> {
    const alerts: MilestoneAlert[] = [];
    const currentSol = Number(current.real_sol_reserves || 0) / 1e9;
    const previousSol = Number(previous.real_sol_reserves || 0) / 1e9;

    for (const threshold of this.config.liquiditySolMilestones) {
      if (previousSol < threshold && currentSol >= threshold) {
        const milestoneKey = `liquidity_sol_${threshold}`;
        
        if (await this.shouldAlert(tokenAddress, milestoneKey)) {
          const isGraduation = threshold >= 73;
          
          alerts.push({
            tokenAddress,
            symbol: tokenInfo?.symbol,
            name: tokenInfo?.name,
            milestoneType: 'LIQUIDITY_SOL',
            threshold,
            currentValue: currentSol,
            previousValue: previousSol,
            timestamp: new Date(),
            significance: isGraduation ? 'CRITICAL' : this.getSolSignificance(threshold),
            message: isGraduation 
              ? this.formatGraduationMessage(tokenInfo, currentSol)
              : this.formatSolMilestoneMessage(tokenInfo, threshold, currentSol),
            actionable: threshold >= 50 // High SOL = potentially good trade
          });

          await this.markAlerted(tokenAddress, milestoneKey);
        }
      }
    }

    return alerts;
  }

  /**
   * STEP 4: Check graduation progress milestones
   */
  private async checkGraduationMilestones(
    tokenAddress: string,
    current: any,
    previous: any,
    tokenInfo: any
  ): Promise<MilestoneAlert[]> {
    const alerts: MilestoneAlert[] = [];
    const currentSol = Number(current.real_sol_reserves || 0) / 1e9;
    const previousSol = Number(previous.real_sol_reserves || 0) / 1e9;
    
    const currentProgress = Math.min((currentSol / 73) * 100, 100);
    const previousProgress = Math.min((previousSol / 73) * 100, 100);

    for (const threshold of this.config.graduationMilestones) {
      if (previousProgress < threshold && currentProgress >= threshold) {
        const milestoneKey = `graduation_${threshold}`;
        
        if (await this.shouldAlert(tokenAddress, milestoneKey)) {
          alerts.push({
            tokenAddress,
            symbol: tokenInfo?.symbol,
            name: tokenInfo?.name,
            milestoneType: 'GRADUATION_PROGRESS',
            threshold,
            currentValue: currentProgress,
            previousValue: previousProgress,
            timestamp: new Date(),
            significance: this.getGraduationSignificance(threshold),
            message: this.formatGraduationProgressMessage(tokenInfo, threshold, currentProgress, currentSol),
            actionable: threshold >= 70 // High graduation progress = watch closely
          });

          await this.markAlerted(tokenAddress, milestoneKey);
        }
      }
    }

    return alerts;
  }

  /**
   * STEP 5: Check velocity milestones (growth rate)
   */
  private async checkVelocityMilestones(
    tokenAddress: string,
    current: any,
    previous: any,
    tokenInfo: any
  ): Promise<MilestoneAlert[]> {
    const alerts: MilestoneAlert[] = [];
    
    // Calculate SOL/hour velocity if we have timestamps
    const currentSol = Number(current.real_sol_reserves || 0) / 1e9;
    const previousSol = Number(previous.real_sol_reserves || 0) / 1e9;
    const currentTime = new Date(current.timestamp || Date.now());
    const previousTime = new Date(previous.timestamp || Date.now() - 60000); // Default 1 min ago
    
    const hoursDiff = (currentTime.getTime() - previousTime.getTime()) / (1000 * 60 * 60);
    if (hoursDiff <= 0) return alerts;
    
    const velocity = (currentSol - previousSol) / hoursDiff; // SOL per hour

    for (const threshold of this.config.velocityMilestones) {
      if (velocity >= threshold) {
        const milestoneKey = `velocity_${threshold}`;
        
        if (await this.shouldAlert(tokenAddress, milestoneKey)) {
          alerts.push({
            tokenAddress,
            symbol: tokenInfo?.symbol,
            name: tokenInfo?.name,
            milestoneType: 'VELOCITY',
            threshold,
            currentValue: velocity,
            previousValue: 0, // Not tracking previous velocity
            timestamp: new Date(),
            significance: this.getVelocitySignificance(velocity),
            message: this.formatVelocityMessage(tokenInfo, velocity, currentSol),
            actionable: velocity >= 5 // High velocity = potential opportunity
          });

          await this.markAlerted(tokenAddress, milestoneKey);
        }
      }
    }

    return alerts;
  }

  /**
   * STEP 6: Alert cooldown management
   */
  private async shouldAlert(tokenAddress: string, milestoneKey: string): Promise<boolean> {
    const tokenHistory = this.milestoneHistory.get(tokenAddress) || new Map();
    const lastAlert = tokenHistory.get(milestoneKey);
    
    if (!lastAlert) return true;
    
    const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
    const timeSinceLastAlert = Date.now() - lastAlert.getTime();
    
    return timeSinceLastAlert >= cooldownMs;
  }

  private async markAlerted(tokenAddress: string, milestoneKey: string): Promise<void> {
    let tokenHistory = this.milestoneHistory.get(tokenAddress);
    if (!tokenHistory) {
      tokenHistory = new Map();
      this.milestoneHistory.set(tokenAddress, tokenHistory);
    }
    
    tokenHistory.set(milestoneKey, new Date());
  }

  /**
   * STEP 7: Significance calculation methods
   */
  private getUsdSignificance(threshold: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (threshold >= 50000) return 'CRITICAL';
    if (threshold >= 25000) return 'HIGH';
    if (threshold >= 7500) return 'MEDIUM';  // Your trading threshold
    return 'LOW';
  }

  private getSolSignificance(threshold: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (threshold >= 70) return 'CRITICAL';   // Near graduation
    if (threshold >= 50) return 'HIGH';
    if (threshold >= 25) return 'MEDIUM';
    return 'LOW';
  }

  private getGraduationSignificance(threshold: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (threshold >= 90) return 'CRITICAL';   // Imminent graduation
    if (threshold >= 70) return 'HIGH';       // Close to graduation
    if (threshold >= 50) return 'MEDIUM';
    return 'LOW';
  }

  private getVelocitySignificance(velocity: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (velocity >= 20) return 'CRITICAL';    // Extremely fast growth
    if (velocity >= 10) return 'HIGH';        // Fast growth
    if (velocity >= 5) return 'MEDIUM';       // Good growth
    return 'LOW';
  }

  /**
   * STEP 8: Message formatting methods
   */
  private formatUsdMilestoneMessage(tokenInfo: any, threshold: number, current: number): string {
    const symbol = this.getDisplaySymbol(tokenInfo);
    return `💰 ${symbol} reached $${threshold.toLocaleString()} liquidity milestone! Current: $${current.toLocaleString()}`;
  }

  private formatSolMilestoneMessage(tokenInfo: any, threshold: number, current: number): string {
    const symbol = this.getDisplaySymbol(tokenInfo);
    return `🟡 ${symbol} hit ${threshold} SOL liquidity! Current: ${current.toFixed(1)} SOL`;
  }

  private formatGraduationMessage(tokenInfo: any, currentSol: number): string {
    const symbol = this.getDisplaySymbol(tokenInfo);
    return `🎓 ${symbol} GRADUATED! Migrating to Raydium with ${currentSol.toFixed(1)} SOL liquidity`;
  }

  private formatGraduationProgressMessage(tokenInfo: any, threshold: number, current: number, sol: number): string {
    const symbol = this.getDisplaySymbol(tokenInfo);
    return `📈 ${symbol} ${threshold}% graduation progress! (${current.toFixed(1)}% complete, ${sol.toFixed(1)} SOL)`;
  }

  private formatVelocityMessage(tokenInfo: any, velocity: number, currentSol: number): string {
    const symbol = this.getDisplaySymbol(tokenInfo);
    return `🚀 ${symbol} HIGH VELOCITY: +${velocity.toFixed(1)} SOL/hour! Current: ${currentSol.toFixed(1)} SOL`;
  }

  private getDisplaySymbol(tokenInfo: any): string {
    if (tokenInfo?.symbol && tokenInfo.symbol !== 'LOADING...') {
      return tokenInfo.symbol;
    }
    return tokenInfo?.address?.substring(0, 8) + '...' || 'TOKEN';
  }

  /**
   * STEP 9: Database storage
   */
  private async storeAlerts(alerts: MilestoneAlert[]): Promise<void> {
    if (alerts.length === 0) return;

    try {
      const insertData = alerts.map(alert => ({
        token_address: alert.tokenAddress,
        milestone_type: alert.milestoneType,
        threshold: alert.threshold,
        current_value: alert.currentValue,
        previous_value: alert.previousValue,
        significance: alert.significance,
        message: alert.message,
        actionable: alert.actionable,
        created_at: alert.timestamp
      }));

      await db('liquidity_milestone_alerts').insert(insertData);
      
    } catch (error) {
      logger.error('Error storing milestone alerts:', error);
    }
  }

  /**
   * STEP 10: Helper methods
   */
  private async getTokenInfo(tokenAddress: string): Promise<any> {
    try {
      const token = await db('tokens').where('address', tokenAddress).first();
      return token;
    } catch (error) {
      return { address: tokenAddress };
    }
  }

  /**
   * Get alert statistics
   */
  getAlertStats() {
    const totalTokens = this.milestoneHistory.size;
    const totalMilestones = Array.from(this.milestoneHistory.values())
      .reduce((sum, tokenMap) => sum + tokenMap.size, 0);
    
    return {
      trackedTokens: totalTokens,
      totalMilestones,
      config: this.config
    };
  }

  /**
   * Clear old history to prevent memory leaks
   */
  clearOldHistory(olderThanHours: number = 24): void {
    const cutoff = Date.now() - (olderThanHours * 60 * 60 * 1000);
    
    for (const [tokenAddress, milestoneMap] of this.milestoneHistory.entries()) {
      for (const [milestone, timestamp] of milestoneMap.entries()) {
        if (timestamp.getTime() < cutoff) {
          milestoneMap.delete(milestone);
        }
      }
      
      // Remove empty token entries
      if (milestoneMap.size === 0) {
        this.milestoneHistory.delete(tokenAddress);
      }
    }
  }
}

// Export singleton instance
export const LIQUIDITY_MILESTONE_ALERTS = new LiquidityMilestoneAlerts();
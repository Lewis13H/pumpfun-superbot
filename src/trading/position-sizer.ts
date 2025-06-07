import { categoryConfig } from '../config/category-config';
import { BuyEvaluation } from './buy-signal-evaluator';
import { logger } from '../utils/logger';

export interface PositionSize {
  basePosition: number;
  finalPosition: number;
  limitFactors: {
    solsniffer: number;
    holders: number;
    concentration: number;
  };
  reasoning: string[];
}

export class PositionSizer {
  private readonly limits = categoryConfig.positionLimits;
  private readonly defaultBasePosition = 1.0; // 1 SOL default
  
  /**
   * Calculate position size based on evaluation
   */
  calculatePosition(
    evaluation: BuyEvaluation,
    basePosition: number = this.defaultBasePosition
  ): PositionSize {
    // Don't size if evaluation didn't pass
    if (!evaluation.passed) {
      return {
        basePosition,
        finalPosition: 0,
        limitFactors: {
          solsniffer: 0,
          holders: 0,
          concentration: 0,
        },
        reasoning: ['Evaluation did not pass all criteria'],
      };
    }
    
    const reasoning: string[] = [];
    const limits: number[] = [basePosition];
    
    // Apply SolSniffer limit
    const solsnifferLimit = this.getSolsnifferLimit(evaluation.solsnifferScore);
    limits.push(solsnifferLimit);
    if (solsnifferLimit < basePosition) {
      reasoning.push(
        `SolSniffer score ${evaluation.solsnifferScore} limits position to ${solsnifferLimit} SOL`
      );
    }
    
    // Apply holder limit
    const holderLimit = this.getHolderLimit(evaluation.holders);
    limits.push(holderLimit);
    if (holderLimit < basePosition) {
      reasoning.push(
        `Holder count ${evaluation.holders} limits position to ${holderLimit} SOL`
      );
    }
    
    // Apply concentration limit
    const concentrationLimit = this.getConcentrationLimit(evaluation.top10Percent);
    limits.push(concentrationLimit);
    if (concentrationLimit < basePosition) {
      reasoning.push(
        `Top 10 concentration ${evaluation.top10Percent}% limits position to ${concentrationLimit} SOL`
      );
    }
    
    // Final position is minimum of all limits
    const finalPosition = Math.min(...limits);
    
    if (reasoning.length === 0) {
      reasoning.push('No limiting factors - full position allowed');
    }
    
    logger.info(`Position sizing for ${evaluation.tokenAddress}: ${finalPosition} SOL`);
    reasoning.forEach(r => logger.info(`  - ${r}`));
    
    return {
      basePosition,
      finalPosition,
      limitFactors: {
        solsniffer: solsnifferLimit,
        holders: holderLimit,
        concentration: concentrationLimit,
      },
      reasoning,
    };
  }
  
  /**
   * Get limit based on SolSniffer score
   */
  private getSolsnifferLimit(score: number): number {
    // Check blacklist
    if (this.limits.solsniffer.some(tier => score === 90)) {
      return 0; // Blacklisted score
    }
    
    // Find applicable tier
    for (const tier of this.limits.solsniffer) {
      if (score >= tier.min && score <= tier.max) {
        return tier.limit;
      }
    }
    
    // No limit if above all tiers
    return this.defaultBasePosition;
  }
  
  /**
   * Get limit based on holder count
   */
  private getHolderLimit(holders: number): number {
    // Find applicable tier
    for (const tier of this.limits.holders) {
      if (holders >= tier.min && holders < tier.max) {
        return tier.limit;
      }
    }
    
    // No limit if above all tiers
    return this.defaultBasePosition;
  }
  
  /**
   * Get limit based on concentration
   */
  private getConcentrationLimit(top10Percent: number): number {
    if (top10Percent > this.limits.concentration.threshold) {
      return this.limits.concentration.limit;
    }
    return this.defaultBasePosition;
  }
  
  /**
   * Calculate position for multiple evaluations
   */
  calculateMultiplePositions(
    evaluations: BuyEvaluation[],
    totalCapital: number = 10
  ): Array<{ evaluation: BuyEvaluation; position: PositionSize }> {
    const results = evaluations.map(evaluation => ({
      evaluation,
      position: this.calculatePosition(evaluation),
    }));
    
    // Sort by confidence (highest first)
    results.sort((a, b) => b.evaluation.confidence - a.evaluation.confidence);
    
    // Apply capital allocation
    let remainingCapital = totalCapital;
    const allocatedResults = results.map(result => {
      if (remainingCapital <= 0 || result.position.finalPosition === 0) {
        return {
          ...result,
          position: {
            ...result.position,
            finalPosition: 0,
            reasoning: [...result.position.reasoning, 'No capital remaining'],
          },
        };
      }
      
      const allocated = Math.min(result.position.finalPosition, remainingCapital);
      remainingCapital -= allocated;
      
      return {
        ...result,
        position: {
          ...result.position,
          finalPosition: allocated,
        },
      };
    });
    
    return allocatedResults;
  }
  
  /**
   * Get recommended position sizes by market cap
   */
  getRecommendationsByMarketCap(): any {
    return {
      conservative: {
        '35k-50k': 0.5,
        '50k-70k': 0.3,
        '70k-105k': 0.2,
      },
      moderate: {
        '35k-50k': 1.0,
        '50k-70k': 0.7,
        '70k-105k': 0.5,
      },
      aggressive: {
        '35k-50k': 2.0,
        '50k-70k': 1.5,
        '70k-105k': 1.0,
      },
    };
  }
  
  /**
   * Validate position against risk rules
   */
  validatePosition(
    position: number,
    totalPortfolio: number,
    maxPercentage: number = 0.1
  ): { valid: boolean; reason?: string } {
    const positionPercentage = position / totalPortfolio;
    
    if (positionPercentage > maxPercentage) {
      return {
        valid: false,
        reason: `Position ${(positionPercentage * 100).toFixed(1)}% exceeds max ${maxPercentage * 100}% of portfolio`,
      };
    }
    
    if (position < 0.01) {
      return {
        valid: false,
        reason: 'Position size too small (< 0.01 SOL)',
      };
    }
    
    return { valid: true };
  }
}

// Export singleton instance
export const positionSizer = new PositionSizer();


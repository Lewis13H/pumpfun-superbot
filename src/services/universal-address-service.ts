// src/services/universal-address-service.ts
import { EnhancedYellowstoneClient } from '../grpc/enhanced-yellowstone-client';
import { DualAddressDbService } from './dual-address-db-service';
import { logger } from '../utils/logger2';

export class UniversalAddressService {
  constructor(
    private grpcClient: EnhancedYellowstoneClient,
    private dbService: DualAddressDbService
  ) {}
  
  /**
   * Resolve any address to both SPL and pump.fun addresses
   */
  async resolveAddress(address: string): Promise<{
    spl: string;
    pumpfun: string;
    source: 'cache' | 'database';
  } | null> {
    // Check in-memory cache first
    const cached = this.grpcClient.getAddressPair(address);
    if (cached) {
      return { ...cached, source: 'cache' };
    }
    
    // Check database
    const dbResult = await this.dbService.getAddressPair(address);
    if (dbResult) {
      return { ...dbResult, source: 'database' };
    }
    
    return null;
  }
  
  /**
   * Get full token data by any address
   */
  async getTokenData(address: string): Promise<any> {
    // First resolve the address pair
    const addressPair = await this.resolveAddress(address);
    if (!addressPair) {
      logger.warn(`No address pair found for: ${address}`);
      return null;
    }
    
    // Get full token data from database
    const tokenData = await this.dbService.getTokenByAnyAddress(address);
    
    return {
      ...tokenData,
      addresses: addressPair
    };
  }
  
  /**
   * Validate if address is pump.fun format (ends with 'pump')
   */
  isPumpfunVanityAddress(address: string): boolean {
    return address.endsWith('pump') && address.length === 44;
  }
  
  /**
   * Get address type
   */
  getAddressType(address: string): 'spl' | 'pumpfun' | 'unknown' {
    if (this.isPumpfunVanityAddress(address)) {
      return 'pumpfun';
    }
    
    if (address.length === 44) {
      return 'spl';
    }
    
    return 'unknown';
  }
}
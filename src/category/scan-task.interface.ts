import { TokenCategory } from '../config/category-config';

export interface ScanTask {
  tokenAddress: string;
  category: TokenCategory;
  scanNumber: number;
  startedAt: Date;
  lastScanAt?: Date;
  nextScanAt: Date;
  timeoutAt: Date;
  priority: number;
}

export interface ScanResult {
  tokenAddress: string;
  success: boolean;
  marketCap?: number;
  error?: string;
  duration: number;
  apisUsed: string[];
}

export interface ScanSchedule {
  category: TokenCategory;
  tasks: ScanTask[];
  activeScans: number;
  completedScans: number;
  failedScans: number;
}

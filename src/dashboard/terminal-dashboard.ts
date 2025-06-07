// src/dashboard/terminal-dashboard.ts

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { EventEmitter } from 'events';
import { db } from '../database/postgres';
import { logger } from '../utils/logger';
import { GrpcStreamManager } from '../grpc/grpc-stream-manager';

interface DashboardConfig {
  refreshInterval?: number;
  maxLogLines?: number;
  priceHistoryMinutes?: number;
}

interface TokenStats {
  totalTokens: number;
  newTokens24h: number;
  activeTokens: number;
  totalVolume24h: number;
  avgMarketCap: number;
}

interface StreamStats {
  pricesProcessed: number;
  transactionsProcessed: number;
  newTokensDiscovered: number;
  buysDetected: number;
  sellsDetected: number;
  errors: number;
  bufferSizes: {
    prices: number;
    transactions: number;
    newTokens: number;
  };
  isRunning: boolean;
  grpcConnected: boolean;
}

export class TerminalDashboard extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private grid: any;
  private widgets: {
    statsTable: any;
    priceChart: any;
    topMoversTable: any;
    recentTxTable: any;
    logBox: any;
    categoryDonut: any;
    volumeBar: any;
    systemGauge: any;
  };
  
  private config: Required<DashboardConfig>;
  private updateInterval?: NodeJS.Timeout;
  private priceHistory: Map<string, number[]> = new Map();
  private logs: string[] = [];
  private streamManager?: GrpcStreamManager;
  
  constructor(config: DashboardConfig = {}) {
    super();
    
    this.config = {
      refreshInterval: 1000,
      maxLogLines: 50,
      priceHistoryMinutes: 30,
      ...config
    };
    
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Memecoin Bot Dashboard',
      fullUnicode: true
    });
    
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });
    this.widgets = this.createWidgets();
    this.setupEventHandlers();
  }
  
  private createWidgets() {
    // Top row - System stats and stream info
    const statsTable = this.grid.set(0, 0, 3, 4, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      label: '📊 System Statistics',
      width: '30%',
      height: '30%',
      border: { type: "line", fg: "cyan" },
      columnSpacing: 2,
      columnWidth: [20, 15]
    });
    
    // Price chart - takes more space
    const priceChart = this.grid.set(0, 4, 6, 8, contrib.line, {
      style: {
        line: "yellow",
        text: "green",
        baseline: "black"
      },
      xLabelPadding: 3,
      xPadding: 5,
      showLegend: true,
      wholeNumbersOnly: false,
      label: '📈 Price Movement (Top 5 Tokens)',
      border: { type: "line", fg: "cyan" }
    });
    
    // Category distribution donut
    const categoryDonut = this.grid.set(3, 0, 3, 4, contrib.donut, {
      label: '🎯 Token Categories',
      radius: 8,
      arcWidth: 3,
      remainColor: 'black',
      yPadding: 2,
      border: { type: "line", fg: "cyan" }
    });
    
    // Volume bar chart
    const volumeBar = this.grid.set(6, 0, 3, 4, contrib.bar, {
      label: '💰 Volume by Category (24h)',
      barWidth: 4,
      barSpacing: 6,
      xOffset: 0,
      maxHeight: 9,
      border: { type: "line", fg: "cyan" }
    });
    
    // System health gauge
    const systemGauge = this.grid.set(9, 0, 3, 4, contrib.gauge, {
      label: '🔋 System Health',
      stroke: 'green',
      fill: 'white',
      border: { type: "line", fg: "cyan" }
    });
    
    // Top movers table
    const topMoversTable = this.grid.set(6, 4, 3, 4, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      label: '🚀 Top Movers (1h)',
      width: '30%',
      height: '30%',
      border: { type: "line", fg: "cyan" },
      columnSpacing: 1,
      columnWidth: [8, 20, 10, 10]
    });
    
    // Recent transactions
    const recentTxTable = this.grid.set(6, 8, 3, 4, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      label: '💸 Recent Transactions',
      width: '30%',
      height: '30%',
      border: { type: "line", fg: "cyan" },
      columnSpacing: 1,
      columnWidth: [8, 6, 15, 10]
    });
    
    // Log box at bottom
    const logBox = this.grid.set(9, 4, 3, 8, contrib.log, {
      fg: "green",
      selectedFg: "green",
      label: '📝 Activity Log',
      border: { type: "line", fg: "cyan" }
    });
    
    return {
      statsTable,
      priceChart,
      topMoversTable,
      recentTxTable,
      logBox,
      categoryDonut,
      volumeBar,
      systemGauge
    };
  }
  
  private setupEventHandlers(): void {
    // Quit on Escape, q, or Control-C
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.stop();
      process.exit(0);
    });
    
    // Focus navigation
    this.screen.key(['tab'], () => {
      this.screen.focusNext();
    });
    
    // Render on resize
    this.screen.on('resize', () => {
      this.widgets.statsTable.emit('attach');
      this.widgets.priceChart.emit('attach');
      this.widgets.topMoversTable.emit('attach');
      this.widgets.recentTxTable.emit('attach');
      this.widgets.logBox.emit('attach');
      this.widgets.categoryDonut.emit('attach');
      this.widgets.volumeBar.emit('attach');
      this.widgets.systemGauge.emit('attach');
      this.screen.render();
    });
  }
  
  async start(streamManager?: GrpcStreamManager): Promise<void> {
    this.streamManager = streamManager;
    
    // Initial render
    await this.updateDashboard();
    
    // Start update loop
    this.updateInterval = setInterval(async () => {
      await this.updateDashboard();
    }, this.config.refreshInterval);
    
    // Listen to stream events if available
    if (this.streamManager) {
      this.streamManager.on('priceUpdate', (price) => {
        this.addLog(`💰 Price: ${price.tokenAddress.slice(0, 8)}... $${price.priceUsd.toFixed(6)}`);
      });
      
      this.streamManager.on('newToken', (token) => {
        this.addLog(`🎉 NEW TOKEN: ${token.symbol || token.address.slice(0, 8)}...`);
      });
      
      this.streamManager.on('buySignal', ({ token, evaluation }) => {
        this.addLog(`🔥 BUY SIGNAL: ${token.symbol} - ${evaluation.confidence.toFixed(2)} confidence`);
      });
      
      this.streamManager.on('pumpDetected', (data) => {
        this.addLog(`🚀 PUMP: ${data.tokenAddress.slice(0, 8)}... +${data.priceChange.toFixed(2)}%`);
      });
    }
    
    this.screen.render();
  }
  
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
  
  private async updateDashboard(): Promise<void> {
    try {
      // Update all widgets in parallel
      await Promise.all([
        this.updateStats(),
        this.updatePriceChart(),
        this.updateTopMovers(),
        this.updateRecentTransactions(),
        this.updateCategoryDistribution(),
        this.updateVolumeChart(),
        this.updateSystemHealth()
      ]);
      
      this.screen.render();
    } catch (error) {
      this.addLog(`❌ Dashboard update error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updateStats(): Promise<void> {
    try {
      // Get stream stats if available
      const streamStats = this.streamManager?.getStats() || {
        pricesProcessed: 0,
        transactionsProcessed: 0,
        newTokensDiscovered: 0,
        buysDetected: 0,
        sellsDetected: 0,
        errors: 0,
        isRunning: false,
        grpcConnected: false
      };
      
      // Get database stats
      const dbStats = await db('tokens')
        .select(
          db.raw('COUNT(*) as total_tokens'),
          db.raw('COUNT(CASE WHEN created_at > NOW() - INTERVAL \'24 hours\' THEN 1 END) as new_24h'),
          db.raw('COUNT(CASE WHEN last_price_update > NOW() - INTERVAL \'5 minutes\' THEN 1 END) as active_tokens'),
          db.raw('AVG(market_cap) as avg_market_cap')
        )
        .first();
      
      const volumeStats = await db('tokens')
        .select(db.raw('SUM(volume_24h) as total_volume'))
        .first();
      
      const data = [
        ['Metric', 'Value'],
        ['─────────────────', '─────────────'],
        ['Status', streamStats.grpcConnected ? '🟢 Connected' : '🔴 Disconnected'],
        ['Total Tokens', dbStats.total_tokens.toLocaleString()],
        ['New (24h)', dbStats.new_24h.toLocaleString()],
        ['Active (5m)', dbStats.active_tokens.toLocaleString()],
        ['Avg Market Cap', `$${parseFloat(dbStats.avg_market_cap || 0).toLocaleString()}`],
        ['Volume (24h)', `$${parseFloat(volumeStats.total_volume || 0).toLocaleString()}`],
        ['─────────────────', '─────────────'],
        ['Prices Processed', streamStats.pricesProcessed.toLocaleString()],
        ['Transactions', streamStats.transactionsProcessed.toLocaleString()],
        ['Buy Orders', streamStats.buysDetected.toLocaleString()],
        ['Sell Orders', streamStats.sellsDetected.toLocaleString()],
        ['Errors', streamStats.errors.toLocaleString()]
      ];
      
      this.widgets.statsTable.setData(data);
    } catch (error) {
      this.addLog(`Error updating stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updatePriceChart(): Promise<void> {
    try {
      // Get top 5 tokens by market cap
      const topTokens = await db('tokens')
        .select('address', 'symbol', 'market_cap')
        .whereNotNull('market_cap')
        .where('market_cap', '>', 0)
        .orderBy('market_cap', 'desc')
        .limit(5);
      
      const series = [];
      
      for (const token of topTokens) {
        // Get price history for last 30 minutes
        const prices = await db('timeseries.token_prices')
          .select('time', 'price_usd')
          .where('token_address', token.address)
          .where('time', '>', db.raw('NOW() - INTERVAL \'30 minutes\''))
          .orderBy('time', 'asc');
        
        if (prices.length > 0) {
          const x = prices.map((_, i) => i.toString());
          const y = prices.map(p => parseFloat(p.price_usd));
          
          series.push({
            title: token.symbol || token.address.slice(0, 8),
            x: x,
            y: y,
            style: {
              line: this.getColorForIndex(series.length)
            }
          });
        }
      }
      
      if (series.length > 0) {
        this.widgets.priceChart.setData(series);
      }
    } catch (error) {
      this.addLog(`Error updating price chart: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updateTopMovers(): Promise<void> {
    try {
      const movers = await db('tokens')
        .select('symbol', 'name', 'price_change_1h', 'market_cap')
        .whereNotNull('price_change_1h')
        .where('market_cap', '>', 1000)
        .orderBy('price_change_1h', 'desc')
        .limit(10);
      
      const data = [
        ['Symbol', 'Name', 'Change', 'MCap'],
        ['──────', '────────────────────', '──────────', '──────────']
      ];
      
      for (const mover of movers) {
        const change = parseFloat(mover.price_change_1h || 0);
        const changeStr = change > 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
        const changeColor = change > 0 ? '{green-fg}' : '{red-fg}';
        
        data.push([
          mover.symbol || 'UNKN',
          (mover.name || 'Unknown').slice(0, 20),
          `${changeColor}${changeStr}{/}`,
          `$${(mover.market_cap / 1000).toFixed(1)}k`
        ]);
      }
      
      this.widgets.topMoversTable.setData(data);
    } catch (error) {
      this.addLog(`Error updating top movers: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updateRecentTransactions(): Promise<void> {
    try {
      const txs = await db('timeseries.token_transactions as tx')
        .select(
          'tx.type',
          'tx.time',
          'tx.sol_amount',
          'tx.price_usd',
          't.symbol'
        )
        .join('tokens as t', 'tx.token_address', 't.address')
        .orderBy('tx.time', 'desc')
        .limit(10);
      
      const data = [
        ['Time', 'Type', 'Token', 'Amount'],
        ['────────', '──────', '───────────────', '──────────']
      ];
      
      for (const tx of txs) {
        const time = new Date(tx.time);
        const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;
        const typeColor = tx.type === 'buy' ? '{green-fg}' : tx.type === 'sell' ? '{red-fg}' : '{yellow-fg}';
        const amount = parseFloat(tx.sol_amount) / 1e9;
        
        data.push([
          timeStr,
          `${typeColor}${tx.type.toUpperCase()}{/}`,
          tx.symbol || 'UNKNOWN',
          `${amount.toFixed(3)} SOL`
        ]);
      }
      
      this.widgets.recentTxTable.setData(data);
    } catch (error) {
      this.addLog(`Error updating transactions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updateCategoryDistribution(): Promise<void> {
    try {
      const categories = await db('tokens')
        .select('category', db.raw('COUNT(*) as count'))
        .groupBy('category')
        .orderBy('count', 'desc');
      
      const data = categories.map(cat => ({
        percent: cat.count,
        label: cat.category || 'UNKNOWN',
        color: this.getCategoryColor(cat.category)
      }));
      
      this.widgets.categoryDonut.setData(data);
    } catch (error) {
      this.addLog(`Error updating category distribution: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updateVolumeChart(): Promise<void> {
    try {
      const volumes = await db('tokens')
        .select('category', db.raw('SUM(volume_24h) as total_volume'))
        .groupBy('category')
        .orderBy('total_volume', 'desc')
        .limit(6);
      
      const titles = volumes.map(v => v.category || 'UNKNOWN');
      const data = volumes.map(v => Math.round(parseFloat(v.total_volume || 0) / 1000)); // in thousands
      
      this.widgets.volumeBar.setData({
        titles: titles,
        data: data
      });
    } catch (error) {
      this.addLog(`Error updating volume chart: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updateSystemHealth(): Promise<void> {
    try {
      const streamStats = this.streamManager?.getStats();
      
      // Calculate health score (0-100)
      let healthScore = 100;
      
      // Deduct points for various issues
      if (!streamStats?.grpcConnected) healthScore -= 50;
      if (streamStats && streamStats.errors > 10) healthScore -= 20;
      if (streamStats && streamStats.errors > 50) healthScore -= 20;
      
      // Check data freshness
      const recentPrices = await db('timeseries.token_prices')
        .count('* as count')
        .where('time', '>', db.raw('NOW() - INTERVAL \'1 minute\''))
        .first();
      
      if (recentPrices && typeof recentPrices.count === 'number' && recentPrices.count < 10) {
        healthScore -= 10;
      }
      
      this.widgets.systemGauge.setPercent(Math.max(0, healthScore));
      
      // Set color based on health
      if (healthScore > 80) {
        this.widgets.systemGauge.setStack([{ percent: healthScore, stroke: 'green' }]);
      } else if (healthScore > 50) {
        this.widgets.systemGauge.setStack([{ percent: healthScore, stroke: 'yellow' }]);
      } else {
        this.widgets.systemGauge.setStack([{ percent: healthScore, stroke: 'red' }]);
      }
    } catch (error) {
      this.addLog(`Error updating system health: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private addLog(message: string): void {
    const timestamp = new Date().toISOString().substr(11, 8);
    const logMessage = `[${timestamp}] ${message}`;
    
    this.logs.push(logMessage);
    
    // Keep only recent logs
    if (this.logs.length > this.config.maxLogLines) {
      this.logs.shift();
    }
    
    this.widgets.logBox.log(logMessage);
  }
  
  private getColorForIndex(index: number): string {
    const colors = ['yellow', 'green', 'cyan', 'magenta', 'blue'];
    return colors[index % colors.length];
  }
  
  private getCategoryColor(category: string): string {
    const colors: { [key: string]: string } = {
      'NEW': 'blue',
      'LOW': 'cyan',
      'MEDIUM': 'yellow',
      'HIGH': 'magenta',
      'AIM': 'green',
      'ARCHIVE': 'gray'
    };
    return colors[category] || 'white';
  }
}

// Export for use in the main app
export default TerminalDashboard;
// src/dashboard/standalone-dashboard.ts
// Standalone dashboard that reads from database only - no gRPC connection needed

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { db } from '../database/postgres';

// Add NULL safety helper
const safeNumber = (value: any): number => {
  return parseFloat(value || 0) || 0;
};

export class StandaloneDashboard {
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
  
  private updateInterval?: NodeJS.Timeout;
  private startTime = Date.now();
  
  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Memecoin Bot Dashboard - Monitor',
      fullUnicode: true
    });
    
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });
    this.widgets = this.createWidgets();
    this.setupEventHandlers();
  }
  
  private createWidgets() {
    // Top row - System stats
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
    
    // Price chart
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
      label: '🔋 Data Freshness',
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
    
    // Event log at bottom
    const logBox = this.grid.set(9, 4, 3, 8, contrib.log, {
      fg: "green",
      selectedFg: "green",
      label: '📝 Recent Events',
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
  
  async start(): Promise<void> {
    // Initial render
    await this.updateDashboard();
    
    // Check for recent events periodically
    setInterval(() => this.checkRecentEvents(), 5000);
    
    // Start update loop
    this.updateInterval = setInterval(async () => {
      await this.updateDashboard();
    }, 1000); // Update every second
    
    this.screen.render();
  }
  
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
  
  private async updateDashboard(): Promise<void> {
    try {
      await Promise.all([
        this.updateStats(),
        this.updatePriceChart(),
        this.updateTopMovers(),
        this.updateRecentTransactions(),
        this.updateCategoryDistribution(),
        this.updateVolumeChart(),
        this.updateDataFreshness()
      ]);
      
      this.screen.render();
    } catch (error) {
      this.addLog(`❌ Update error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updateStats(): Promise<void> {
    try {
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
      
      // Get streaming stats from recent data
      const streamingStats = await db('timeseries.token_prices')
        .select(
          db.raw('COUNT(*) as price_updates'),
          db.raw('COUNT(DISTINCT token_address) as unique_tokens')
        )
        .where('time', '>', db.raw('NOW() - INTERVAL \'5 minutes\''))
        .first();
      
      const data = [
        ['Metric', 'Value'],
        ['─────────────────', '─────────────'],
        ['Status', streamingStats.price_updates > 0 ? '🟢 Active' : '🔴 Inactive'],
        ['Total Tokens', dbStats.total_tokens.toLocaleString()],
        ['New (24h)', dbStats.new_24h.toLocaleString()],
        ['Active (5m)', dbStats.active_tokens.toLocaleString()],
        ['Avg Market Cap', `$${safeNumber(dbStats.avg_market_cap).toLocaleString()}`],
        ['Volume (24h)', `$${safeNumber(volumeStats?.total_volume).toLocaleString()}`],
        ['─────────────────', '─────────────'],
        ['Updates (5m)', streamingStats.price_updates.toLocaleString()],
        ['Unique Tokens', streamingStats.unique_tokens.toLocaleString()],
        ['Uptime', this.getUptime()]
      ];
      
      this.widgets.statsTable.setData(data);
    } catch (error) {
      this.addLog(`Error updating stats`);
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
      this.addLog(`Error updating price chart`);
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
      this.addLog(`Error updating top movers`);
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
      this.addLog(`Error updating transactions`);
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
      this.addLog(`Error updating categories`);
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
      this.addLog(`Error updating volume chart`);
    }
  }
  
  private async updateDataFreshness(): Promise<void> {
    try {
      // Check how recent the data is
      const latestPrice = await db('timeseries.token_prices')
        .select('time')
        .orderBy('time', 'desc')
        .first();
      
      let freshnessScore = 0;
      if (latestPrice) {
        const secondsAgo = (Date.now() - new Date(latestPrice.time).getTime()) / 1000;
        if (secondsAgo < 10) freshnessScore = 100;
        else if (secondsAgo < 30) freshnessScore = 80;
        else if (secondsAgo < 60) freshnessScore = 60;
        else if (secondsAgo < 300) freshnessScore = 40;
        else freshnessScore = 20;
      }
      
      this.widgets.systemGauge.setPercent(freshnessScore);
      
      // Set color based on freshness
      if (freshnessScore > 80) {
        this.widgets.systemGauge.setStack([{ percent: freshnessScore, stroke: 'green' }]);
      } else if (freshnessScore > 50) {
        this.widgets.systemGauge.setStack([{ percent: freshnessScore, stroke: 'yellow' }]);
      } else {
        this.widgets.systemGauge.setStack([{ percent: freshnessScore, stroke: 'red' }]);
      }
    } catch (error) {
      this.addLog(`Error updating freshness`);
    }
  }
  
  private async checkRecentEvents(): Promise<void> {
    try {
      // Check for new tokens
      const newTokens = await db('tokens')
        .select('symbol', 'name', 'created_at')
        .where('created_at', '>', db.raw('NOW() - INTERVAL \'1 minute\''))
        .orderBy('created_at', 'desc')
        .limit(5);
      
      for (const token of newTokens) {
        this.addLog(`🎉 NEW TOKEN: ${token.symbol || 'UNKNOWN'} - ${token.name || 'Unknown'}`);
      }
      
      // Check for category transitions
      const transitions = await db('category_transitions')
        .select('token_address', 'from_category', 'to_category', 'created_at')
        .where('created_at', '>', db.raw('NOW() - INTERVAL \'1 minute\''))
        .orderBy('created_at', 'desc')
        .limit(5);
      
      for (const transition of transitions) {
        this.addLog(`📊 Category change: ${transition.from_category} → ${transition.to_category}`);
      }
      
      // Check for big movers
      const pumps = await db('tokens')
        .select('symbol', 'price_change_1h')
        .where('price_change_1h', '>', 20)
        .whereNotNull('price_change_1h')
        .limit(3);
      
      for (const pump of pumps) {
        this.addLog(`🚀 PUMP: ${pump.symbol} +${parseFloat(pump.price_change_1h).toFixed(2)}%`);
      }
      
    } catch (error) {
      // Silent fail - don't disrupt the dashboard
    }
  }
  
  private addLog(message: string): void {
    const timestamp = new Date().toISOString().substr(11, 8);
    const logMessage = `[${timestamp}] ${message}`;
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
  
  private getUptime(): string {
    const seconds = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
}

// Start the dashboard
async function startStandaloneDashboard() {
  console.log('Starting standalone dashboard...');
  
  try {
    // Test database connection
    await db.raw('SELECT NOW()');
    console.log('Database connected');
    
    // Create and start dashboard
    const dashboard = new StandaloneDashboard();
    await dashboard.start();
    
  } catch (error) {
    console.error('Failed to start dashboard:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  startStandaloneDashboard();
}
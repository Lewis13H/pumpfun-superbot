import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { scanScheduler } from '../src/category/scan-scheduler';
import * as fs from 'fs';

async function generatePerformanceReport() {
  console.log('Generating performance report...\n');
  
  let report = '# Category System Performance Report\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;
  
  // System overview
  report += '## System Overview\n\n';
  
  const totalTokens = await db('tokens').count('* as count').first();
  const distribution = await categoryManager.getCategoryDistribution();
  
  report += `Total Tokens: ${totalTokens?.count || 0}\n\n`;
  report += 'Category Distribution:\n';
  Object.entries(distribution).forEach(([cat, count]) => {
    report += `- ${cat}: ${count}\n`;
  });
  
  // Performance metrics
  report += '\n## Performance Metrics\n\n';
  
  // Scan performance
  const scanStats = await db('scan_logs')
    .select('category')
    .avg('scan_duration_ms as avg_duration')
    .count('* as total_scans')
    .groupBy('category');
  
  report += '### Scan Performance by Category\n\n';
  report += '| Category | Avg Duration (ms) | Total Scans |\n';
  report += '|----------|-------------------|-------------|\n';
  
  scanStats.forEach(stat => {
    report += `| ${stat.category} | ${Math.round(Number(stat.avg_duration))} | ${stat.total_scans} |\n`;
  });
  
  // API usage
  report += '\n### API Usage (Last 24h)\n\n';
  
  const apiUsage = await db('api_call_logs')
    .where('timestamp', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
    .select('service')
    .sum('cost as total_cost')
    .count('* as call_count')
    .groupBy('service');
  
  report += '| Service | Calls | Cost |\n';
  report += '|---------|-------|------|\n';
  
  let totalCost = 0;
  apiUsage.forEach(api => {
    const cost = Number(api.total_cost) || 0;
    totalCost += cost;
    report += `| ${api.service} | ${api.call_count} | ${cost.toFixed(3)} |\n`;
  });
  
  report += `\n**Total Daily Cost: ${totalCost.toFixed(2)}**\n`;
  
  // Buy signal performance
  report += '\n### Buy Signal Performance\n\n';
  
  const buyStats = await db('buy_evaluations')
    .select(
      db.raw('COUNT(*) as total'),
      db.raw('SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed')
    )
    .first();
  
  const passRate = Number(buyStats?.total) > 0 
    ? ((Number(buyStats?.passed) / Number(buyStats?.total)) * 100).toFixed(1)
    : '0';
  
  report += `- Total Evaluations: ${buyStats?.total || 0}\n`;
  report += `- Passed: ${buyStats?.passed || 0}\n`;
  report += `- Pass Rate: ${passRate}%\n`;
  
  // State transition analysis
  report += '\n### State Transitions (Last 7 days)\n\n';
  
  const transitions = await db('category_transitions')
    .where('created_at', '>', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    .select('from_category', 'to_category')
    .count('* as count')
    .groupBy('from_category', 'to_category')
    .orderBy('count', 'desc')
    .limit(10);
  
  report += '| From | To | Count |\n';
  report += '|------|----|-------|\n';
  
  transitions.forEach(t => {
    report += `| ${t.from_category} | ${t.to_category} | ${t.count} |\n`;
  });
  
  // Resource usage
  report += '\n## Resource Usage\n\n';
  
  const memUsage = process.memoryUsage();
  report += `- Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB\n`;
  report += `- RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB\n`;
  report += `- Active State Machines: ${categoryManager.getStats().activeMachines}\n`;
  
  // Save report
  const filename = `performance-report-${new Date().toISOString().split('T')[0]}.md`;
  fs.writeFileSync(filename, report);
  
  console.log(`Report saved to ${filename}`);
}

generatePerformanceReport()
  .then(() => process.exit(0))
  .catch(console.error);


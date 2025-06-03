import { db } from '../src/database/postgres';

async function checkApiLogs() {
  console.log('=== Checking API Call Logs ===\n');
  
  // Check recent API calls
  const recentCalls = await db('api_call_logs')
    .where('timestamp', '>', new Date(Date.now() - 60 * 60 * 1000)) // Last hour
    .orderBy('timestamp', 'desc')
    .limit(20);
  
  console.log(`Found ${recentCalls.length} API calls in last hour\n`);
  
  // Group by service
  const byService: Record<string, number> = {};
  recentCalls.forEach(call => {
    byService[call.service] = (byService[call.service] || 0) + 1;
  });
  
  console.log('API Calls by Service:');
  Object.entries(byService).forEach(([service, count]) => {
    console.log(`  ${service}: ${count} calls`);
  });
  
  // Check for failed calls
  const failedCalls = recentCalls.filter(call => call.status_code !== 200);
  if (failedCalls.length > 0) {
    console.log(`\n⚠️  Failed API Calls: ${failedCalls.length}`);
    failedCalls.forEach(call => {
      console.log(`  ${call.service} - ${call.endpoint}: ${call.status_code}`);
    });
  }
  
  // Check SolSniffer usage
  const solsnifferCalls = recentCalls.filter(call => call.service === 'solsniffer');
  console.log(`\nSolSniffer calls: ${solsnifferCalls.length}`);
  
  await db.destroy();
}

checkApiLogs();
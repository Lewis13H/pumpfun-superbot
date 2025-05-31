const axios = require('axios');

const API_BASE = 'http://localhost:3000';

async function testEndpoints() {
  console.log('🧪 Testing API Endpoints...\n');

  const endpoints = [
    { name: 'Health Check', url: '/health' },
    { name: 'API Health Check', url: '/api/health' },
    { name: 'Discovery Stats', url: '/api/discovery/stats' },
    { name: 'DB Stats', url: '/api/db-stats' },
    { name: 'Live Tokens', url: '/api/tokens/live?limit=5' },
    { name: 'Market Metrics', url: '/api/market/metrics' },
    { name: 'API Monitor Status', url: '/api/monitor/status' },
    { name: 'Signal History', url: '/api/signals/history?timeframe=24h' },
    { name: 'Settings', url: '/api/settings' }
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint.name}...`);
      const response = await axios.get(`${API_BASE}${endpoint.url}`, {
        timeout: 5000
      });
      console.log(`✅ ${endpoint.name}: ${response.status} - ${JSON.stringify(response.data).substring(0, 100)}...`);
    } catch (error) {
      if (error.response) {
        console.log(`❌ ${endpoint.name}: ${error.response.status} - ${error.response.data?.error || error.response.statusText}`);
      } else if (error.code === 'ECONNREFUSED') {
        console.log(`❌ ${endpoint.name}: Server not running`);
      } else {
        console.log(`❌ ${endpoint.name}: ${error.message}`);
      }
    }
    console.log('');
  }
}

if (require.main === module) {
  testEndpoints().catch(console.error);
}

module.exports = { testEndpoints }; 
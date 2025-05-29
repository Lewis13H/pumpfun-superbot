// scripts/test-dashboard-endpoints.ts
import axios from 'axios';

const API_BASE = 'http://localhost:3000';

async function testEndpoints() {
  console.log('Testing Dashboard API Endpoints...\n');

  const endpoints = [
    // Existing endpoints
    { method: 'GET', url: '/health', name: 'Health Check' },
    { method: 'GET', url: '/discovery/stats', name: 'Discovery Stats' },
    { method: 'GET', url: '/api/tokens?limit=5', name: 'Token List' },
    
    // New endpoints for dashboard
    { method: 'GET', url: '/api/monitor/status', name: 'API Monitor Status' },
    { method: 'GET', url: '/api/monitor/cost-history', name: 'Cost History' },
    { method: 'GET', url: '/api/monitor/errors', name: 'Error Logs' },
    { method: 'GET', url: '/api/signals/history', name: 'Signal History' },
    { method: 'GET', url: '/api/signals/stats', name: 'Signal Stats' },
    { method: 'GET', url: '/api/signals/profit-history', name: 'Profit History' },
    { method: 'GET', url: '/api/settings', name: 'Get Settings' },
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await axios({
        method: endpoint.method,
        url: API_BASE + endpoint.url,
      });
      
      console.log(`✅ ${endpoint.name}: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data).substring(0, 100)}...\n`);
    } catch (error: any) {
      console.log(`❌ ${endpoint.name}: ${error.response?.status || 'Failed'}`);
      console.log(`   Error: ${error.message}\n`);
    }
  }

  // Test WebSocket
  console.log('\nTesting WebSocket...');
  const io = require('socket.io-client');
  const socket = io('http://localhost:3000');
  
  socket.on('connect', () => {
    console.log('✅ WebSocket connected');
    console.log('   Socket ID:', socket.id);
    
    // Test subscribing to channels
    socket.emit('subscribe', ['tokens', 'discovery-stats']);
    console.log('   Subscribed to channels: tokens, discovery-stats');
    
    setTimeout(() => {
      socket.disconnect();
      console.log('\n✅ All tests complete!');
      process.exit(0);
    }, 2000);
  });

  socket.on('connect_error', (error: any) => {
    console.log('❌ WebSocket connection failed:', error.message);
    process.exit(1);
  });
}

testEndpoints().catch(console.error);
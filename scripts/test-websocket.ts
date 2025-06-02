import { io, Socket } from 'socket.io-client';

const socket: Socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected to WebSocket server');
  
  // Subscribe to all channels
  socket.emit('subscribe', [
    'categories',
    'buy-signals',
    'scans',
    'category-stats',
    'tokens',
    'enrichment',
  ]);
});

// Category events
socket.on('category-change', (data) => {
  console.log('\n📊 Category Change:');
  console.log(`  ${data.symbol}: ${data.fromCategory} → ${data.toCategory}`);
  console.log(`  Market Cap: ${data.marketCap}`);
});

socket.on('aim-evaluation', (data) => {
  console.log('\n🎯 AIM Evaluation:');
  console.log(`  ${data.symbol}: ${data.passed ? '✅ PASSED' : '❌ FAILED'}`);
  if (data.passed) {
    console.log(`  Position: ${data.positionSize} SOL`);
    console.log(`  Confidence: ${(data.confidence * 100).toFixed(1)}%`);
  }
});

socket.on('scan-complete', (data) => {
  console.log(`\n🔍 Scan: ${data.symbol} (${data.category}) #${data.scanNumber}`);
});

socket.on('category-stats', (data) => {
  console.log('\n📈 Category Stats:');
  console.log('  Distribution:', data.distribution);
  console.log(`  AIM Tokens: ${data.aimTokensCount}`);
});

// Original events
socket.on('new-token', (data) => {
  console.log(`\n🆕 New Token: ${data.symbol} - ${data.category || 'NEW'}`);
});

socket.on('token-enriched', (data) => {
  console.log(`\n💎 Enriched: ${data.address.slice(0, 8)}... MC: ${data.marketCap}`);
});

socket.on('error', (error) => {
  console.error('WebSocket error:', error);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

// Keep running
process.stdin.resume();

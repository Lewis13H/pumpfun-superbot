// scripts/test-helius-api.ts
import axios from 'axios';
import { config } from '../src/config';
import { db } from '../src/database/postgres';

async function testHeliusApi() {
  console.log('=== Testing Helius API Directly ===\n');
  
  const token = await db('tokens')
    .whereBetween('market_cap', [35000, 105000])
    .first();
  
  if (!token) {
    console.log('No tokens found');
    return;
  }
  
  console.log(`Testing with ${token.symbol} (${token.address})\n`);
  
  // Extract API key from RPC URL
  const apiKey = config.apis.heliusRpcUrl.split('api-key=')[1];
  
  if (!apiKey) {
    console.log('No Helius API key found');
    return;
  }
  
  // Test token holders endpoint
  try {
    console.log('Testing Token Holders endpoint...');
    const response = await axios.post(
      `https://api.helius.xyz/v0/token-metadata`,
      {
        mintAccounts: [token.address],
        includeOffChain: true,
        disableCache: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        params: {
          'api-key': apiKey,
        },
      }
    );
    
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
  
  // Try alternative endpoint for holders
  try {
    console.log('\nTesting Token Accounts endpoint...');
    const response = await axios.post(
      `https://api.helius.xyz/v0/addresses/${token.address}/balances`,
      {},
      {
        params: {
          'api-key': apiKey,
        },
      }
    );
    
    console.log('Holders found:', response.data?.length || 0);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
  
  await db.destroy();
}

testHeliusApi();
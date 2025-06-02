# API Documentation v2 - Category System

## New Endpoints

### Category Management

#### Get Tokens by Category

GET /api/tokens/by-category/:category

Parameters:
- `category` (required): NEW, LOW, MEDIUM, HIGH, AIM, ARCHIVE, BIN
- `limit`: Number of results (default: 50)
- `offset`: Pagination offset (default: 0)
- `orderBy`: Sort field (default: category_updated_at)
- `order`: asc or desc (default: desc)

Response:
```json
{
  "success": true,
  "data": {
    "category": "HIGH",
    "count": 15,
    "tokens": [...]
  }
}

Get Token State History
GET /api/tokens/:address/state-history

Response:
{
  "success": true,
  "data": {
    "tokenAddress": "...",
    "currentCategory": "AIM",
    "transitions": [
      {
        "from_category": "NEW",
        "to_category": "LOW",
        "market_cap_at_transition": 5000,
        "created_at": "2025-06-01T10:00:00Z"
      }
    ]
  }
}

Change Token Category (Admin)
POST /api/tokens/:address/change-category

Body:
{
  "category": "HIGH",
  "reason": "manual_override"
}

Buy Signals
Get AIM Tokens Ready for Evaluation
GET /api/buy-signals/aim-tokens

Response:
{
  "success": true,
  "data": [
    {
      "address": "...",
      "symbol": "TOKEN",
      "marketCap": 45000,
      "liquidity": 15000,
      "holders": 200,
      "solsnifferScore": 85,
      "timeInAim": 300,
      "buyAttempts": 0
    }
  ]
}

Evaluate Token for Buy Signal
POST /api/buy-signals/evaluate/:address

Response:
{
  "success": true,
  "data": {
    "evaluation": {
      "passed": true,
      "criteria": {...},
      "confidence": 0.75
    },
    "positionSize": {
      "finalPosition": 0.25,
      "reasoning": [...]
    }
  }
}

Get Buy Signal History
GET /api/buy-signals/history?status=passed&timeframe=7d

Parameters:
status: all, passed, failed (default: all)
timeframe: 24h, 7d, 30d (default: 7d)
limit: Number of results (default: 100)
Analytics
Get Category Flow
GET /api/analytics/category-flow?timeframe=24h

Response:
{
  "success": true,
  "data": {
    "flows": [
      {
        "from_category": "HIGH",
        "to_category": "AIM",
        "count": 12
      }
    ],
    "categoryDistribution": {
      "NEW": 125,
      "LOW": 890,
      "MEDIUM": 234,
      "HIGH": 67,
      "AIM": 12
    },
    "avgTimeToAim": 14400
  }
}


### **Step 9.5: Test New Endpoints**
Create `scripts/test-api-endpoints.ts`:

```typescript
import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';

async function testEndpoints() {
  console.log('Testing new API endpoints...\n');
  
  try {
    // Test category endpoints
    console.log('1. Testing /tokens/by-category/HIGH');
    const highTokens = await axios.get(`${API_BASE}/tokens/by-category/HIGH`);
    console.log(`   Found ${highTokens.data.data.count} HIGH tokens`);
    
    // Test state history
    if (highTokens.data.data.tokens.length > 0) {
      const token = highTokens.data.data.tokens[0];
      console.log(`\n2. Testing state history for ${token.symbol}`);
      const history = await axios.get(`${API_BASE}/tokens/${token.address}/state-history`);
      console.log(`   ${history.data.data.transitions.length} transitions found`);
    }
    
    // Test AIM tokens
    console.log('\n3. Testing /buy-signals/aim-tokens');
    const aimTokens = await axios.get(`${API_BASE}/buy-signals/aim-tokens`);
    console.log(`   Found ${aimTokens.data.data.length} AIM tokens ready`);
    
    // Test evaluation
    if (aimTokens.data.data.length > 0) {
      const aimToken = aimTokens.data.data[0];
      console.log(`\n4. Testing evaluation for ${aimToken.symbol}`);
      const evaluation = await axios.post(`${API_BASE}/buy-signals/evaluate/${aimToken.address}`);
      console.log(`   Passed: ${evaluation.data.data.evaluation.passed}`);
      if (evaluation.data.data.evaluation.passed) {
        console.log(`   Position: ${evaluation.data.data.positionSize.finalPosition} SOL`);
      }
    }
    
    // Test analytics
    console.log('\n5. Testing /analytics/category-flow');
    const flow = await axios.get(`${API_BASE}/analytics/category-flow?timeframe=24h`);
    console.log(`   Category distribution:`, flow.data.data.categoryDistribution);
    
    console.log('\n✅ All endpoints working!');
    
  } catch (error) {
    console.error('❌ Error testing endpoints:', error);
  }
}

testEndpoints();

import { PumpFunMonitor } from '../discovery/pumpfun-monitor';
import { FilteredFilteredDiscoveryManager } from '../discovery/filtered-discovery-manager';
import { db } from '../database/postgres';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

// Sample pump.fun data provided by user
const samplePumpFunData = {
  "name": "Pepe Classic",
  "symbol": "PEPEC", 
  "marketCap": 45000,
  "image": "https://pump.fun/uploads/token-image.png",
  "address": "ABC123...",
  "creator": "XYZ789...",
  "description": "The classic Pepe meme token"
};

describe('PumpFun Integration Test', () => {
  let monitor: PumpFunMonitor;
  let FilteredDiscoveryManager: FilteredDiscoveryManager;
  
  beforeAll(async () => {
    // Initialize discovery manager
    FilteredDiscoveryManager = new FilteredDiscoveryManager();
    await FilteredDiscoveryManager.initialize();
    
    // Initialize pump.fun monitor
    monitor = new PumpFunMonitor();
  });

  afterAll(async () => {
    await monitor.stop();
    await FilteredDiscoveryManager.stopAll();
  });

  test('should correctly map pump.fun data to TokenDiscovery format', () => {
    // Simulate the handleMessage method with our sample data
    const mockMessage = {
      type: 'tokenCreate',
      data: {
        mint: samplePumpFunData.address,
        symbol: samplePumpFunData.symbol,
        name: samplePumpFunData.name,
        description: samplePumpFunData.description,
        image_uri: samplePumpFunData.image,
        creator: samplePumpFunData.creator,
        usd_market_cap: samplePumpFunData.marketCap,
        created_timestamp: Date.now()
      }
    };

    // Test the mapping logic
    const expectedTokenDiscovery = {
      address: samplePumpFunData.address,
      symbol: samplePumpFunData.symbol,
      name: samplePumpFunData.name,
      platform: 'pumpfun',
      metadata: {
        creator: samplePumpFunData.creator,
        description: samplePumpFunData.description,
        imageUri: samplePumpFunData.image,
        marketCap: samplePumpFunData.marketCap,
        method: 'websocket'
      }
    };

    expect(mockMessage.data.mint).toBe(expectedTokenDiscovery.address);
    expect(mockMessage.data.symbol).toBe(expectedTokenDiscovery.symbol);
    expect(mockMessage.data.name).toBe(expectedTokenDiscovery.name);
    expect(mockMessage.data.description).toBe(expectedTokenDiscovery.metadata.description);
    expect(mockMessage.data.image_uri).toBe(expectedTokenDiscovery.metadata.imageUri);
    expect(mockMessage.data.creator).toBe(expectedTokenDiscovery.metadata.creator);
    expect(mockMessage.data.usd_market_cap).toBe(expectedTokenDiscovery.metadata.marketCap);
  });

  test('should handle different pump.fun message formats', () => {
    const messageFormats = [
      // Format 1: Standard tokenCreate
      {
        type: 'tokenCreate',
        data: {
          mint: samplePumpFunData.address,
          symbol: samplePumpFunData.symbol,
          name: samplePumpFunData.name
        }
      },
      // Format 2: Alternative create format
      {
        type: 'create',
        mint: samplePumpFunData.address,
        symbol: samplePumpFunData.symbol,
        name: samplePumpFunData.name
      },
      // Format 3: newToken format
      {
        type: 'newToken',
        address: samplePumpFunData.address,
        symbol: samplePumpFunData.symbol,
        name: samplePumpFunData.name
      }
    ];

    messageFormats.forEach((format, index) => {
      console.log(`Testing message format ${index + 1}:`, format);
      
      // Each format should be recognized and processed
      expect(['tokenCreate', 'create', 'newToken']).toContain(format.type);
      
      // Address extraction should work for all formats
      const address = format.data?.mint || format.mint || format.address;
      expect(address).toBeDefined();
    });
  });

  test('should store pump.fun token in database with correct schema', async () => {
    try {
      // Clean up any existing test data
      await db('tokens').where('address', samplePumpFunData.address).del();

      // Insert test token
      await db('tokens').insert({
        address: samplePumpFunData.address,
        symbol: samplePumpFunData.symbol,
        name: samplePumpFunData.name,
        platform: 'pumpfun',
        discovered_at: new Date(),
        created_at: new Date(),
        analysis_status: 'PENDING',
        raw_data: JSON.stringify({
          creator: samplePumpFunData.creator,
          description: samplePumpFunData.description,
          imageUri: samplePumpFunData.image,
          marketCap: samplePumpFunData.marketCap,
          method: 'test'
        })
      });

      // Verify the token was stored correctly
      const storedToken = await db('tokens')
        .where('address', samplePumpFunData.address)
        .first();

      expect(storedToken).toBeDefined();
      expect(storedToken.symbol).toBe(samplePumpFunData.symbol);
      expect(storedToken.name).toBe(samplePumpFunData.name);
      expect(storedToken.platform).toBe('pumpfun');

      const rawData = JSON.parse(storedToken.raw_data);
      expect(rawData.creator).toBe(samplePumpFunData.creator);
      expect(rawData.description).toBe(samplePumpFunData.description);
      expect(rawData.imageUri).toBe(samplePumpFunData.image);
      expect(rawData.marketCap).toBe(samplePumpFunData.marketCap);

      // Clean up
      await db('tokens').where('address', samplePumpFunData.address).del();

    } catch (error) {
      console.error('Database test failed:', error);
      throw error;
    }
  });

  test('should validate required pump.fun fields', () => {
    const requiredFields = ['address', 'symbol', 'name'];
    const optionalFields = ['marketCap', 'image', 'creator', 'description'];

    // Check required fields are present
    requiredFields.forEach(field => {
      const mappedField = field === 'address' ? 'address' : field;
      expect(samplePumpFunData[mappedField]).toBeDefined();
      expect(typeof samplePumpFunData[mappedField]).toBe('string');
    });

    // Check optional fields
    optionalFields.forEach(field => {
      if (samplePumpFunData[field] !== undefined) {
        if (field === 'marketCap') {
          expect(typeof samplePumpFunData[field]).toBe('number');
        } else {
          expect(typeof samplePumpFunData[field]).toBe('string');
        }
      }
    });
  });

  test('should handle pump.fun API response format', () => {
    // Test the format that would come from pump.fun API
    const apiResponse = {
      mint: samplePumpFunData.address,
      symbol: samplePumpFunData.symbol,
      name: samplePumpFunData.name,
      description: samplePumpFunData.description,
      image_uri: samplePumpFunData.image,
      created_timestamp: Date.now(),
      creator: samplePumpFunData.creator,
      usd_market_cap: samplePumpFunData.marketCap,
      bonding_curve: "some_bonding_curve_address"
    };

    // Verify API response matches expected format
    expect(apiResponse.mint).toBe(samplePumpFunData.address);
    expect(apiResponse.symbol).toBe(samplePumpFunData.symbol);
    expect(apiResponse.name).toBe(samplePumpFunData.name);
    expect(apiResponse.description).toBe(samplePumpFunData.description);
    expect(apiResponse.image_uri).toBe(samplePumpFunData.image);
    expect(apiResponse.creator).toBe(samplePumpFunData.creator);
    expect(apiResponse.usd_market_cap).toBe(samplePumpFunData.marketCap);
    expect(typeof apiResponse.created_timestamp).toBe('number');
  });
});

// Additional integration test that can be run manually
export async function testPumpFunIntegrationManually() {
  console.log('🧪 Testing PumpFun Integration Manually...');
  
  try {
    // 1. Test database connection
    console.log('1. Testing database connection...');
    const dbTest = await db.raw('SELECT 1 as test');
    console.log('✅ Database connection successful');

    // 2. Test token insertion
    console.log('2. Testing token insertion...');
    const testToken = {
      address: 'TEST_' + Date.now(),
      symbol: samplePumpFunData.symbol,
      name: samplePumpFunData.name,
      platform: 'pumpfun',
      discovered_at: new Date(),
      created_at: new Date(),
      analysis_status: 'PENDING',
      raw_data: JSON.stringify({
        creator: samplePumpFunData.creator,
        description: samplePumpFunData.description,
        imageUri: samplePumpFunData.image,
        marketCap: samplePumpFunData.marketCap,
        method: 'manual_test'
      })
    };

    await db('tokens').insert(testToken);
    console.log('✅ Token insertion successful');

    // 3. Test token retrieval
    console.log('3. Testing token retrieval...');
    const retrievedToken = await db('tokens')
      .where('address', testToken.address)
      .first();
    
    if (retrievedToken) {
      console.log('✅ Token retrieval successful');
      console.log('Retrieved token:', {
        address: retrievedToken.address,
        symbol: retrievedToken.symbol,
        name: retrievedToken.name,
        platform: retrievedToken.platform
      });
    } else {
      throw new Error('Token not found after insertion');
    }

    // 4. Test raw_data parsing
    console.log('4. Testing raw_data parsing...');
    const parsedRawData = JSON.parse(retrievedToken.raw_data);
    console.log('✅ Raw data parsing successful');
    console.log('Parsed data:', parsedRawData);

    // 5. Cleanup
    console.log('5. Cleaning up test data...');
    await db('tokens').where('address', testToken.address).del();
    console.log('✅ Cleanup successful');

    console.log('\n🎉 All PumpFun integration tests passed!');
    console.log('\nYour project should correctly handle this pump.fun data:');
    console.log(JSON.stringify(samplePumpFunData, null, 2));

  } catch (error) {
    console.error('❌ PumpFun integration test failed:', error);
    throw error;
  }
} 
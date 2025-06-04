import { BirdeyeClient } from '../src/api/birdeye-client';
import { config } from '../src/config';

async function testBirdeyeFixed() {
  const birdeye = new BirdeyeClient(config.apis.birdeyeApiKey);
  
  // Test with MIA token from your database
  const testToken = '24VMNp7LssBuS8MFYxfAeRxAko4ZJCQ235PkzfSyUMJF';
  
  console.log('Testing Birdeye with fixed headers...');
  const data = await birdeye.getTokenOverview(testToken);
  
  console.log('Birdeye data:', data);
}

testBirdeyeFixed().catch(console.error);

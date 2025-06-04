import axios from 'axios';

async function testBirdeyeApiKey() {
  const apiKey = process.env.BIRDEYE_API_KEY || '1d42dacd43734c578f1ff8ecfb08269e';
  
  console.log('Testing Birdeye API key:', apiKey.substring(0, 10) + '...');
  
  try {
    // Test with SOL token
    const response = await axios.get('https://public-api.birdeye.so/defi/token_overview', {
      params: { address: 'So11111111111111111111111111111111111111112' },
      headers: {
        'Accept': 'application/json',
        'X-API-KEY': apiKey  // Try X-API-KEY instead of Authorization Bearer
      }
    });
    
    console.log('Success! API Key is valid');
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('API Key test failed:', error.response?.status, error.response?.data);
    
    // Try with different header format
    console.log('\nTrying alternative header format...');
    try {
      const response2 = await axios.get('https://public-api.birdeye.so/defi/token_overview', {
        params: { address: 'So11111111111111111111111111111111111111112' },
        headers: {
          'Accept': 'application/json',
          'x-api-key': apiKey  // lowercase
        }
      });
      console.log('Success with lowercase header!');
      console.log('Response:', JSON.stringify(response2.data, null, 2));
    } catch (error2: any) {
      console.error('Both formats failed');
    }
  }
}

testBirdeyeApiKey();

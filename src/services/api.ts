import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// API service methods
export const apiService = {
  // Health check
  getHealth: () => api.get('/health'),
  
  // Discovery stats
  getDiscoveryStats: () => api.get('/discovery/stats'),
  
  // Tokens
  getTokens: (params?: any) => api.get('/api/tokens', { params }),
  getTokenDetails: (address: string) => api.get(`/api/tokens/${address}`),
  
  // Market metrics
  getMarketMetrics: () => api.get('/api/market/metrics'),
  
  // API info
  getApiInfo: () => api.get('/api'),
};

export default apiService;
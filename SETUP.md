# Memecoin Discovery System - Setup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- QuestDB (optional, for time-series data)

### 1. Install Dependencies

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd dashboard
npm install
cd ..
```

### 2. Environment Setup

Create a `.env` file in the root directory:

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/memecoin_db
QUESTDB_HOST=localhost
QUESTDB_PORT=9009

# API Keys (optional for basic functionality)
SOLSNIFFER_API_KEY=your_key_here
BIRDEYE_API_KEY=your_key_here
MORALIS_API_KEY=your_key_here
HELIUS_API_KEY=your_key_here

# Server
PORT=3000
NODE_ENV=development
```

### 3. Database Setup

```bash
# Create database tables (if not already created)
npm run db:check
```

### 4. Start the System

#### Option A: Start Both Services Together
```bash
npm run dev:full
```

#### Option B: Start Services Separately
```bash
# Terminal 1 - Backend
npm run dev

# Terminal 2 - Frontend
cd dashboard
npm start
```

## 📡 API Endpoints

The backend provides the following endpoints:

### Core Endpoints
- `GET /health` - Health check
- `GET /api/discovery/stats` - Discovery statistics
- `GET /api/tokens/live` - Live token feed
- `GET /api/tokens/:address` - Token details

### Monitoring
- `GET /api/monitor/status` - API service status
- `GET /api/monitor/cost-history` - Cost tracking
- `GET /api/monitor/errors` - Error logs

### Market Data
- `GET /api/market/metrics` - Market overview
- `GET /api/market/trends` - Market trends

### Signals
- `GET /api/signals/history` - Signal history
- `GET /api/signals/stats` - Signal statistics
- `GET /api/signals/profit-history` - Profit tracking

### Settings
- `GET /api/settings` - Get settings
- `PUT /api/settings` - Update settings

## 🧪 Testing

Test API endpoints:
```bash
node test-api-endpoints.js
```

## 🔧 Fixed Issues

1. **Discovery Stats Endpoint**: Added `/api/discovery/stats` endpoint that was missing
2. **API Endpoints**: Fixed frontend to use correct backend endpoints (`/api/tokens/live`)
3. **WebSocket Connection**: Fixed WebSocket URL to use `http://` instead of `ws://`
4. **Data Format**: Aligned backend response format with frontend expectations
5. **Route Structure**: Ensured all routes are properly mounted and accessible

## 🌐 Access Points

- **Frontend Dashboard**: http://localhost:3001
- **Backend API**: http://localhost:3000
- **API Health**: http://localhost:3000/health
- **Discovery Stats**: http://localhost:3000/api/discovery/stats

## 📊 Dashboard Features

- **Live Token Feed**: Real-time token discovery
- **Discovery Analytics**: Charts and statistics
- **API Monitor**: Service status and cost tracking
- **Signal History**: Trading signals and performance
- **Settings**: Configuration management

## 🔍 Troubleshooting

### Backend Issues
- Check database connection
- Verify environment variables
- Check logs for errors

### Frontend Issues
- Ensure backend is running on port 3000
- Check browser console for errors
- Verify API endpoints are accessible

### WebSocket Issues
- Check if Socket.IO is properly connected
- Verify CORS settings
- Check network connectivity

## 🛠 Development

### Backend Structure
```
src/
├── api/           # Express routes and controllers
├── discovery/     # Token discovery services
├── analysis/      # Token analysis logic
├── database/      # Database connections
└── utils/         # Utilities and helpers
```

### Frontend Structure
```
dashboard/src/
├── components/    # React components
├── services/      # API and WebSocket services
├── contexts/      # React contexts
└── types/         # TypeScript types
``` 
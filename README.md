# Pumpfun Superbot

Real-time Solana token monitoring and trading system with sub-100ms latency using Shyft Yellowstone gRPC and TimescaleDB.

## Features
- Real-time gRPC streaming from Shyft Yellowstone
- PostgreSQL + TimescaleDB for time-series data
- Helius metadata enrichment
- Automated buy signal detection
- Category-based token tracking

## Installation
```bash
cd C:\Users\lewis\OneDrive\Documents\1_Code\pumpfun-superbot
npm install

npm run grpc:start  # Start the gRPC streaming bot
npm run dashboard:v428  # Start the dashboard
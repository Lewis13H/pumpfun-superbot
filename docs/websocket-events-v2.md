# WebSocket Events v2 - Category System

## Connection

```javascript
const socket = io('http://localhost:3000');

// Subscribe to channels
socket.emit('subscribe', ['categories', 'buy-signals', 'category-stats']);

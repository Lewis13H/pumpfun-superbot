// src/grpc/grpc-bridge.js
const YellowstoneGrpc = require('@triton-one/yellowstone-grpc');
const Client = YellowstoneGrpc.default;

class GrpcBridge {
  constructor(endpoint, token) {
    this.client = new Client(
      endpoint,
      token,
      {
        'grpc.max_receive_message_length': 64 * 1024 * 1024,
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1
      }
    );
  }

  async subscribe() {
    return await this.client.subscribe();
  }
  
  async subscribeOnce(accounts, slots, transactions, transactionsStatus, entry, blocks, blocksMeta, commitment, accountsDataSlice) {
    return await this.client.subscribeOnce(
      accounts,
      slots,
      transactions,
      transactionsStatus,
      entry,
      blocks,
      blocksMeta,
      commitment,
      accountsDataSlice
    );
  }
}

module.exports = { GrpcBridge };
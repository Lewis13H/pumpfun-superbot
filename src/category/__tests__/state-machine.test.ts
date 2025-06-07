import { interpret, State } from 'xstate';
import { createTokenStateMachine, TokenContext, TokenEvent } from '../state-machines';
import { categoryConfig } from '../../config/category-config';

describe('Token State Machine', () => {
  const testAddress = 'TEST123...';
  let service: ReturnType<typeof interpret>;

  beforeEach(() => {
    const machine = createTokenStateMachine(testAddress);
    service = interpret(machine).start();
  });

  afterEach(() => {
    service.stop();
  });

  test('starts in NEW state', () => {
    expect(service.state.value).toBe('NEW');
  });

  test('transitions from NEW to LOW with low market cap', (done) => {
    service.onTransition((state: State<TokenContext>) => {
      if (state.value === 'LOW') {
        expect(state.context.currentMarketCap).toBe(5000);
        done();
      }
    });
    
    service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 5000 });
  });

  test('transitions from NEW to AIM with high market cap', (done) => {
    service.onTransition((state: State<TokenContext>) => {
      if (state.value === 'AIM') {
        expect(state.context.currentMarketCap).toBe(40000);
        done();
      }
    });
    
    service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 40000 });
  });

  test('increments scan count', () => {
    expect(service.state.context.scanCount).toBe(0);
    
    service.send({ type: 'SCAN_COMPLETE' });
    expect(service.state.context.scanCount).toBe(1);
    
    service.send({ type: 'SCAN_COMPLETE' });
    expect(service.state.context.scanCount).toBe(2);
  });

  test('transitions to ARCHIVE after max scans in LOW', () => {
    // Move to LOW
    service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 5000 });
    expect(service.state.value).toBe('LOW');
    
    // Send max scans
    const maxScans = categoryConfig.scanIntervals.LOW.maxScans;
    for (let i = 0; i < maxScans; i++) {
      service.send({ type: 'SCAN_COMPLETE' });
    }
    
    expect(service.state.value).toBe('ARCHIVE');
  });
});


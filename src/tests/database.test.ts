import { testConnection } from '../database/postgres';

describe('Database Connections', () => {
  test('PostgreSQL connection should work', async () => {
    const result = await testConnection();
    expect(result).toBe(true);
  });
});
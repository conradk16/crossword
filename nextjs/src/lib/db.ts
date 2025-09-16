import { Pool, PoolClient, type QueryResultRow } from 'pg';

// Expect DATABASE_URL like: postgres://user:pass@host:port/dbname
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not defined.');
}

// Reuse pool across hot reloads in dev
const globalForPool = globalThis as unknown as { _pgPool?: Pool };

export const pool: Pool = globalForPool._pgPool || new Pool({ connectionString });
if (!globalForPool._pgPool) {
  globalForPool._pgPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[] }> {
  const result = params
    ? await pool.query<T>(text, params as any[])
    : await pool.query<T>(text);
  return { rows: result.rows };
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

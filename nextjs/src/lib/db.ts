import { Pool, PoolClient, type QueryResultRow } from 'pg';

// Reuse pool across hot reloads in dev/build
const globalForPool = globalThis as unknown as { _pgPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool._pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not defined.');
    }
    globalForPool._pgPool = new Pool({ connectionString });
  }
  return globalForPool._pgPool as Pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[] }> {
  const pool = getPool();
  const result = params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await pool.query<T>(text, params as any[])
    : await pool.query<T>(text);
  return { rows: result.rows };
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
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

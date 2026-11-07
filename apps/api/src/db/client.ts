import 'dotenv/config';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

export const pool = mysql.createPool({
  uri: url,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: ['DATE'],
  timezone: '+08:00',
});

export const db = drizzle(pool, { schema, mode: 'default' });
export { schema };
// @ts-nocheck
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

let client;

export async function getClient() {
  if (!client) {
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();

    // Crear tabla stores
    await client.query(
      "CREATE TABLE IF NOT EXISTS stores (" +
        "store_id TEXT PRIMARY KEY, " +
        "access_token TEXT, " +
        "created_at BIGINT" +
      ")"
    );

    // Crear tabla checkouts
    await client.query(
      "CREATE TABLE IF NOT EXISTS checkouts (" +
        "checkout_id TEXT PRIMARY KEY, " +
        "store_id TEXT REFERENCES stores(store_id), " +
        "cart_url TEXT, " +
        "status TEXT DEFAULT 'pending', " +
        "created_at BIGINT, " +
        "check_after BIGINT, " +
        "processed_at BIGINT" +
      ")"
    );
  }
  return client;
}
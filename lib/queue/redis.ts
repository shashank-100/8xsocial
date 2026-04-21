import { Redis } from "ioredis"

let _connection: Redis | null = null

export function getConnection(): Redis {
  if (!_connection) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set")
    _connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  }
  return _connection
}

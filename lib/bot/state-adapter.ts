import type { StateAdapter, Lock, QueueEntry } from "chat"
import { randomUUID } from "crypto"

interface Entry {
  value: unknown
  expiresAt: number | null
}

/**
 * In-memory StateAdapter backed by a Map with TTL support.
 *
 * Safe for single-process deployments (local dev, single-instance servers).
 * TODO: For production multi-instance deployments, replace with:
 *   import { createRedisState } from "@chat-adapter/state-redis"
 *   state: createRedisState({ url: process.env.REDIS_URL })
 */
export class MemoryStateAdapter implements StateAdapter {
  private store = new Map<string, Entry>()
  private locks = new Map<string, { token: string; expiresAt: number }>()
  private lists = new Map<string, { items: unknown[]; expiresAt: number | null }>()
  private queues = new Map<string, QueueEntry[]>()
  private subscriptions = new Set<string>()

  async connect() {}
  async disconnect() {}

  private isExpired(expiresAt: number | null): boolean {
    return expiresAt !== null && Date.now() > expiresAt
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry || this.isExpired(entry.expiresAt)) return null
    return entry.value as T
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    const existing = this.store.get(key)
    if (existing && !this.isExpired(existing.expiresAt)) return false
    await this.set(key, value, ttlMs)
    return true
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const existing = this.locks.get(threadId)
    if (existing && !this.isExpired(existing.expiresAt)) return null
    const token = randomUUID()
    const expiresAt = Date.now() + ttlMs
    this.locks.set(threadId, { token, expiresAt })
    return { threadId, token, expiresAt }
  }

  async releaseLock(lock: Lock): Promise<void> {
    const existing = this.locks.get(lock.threadId)
    if (existing?.token === lock.token) this.locks.delete(lock.threadId)
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(lock.threadId)
    if (!existing || existing.token !== lock.token) return false
    existing.expiresAt = Date.now() + ttlMs
    return true
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.locks.delete(threadId)
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    const existing = this.lists.get(key) ?? { items: [], expiresAt: null }
    existing.items.push(value)
    if (options?.maxLength && existing.items.length > options.maxLength) {
      existing.items = existing.items.slice(-options.maxLength)
    }
    if (options?.ttlMs) existing.expiresAt = Date.now() + options.ttlMs
    this.lists.set(key, existing)
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const entry = this.lists.get(key)
    if (!entry) return []
    if (this.isExpired(entry.expiresAt)) {
      this.lists.delete(key)
      return []
    }
    return entry.items as T[]
  }

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    const queue = this.queues.get(threadId) ?? []
    queue.push(entry)
    const trimmed = queue.length > maxSize ? queue.slice(-maxSize) : queue
    this.queues.set(threadId, trimmed)
    return trimmed.length
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    const queue = this.queues.get(threadId)
    if (!queue || queue.length === 0) return null
    const entry = queue.shift()!
    this.queues.set(threadId, queue)
    return entry
  }

  async queueDepth(threadId: string): Promise<number> {
    return this.queues.get(threadId)?.length ?? 0
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return this.subscriptions.has(threadId)
  }

  async subscribe(threadId: string): Promise<void> {
    this.subscriptions.add(threadId)
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.subscriptions.delete(threadId)
  }
}

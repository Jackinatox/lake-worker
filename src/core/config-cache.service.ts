import { Injectable, Logger } from '@nestjs/common';
import { CONFIG_KEY_DELETE_GAMESERVER_AFTER_DAYS } from '../lib/GlobalConsstants';
import { PrismaService } from './prisma.service';

/** How long a cached value stays fresh before the next DB read. */
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  value: T;
  fetchedAt: number; // Date.now()
}

@Injectable()
export class ConfigCacheService {
  private readonly logger = new Logger(ConfigCacheService.name);

  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs: number = DEFAULT_TTL_MS;

  constructor(private readonly prisma: PrismaService) {}

  // ─── Named accessors ──────────────────────────────────────────────────────

  async getDeleteGameserverAfterDays(): Promise<number> {
    return this.getNumber(CONFIG_KEY_DELETE_GAMESERVER_AFTER_DAYS, 90);
  }

  // ─── Generic typed helpers ────────────────────────────────────────────────

  async getNumber(key: string, fallback: number): Promise<number> {
    if (this.isFresh(key)) return this.cache.get(key)!.value as number;

    const row = await this.fetchRow(key);
    const value =
      row?.type === 'NUMBER' && row.number != null ? row.number : fallback;

    this.set(key, value);
    return value;
  }

  async getString(key: string, fallback: string): Promise<string> {
    if (this.isFresh(key)) return this.cache.get(key)!.value as string;

    const row = await this.fetchRow(key);
    const value =
      (row?.type === 'STRING' || row?.type === 'TEXT') && row.string != null
        ? row.string
        : fallback;

    this.set(key, value);
    return value;
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    if (this.isFresh(key)) return this.cache.get(key)!.value as boolean;

    const row = await this.fetchRow(key);
    const value =
      row?.type === 'BOOLEAN' && row.boolean != null ? row.boolean : fallback;

    this.set(key, value);
    return value;
  }

  /** Explicitly drop a key from the cache (e.g. after an admin update). */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.logger.debug(`Cache invalidated for key "${key}"`);
  }

  /** Drop all cached values. */
  invalidateAll(): void {
    this.cache.clear();
    this.logger.debug('Full config cache invalidated');
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private isFresh(key: string): boolean {
    const entry = this.cache.get(key);
    return !!entry && Date.now() - entry.fetchedAt < this.ttlMs;
  }

  private set(key: string, value: unknown): void {
    this.cache.set(key, { value, fetchedAt: Date.now() });
  }

  private async fetchRow(key: string) {
    try {
      return await this.prisma.keyValue.findUnique({ where: { key } });
    } catch (err) {
      this.logger.error(
        `Failed to fetch config key "${key}" from DB – using fallback`,
        err,
      );
      return null;
    }
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { ZodType } from 'zod';
import { getErrorMessage } from '../../utils/error.utils';

export type RedisCacheKey = string;

/**
 * Default time-to-live applied when a caller does not pass one and
 * `REDIS_TTL_SECONDS` is not configured.
 */
const FALLBACK_TTL_SECONDS = 3600;

/** Prefix prepended to every key so several apps can share one Redis instance. */
const FALLBACK_KEY_PREFIX = 'dj-nounoune';

/** Number of keys asked for per SCAN round-trip in {@link RedisCacheService.deleteByPattern}. */
const SCAN_BATCH_SIZE = 250;

/**
 * How long to wait for the socket (and, over `rediss://`, the TLS handshake)
 * before giving up on a connection attempt.
 *
 * Without this, node-redis waits on the OS TCP timeout — a TLS handshake
 * against a plaintext port stalls for minutes rather than failing.
 */
const FALLBACK_CONNECT_TIMEOUT_MS = 2000;

/**
 * How long the cache stays marked unavailable after a failed connection.
 *
 * Auto-reconnect is disabled in favour of this: node-redis's default strategy
 * retries forever with backoff, which turns every `get` into a hang instead of
 * a fast miss when the server is down or misconfigured.
 */
const RECONNECT_COOLDOWN_MS = 30_000;

/**
 * Thin wrapper around a Redis server used as a key/value cache.
 *
 * Two deliberate behaviours:
 *
 * - **Optional.** When `REDIS_URL` (or `REDIS_HOST`) is absent the service stays
 *   disabled and every method is a no-op — `get` returns `null`, `set` returns
 *   `false`. The app boots and runs without Redis, exactly like
 *   `OpensearchService` does without a node.
 * - **Never fatal.** A cache is an optimisation, so connection and command
 *   failures are logged and swallowed rather than thrown. Callers treat a
 *   `null` read as a miss and recompute.
 *
 * Values are stored as JSON. Reads come back as `unknown` and are parsed with a
 * Zod schema at the boundary, because what is in Redis was written by a
 * previous deploy and may no longer match the current type.
 */
@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly keyPrefix: string;
  private readonly defaultTtlSeconds: number;
  private readonly connectTimeoutMs: number;

  /** Connection string, or `null` when Redis is not configured. */
  private readonly url: string | null;

  private client: RedisClientType | null = null;

  /** In-flight connection attempt, so concurrent callers share one dial. */
  private connecting: Promise<boolean> | null = null;

  /** Epoch ms before which connection attempts are skipped. See {@link RECONNECT_COOLDOWN_MS}. */
  private cooldownUntil = 0;

  /** Why the last dial failed, so {@link ping} can report the cause rather than just "unreachable". */
  private lastConnectError: string | null = null;

  constructor(private readonly configService: ConfigService) {
    this.keyPrefix = this.configService.get<string>('REDIS_KEY_PREFIX') || FALLBACK_KEY_PREFIX;
    this.defaultTtlSeconds = Number(this.configService.get<string>('REDIS_TTL_SECONDS')) || FALLBACK_TTL_SECONDS;
    this.connectTimeoutMs = Number(this.configService.get<string>('REDIS_CONNECT_TIMEOUT_MS')) || FALLBACK_CONNECT_TIMEOUT_MS;

    this.url = this.buildUrl();
    if (!this.url) {
      // onModuleInit owns the user-facing "disabled" warning; this is just for
      // CLI runs, which skip that probe.
      this.logger.debug('REDIS_URL (or REDIS_HOST) is not defined, Redis cache is disabled');
    }
  }

  /**
   * Reports cache availability once at boot.
   *
   * The cache itself connects lazily, which means a misconfigured or down Redis
   * would otherwise stay invisible until the first cache read silently missed.
   * This probe makes the state explicit in the startup log.
   *
   * Skipped under `IS_CLI`, so a one-shot command keeps the lazy behaviour and
   * does not pay the dial cost when it never touches the cache.
   */
  public async onModuleInit(): Promise<void> {
    if (process.env.IS_CLI === 'true') return;

    if (!this.url) {
      this.logger.warn('Redis cache DISABLED — REDIS_URL (or REDIS_HOST) is not set, all cache calls will no-op');
      return;
    }

    const started = Date.now();
    const { ok, error } = await this.ping();

    if (ok) {
      this.logger.log(
        `Redis cache CONNECTED at ${this.safeUrl()} in ${Date.now() - started}ms ` +
          `(key prefix "${this.keyPrefix}", default TTL ${this.defaultTtlSeconds}s)`,
      );
      return;
    }

    this.logger.warn(`Redis cache UNAVAILABLE at ${this.safeUrl()} — reads will miss and writes will be dropped: ${error}`);
  }

  /** Whether a Redis server was configured at all. */
  public isEnabled(): boolean {
    return this.url !== null;
  }

  /**
   * Opens a connection and issues a PING.
   *
   * Unlike the cache methods this reports the failure reason instead of
   * swallowing it, so a health check or CLI command can show what is wrong.
   *
   * @returns `ok: true` on a successful PING, otherwise the error message
   */
  public async ping(): Promise<{ ok: boolean; error?: string }> {
    if (!this.url) return { ok: false, error: 'Redis is not configured' };

    const client = await this.connect();
    if (!client) return { ok: false, error: this.lastConnectError ?? 'Could not connect to Redis' };

    try {
      await client.ping();
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, error: getErrorMessage(error) };
    }
  }

  /**
   * Reads a key and validates it against a Zod schema.
   *
   * @param key - Unprefixed cache key
   * @param schema - Schema the stored value must satisfy
   * @returns The parsed value, or `null` on a miss, a disabled cache, unreadable JSON, or a schema mismatch
   */
  public async get<T>(key: string, schema: ZodType<T>): Promise<T | null>;
  /**
   * Reads a key without validation.
   *
   * @param key - Unprefixed cache key
   * @returns The parsed JSON as `unknown`, or `null` on a miss
   */
  public async get(key: string): Promise<unknown>;
  public async get<T>(key: string, schema?: ZodType<T>): Promise<unknown> {
    const client = await this.connect();
    if (!client) return null;

    let raw: string | null;
    try {
      raw = await client.get(this.namespaced(key));
    } catch (error: unknown) {
      this.logger.warn(`Failed to read cache key "${key}": ${getErrorMessage(error)}`);
      return null;
    }

    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: unknown) {
      this.logger.warn(`Cache key "${key}" holds invalid JSON, treating as a miss: ${getErrorMessage(error)}`);
      return null;
    }

    if (!schema) return parsed;

    const result = schema.safeParse(parsed);
    if (!result.success) {
      // A stale shape from an older deploy. Drop it so the next write is clean.
      this.logger.warn(`Cache key "${key}" does not match its schema, treating as a miss`);
      void this.delete(key);
      return null;
    }

    return result.data;
  }

  /**
   * Writes a JSON-serialisable value.
   *
   * @param key - Unprefixed cache key
   * @param value - Value to store; must survive a `JSON.stringify` round-trip
   * @param ttlSeconds - Expiry in seconds; defaults to `REDIS_TTL_SECONDS`. Pass `0` to persist without expiry.
   * @returns `true` when the value was stored
   */
  public async set(key: string, value: unknown, ttlSeconds: number = this.defaultTtlSeconds): Promise<boolean> {
    const client = await this.connect();
    if (!client) return false;

    let serialised: string;
    try {
      serialised = JSON.stringify(value);
    } catch (error: unknown) {
      this.logger.warn(`Value for cache key "${key}" is not serialisable: ${getErrorMessage(error)}`);
      return false;
    }

    // JSON.stringify(undefined) returns undefined, not a string.
    if (serialised === undefined) {
      this.logger.warn(`Refusing to cache "undefined" under key "${key}"`);
      return false;
    }

    try {
      await client.set(this.namespaced(key), serialised, ttlSeconds > 0 ? { expiration: { type: 'EX', value: Math.floor(ttlSeconds) } } : undefined);
      return true;
    } catch (error: unknown) {
      this.logger.warn(`Failed to write cache key "${key}": ${getErrorMessage(error)}`);
      return false;
    }
  }

  /**
   * Atomically increments a counter, creating it at 1 with `ttlSeconds` when it did not exist.
   *
   * Stored as a plain integer, not JSON, so it cannot be read back through {@link get}.
   *
   * @param key - Unprefixed cache key
   * @param ttlSeconds - Expiry applied only when the key is created; defaults to `REDIS_TTL_SECONDS`. Pass `0` for none.
   * @returns The new value, or `null` when Redis is disabled or the command failed
   */
  public async increment(key: string, ttlSeconds: number = this.defaultTtlSeconds): Promise<number | null> {
    const client = await this.connect();
    if (!client) return null;

    const namespaced = this.namespaced(key);
    try {
      const value = await client.incr(namespaced);
      if (value === 1 && ttlSeconds > 0) {
        await client.expire(namespaced, Math.floor(ttlSeconds));
      }
      return value;
    } catch (error: unknown) {
      this.logger.warn(`Failed to increment cache key "${key}": ${getErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * Returns the cached value, or computes it, stores it and returns it on a miss.
   *
   * The factory runs outside the cache's error handling — if it throws, the
   * error propagates to the caller and nothing is written.
   *
   * @param key - Unprefixed cache key
   * @param schema - Schema the stored value must satisfy
   * @param factory - Produces the value when the cache misses
   * @param ttlSeconds - Expiry in seconds; defaults to `REDIS_TTL_SECONDS`
   */
  public async getOrSet<T>(key: string, schema: ZodType<T>, factory: () => Promise<T>, ttlSeconds: number = this.defaultTtlSeconds): Promise<T> {
    const cached = await this.get(key, schema);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Deletes a single key.
   *
   * @param key - Unprefixed cache key
   * @returns `true` when a key was actually removed
   */
  public async delete(key: string): Promise<boolean> {
    const client = await this.connect();
    if (!client) return false;

    try {
      return (await client.del(this.namespaced(key))) > 0;
    } catch (error: unknown) {
      this.logger.warn(`Failed to delete cache key "${key}": ${getErrorMessage(error)}`);
      return false;
    }
  }

  /**
   * Deletes every key matching a glob pattern, scoped to this service's prefix.
   *
   * Uses SCAN rather than KEYS so a large keyspace does not block the server.
   *
   * @param pattern - Glob applied after the prefix, e.g. `profile:*`. Defaults to everything under the prefix.
   * @returns Number of keys removed
   */
  public async deleteByPattern(pattern = '*'): Promise<number> {
    const client = await this.connect();
    if (!client) return 0;

    let removed = 0;
    try {
      for await (const keys of client.scanIterator({
        MATCH: this.namespaced(pattern),
        COUNT: SCAN_BATCH_SIZE,
      })) {
        if (keys.length === 0) continue;
        removed += await client.del(keys);
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to delete cache keys matching "${pattern}": ${getErrorMessage(error)}`);
    }

    return removed;
  }

  /**
   * @param key - Unprefixed cache key
   * @returns `true` when the key exists and has not expired
   */
  public async has(key: string): Promise<boolean> {
    const client = await this.connect();
    if (!client) return false;

    try {
      return (await client.exists(this.namespaced(key))) > 0;
    } catch (error: unknown) {
      this.logger.warn(`Failed to check cache key "${key}": ${getErrorMessage(error)}`);
      return false;
    }
  }

  /**
   * @param key - Unprefixed cache key
   * @returns Remaining seconds, `-1` when the key has no expiry, or `null` when it is missing
   */
  public async ttl(key: string): Promise<number | null> {
    const client = await this.connect();
    if (!client) return null;

    try {
      const remaining = await client.ttl(this.namespaced(key));
      return remaining === -2 ? null : remaining;
    } catch (error: unknown) {
      this.logger.warn(`Failed to read TTL of cache key "${key}": ${getErrorMessage(error)}`);
      return null;
    }
  }

  public async onModuleDestroy(): Promise<void> {
    if (!this.client?.isOpen) return;

    try {
      await this.client.close();
    } catch (error: unknown) {
      this.logger.warn(`Failed to close Redis connection: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Connects on first use rather than on module init, so a CLI invocation that
   * never touches the cache never opens a socket.
   *
   * A failed attempt puts the cache in a cooldown during which callers get
   * `null` immediately. That is the difference between a degraded cache and a
   * degraded app: without it, an unreachable server makes every `get` wait out
   * the full connect timeout.
   *
   * @returns The connected client, or `null` when Redis is disabled, cooling down, or unreachable
   */
  private async connect(): Promise<RedisClientType | null> {
    if (!this.url) return null;
    if (this.client?.isReady) return this.client;
    if (this.connecting) return (await this.connecting) ? this.client : null;
    if (Date.now() < this.cooldownUntil) return null;

    // A client that failed or was closed cannot be revived — dial a fresh one.
    this.client = this.createClient(this.url);

    this.connecting = this.client
      .connect()
      .then(() => {
        // The authoritative startup line comes from onModuleInit; this only
        // fires again on a reconnect after a cooldown.
        this.logger.debug(`Connected to Redis at ${this.safeUrl()}`);
        this.lastConnectError = null;
        return true;
      })
      .catch((error: unknown) => {
        this.lastConnectError = getErrorMessage(error);
        this.logger.warn(`Redis unreachable at ${this.safeUrl()}, cache disabled for ${RECONNECT_COOLDOWN_MS / 1000}s: ${this.lastConnectError}`);
        this.cooldownUntil = Date.now() + RECONNECT_COOLDOWN_MS;
        this.discard();
        return false;
      })
      .finally(() => {
        this.connecting = null;
      });

    return (await this.connecting) ? this.client : null;
  }

  /**
   * Builds a client that fails fast.
   *
   * `reconnectStrategy: false` is deliberate — node-redis retries forever by
   * default, which would leave commands queued against a dead socket instead of
   * returning a miss. Reconnection is handled by {@link connect} on the next
   * call after the cooldown.
   */
  private createClient(url: string): RedisClientType {
    const client = createClient({
      url,
      socket: {
        connectTimeout: this.connectTimeoutMs,
        reconnectStrategy: false,
      },
    }) as RedisClientType;

    // node-redis emits 'error' on the client itself (socket drops, auth
    // failures). A listener is mandatory: without one Node treats it as an
    // unhandled 'error' event and kills the process.
    //
    // Logged at debug because it duplicates what connect() and the command
    // methods already report with context — at warn level a single bad
    // password prints the same line three times at startup.
    client.on('error', (error: unknown) => {
      this.logger.debug(`Redis client error: ${getErrorMessage(error)}`);
    });

    return client;
  }

  /**
   * Drops the current client.
   *
   * `destroy()` throws synchronously when the socket is already closed — which
   * is precisely the state a failed connect leaves it in — so the call is
   * guarded. An error here must never escape: it would turn a cache outage into
   * a request failure.
   */
  private discard(): void {
    const client = this.client;
    this.client = null;
    if (!client) return;

    try {
      client.destroy();
    } catch {
      // Already closed. Nothing to release.
    }
  }

  /** The connection string with any password stripped, safe to log. */
  private safeUrl(): string {
    if (!this.url) return '(not configured)';
    try {
      const parsed = new URL(this.url);
      if (parsed.password) parsed.password = '***';
      return parsed.toString();
    } catch {
      return '(unparseable REDIS_URL)';
    }
  }

  private namespaced(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  /**
   * Resolves the connection string from `REDIS_URL`, or assembles one from the
   * discrete `REDIS_HOST`/`REDIS_PORT`/credentials variables.
   *
   * @returns A `redis://` URL, or `null` when nothing is configured
   */
  private buildUrl(): string | null {
    const url = this.configService.get<string>('REDIS_URL');
    if (url) return url;

    const host = this.configService.get<string>('REDIS_HOST');
    if (!host) return null;

    const port = this.configService.get<string>('REDIS_PORT') || '6379';
    const username = this.configService.get<string>('REDIS_USERNAME') || '';
    const password = this.configService.get<string>('REDIS_PASSWORD') || '';
    const database = this.configService.get<string>('REDIS_DB') || '0';
    const scheme = this.configService.get<string>('REDIS_TLS') === 'true' ? 'rediss' : 'redis';

    const credentials = password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';

    return `${scheme}://${credentials}${host}:${port}/${database}`;
  }
}

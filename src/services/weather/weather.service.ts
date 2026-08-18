import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getErrorMessage } from '../../utils/error.utils';
import { OpenMeteoForecast, OpenMeteoForecastSchema, WeatherDay, WeatherSnapshot } from './weather.interfaces';

/** Open-Meteo's free tier needs no key and asks for restraint rather than enforcing a quota. */
const API_URL = 'https://api.open-meteo.com/v1/forecast';

/** How long a snapshot is served before the upstream is asked again. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Today plus four, which is as many as the header strip has room to draw. */
const FORECAST_DAYS = 5;

/** Where the display is when the environment does not say. */
const DEFAULT_LATITUDE = 45.5019;
const DEFAULT_LONGITUDE = -73.5674;

const REQUEST_TIMEOUT_MS = 8000;

/**
 * Weather behind the public display. One upstream, no key, and a single cached snapshot shared by
 * every viewer: the page polls this every ten minutes, and a television left on for a week would
 * otherwise be a few thousand calls a day to somebody's free service.
 *
 * The snapshot carries sunrise and sunset alongside the conditions, because the page paints its
 * background from the sun cycle and this is the only thing it talks to that knows where it is.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  private readonly latitude: number;
  private readonly longitude: number;
  private readonly enabled: boolean;

  /** Last good answer. Deliberately kept past its expiry — see {@link getSnapshot}. */
  private cached: { snapshot: WeatherSnapshot; fetchedAt: number } | null = null;

  /** In flight request, so a burst of viewers reloading at once still makes one call. */
  private pending: Promise<WeatherSnapshot | null> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.latitude = this.readCoordinate('VIBING_LATITUDE', DEFAULT_LATITUDE);
    this.longitude = this.readCoordinate('VIBING_LONGITUDE', DEFAULT_LONGITUDE);
    this.enabled = this.configService.get<string>('VIBING_WEATHER_ENABLED') !== 'false';
  }

  /**
   * The cached snapshot, refreshed once it has aged out.
   *
   * A failed refresh answers with the stale snapshot rather than nothing: the display runs
   * unattended, and an hour old temperature beats an empty header — the sun cycle in particular only
   * needs sunrise and sunset, which barely move from one day to the next.
   */
  async getSnapshot(): Promise<WeatherSnapshot | null> {
    if (!this.enabled) return null;

    if (this.cached && Date.now() - this.cached.fetchedAt < CACHE_TTL_MS) {
      return this.cached.snapshot;
    }

    if (!this.pending) {
      this.pending = this.refresh().finally(() => {
        this.pending = null;
      });
    }

    const refreshed = await this.pending;

    return refreshed ?? this.cached?.snapshot ?? null;
  }

  private async refresh(): Promise<WeatherSnapshot | null> {
    try {
      const forecast = await this.request();
      const snapshot = this.toSnapshot(forecast);

      this.cached = { snapshot, fetchedAt: Date.now() };
      this.logger.log(
        `Weather refreshed for ${snapshot.latitude},${snapshot.longitude} (${snapshot.timezone}): ` +
          `${snapshot.temperatureC}C, code ${snapshot.code}`,
      );

      return snapshot;
    } catch (error) {
      this.logger.warn(`Weather refresh failed: ${getErrorMessage(error)}`);
      return null;
    }
  }

  private async request(): Promise<OpenMeteoForecast> {
    const url = new URL(API_URL);

    url.searchParams.set('latitude', String(this.latitude));
    url.searchParams.set('longitude', String(this.longitude));
    url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day');
    url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', String(FORECAST_DAYS));

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo answered ${response.status} ${response.statusText}`);
    }

    const payload: unknown = await response.json();
    const parsed = OpenMeteoForecastSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(`Open-Meteo payload did not match the schema: ${parsed.error.message}`);
    }

    return parsed.data;
  }

  private toSnapshot(forecast: OpenMeteoForecast): WeatherSnapshot {
    const offset = forecast.utc_offset_seconds;
    const daily = forecast.daily;

    const days: WeatherDay[] = daily.time.map((date, index) => ({
      date,
      weekday: weekdayOf(date),
      code: daily.weather_code[index] ?? 0,
      maxC: roundOrNull(daily.temperature_2m_max[index]),
      minC: roundOrNull(daily.temperature_2m_min[index]),
      precipitationChance: daily.precipitation_probability_max[index] ?? null,
      sunrise: toEpochMs(daily.sunrise[index], offset),
      sunset: toEpochMs(daily.sunset[index], offset),
    }));

    return {
      latitude: forecast.latitude,
      longitude: forecast.longitude,
      timezone: forecast.timezone,
      observedAt: toEpochMs(forecast.current.time, offset),
      temperatureC: Math.round(forecast.current.temperature_2m),
      feelsLikeC: Math.round(forecast.current.apparent_temperature),
      humidity: Math.round(forecast.current.relative_humidity_2m),
      windKph: Math.round(forecast.current.wind_speed_10m),
      code: forecast.current.weather_code,
      isDay: forecast.current.is_day === 1,
      days,
    };
  }

  private readCoordinate(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (!raw) return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.logger.warn(`${key}="${raw}" is not a number, falling back to ${fallback}`);
      return fallback;
    }

    return value;
  }
}

/**
 * A naive local ISO string back to a real instant. `Date.parse` would read it as the *server's*
 * local time, which is only right by accident, so the offset the upstream reported is applied by
 * hand against UTC instead.
 */
function toEpochMs(localIso: string | undefined, utcOffsetSeconds: number): number {
  if (!localIso) return 0;

  // `2026-08-19T06:12` — Open-Meteo leaves the seconds off, and that is not a shape every engine
  // parses once a Z is stuck on the end.
  const complete = localIso.length === 16 ? `${localIso}:00` : localIso;
  const parsed = Date.parse(`${complete}Z`);

  return Number.isNaN(parsed) ? 0 : parsed - utcOffsetSeconds * 1000;
}

/** `2026-08-19` to `wed`. Read as UTC so the server's own timezone cannot shift the day. */
function weekdayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) return '';

  return parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toLowerCase();
}

function roundOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' ? Math.round(value) : null;
}

import { z } from 'zod';

/**
 * The slice of the Open-Meteo forecast response this project asks for. Times come back as naive
 * local ISO strings ( `2026-08-19T06:12` ) because the request carries `timezone=auto`, which is why
 * `utc_offset_seconds` is read as well: it is the only way back to a real instant.
 */
export const OpenMeteoForecastSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  utc_offset_seconds: z.number(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    relative_humidity_2m: z.number(),
    wind_speed_10m: z.number(),
    weather_code: z.number(),
    is_day: z.number(),
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
    sunrise: z.array(z.string()),
    sunset: z.array(z.string()),
  }),
});

export type OpenMeteoForecast = z.infer<typeof OpenMeteoForecastSchema>;

/** One forecast day, already reduced to what the display draws. */
export interface WeatherDay {
  /** `yyyy-mm-dd` at the observed location, not at the browser. */
  date: string;
  /** Short lowercase English name, rendered as is by the page. */
  weekday: string;
  /** WMO weather interpretation code. The icon and the wording are chosen from it client side. */
  code: number;
  minC: number | null;
  maxC: number | null;
  /** Percent, or null when the upstream has no figure for that day. */
  precipitationChance: number | null;
  /** Epoch milliseconds, so the page never has to know the location's timezone. */
  sunrise: number;
  sunset: number;
}

/**
 * What `GET /vibing-on/weather` answers with. Every instant is epoch milliseconds and every
 * temperature is Celsius, so the page can render without a timezone or a unit table of its own.
 */
export interface WeatherSnapshot {
  latitude: number;
  longitude: number;
  timezone: string;
  observedAt: number;
  temperatureC: number;
  feelsLikeC: number;
  humidity: number;
  windKph: number;
  code: number;
  isDay: boolean;
  /** Today first, then the days after it. */
  days: WeatherDay[];
}

import { LogLevel } from '@nestjs/common';


export function getLogLevels(): LogLevel[] {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (level === 'debug') return ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
  if (level === 'warn') return ['fatal', 'error', 'warn'];
  if (level === 'error') return ['fatal', 'error'];
  // Default: 'info' and up
  return ['fatal', 'error', 'warn', 'log'];
}

import { ConsoleLogger, Injectable } from '@nestjs/common';

@Injectable()
export class LogService extends ConsoleLogger {
  /**
   * Customise the 'log' method (standard info logs)
   */
  log(message: any, context?: string) {
    // Example: Add a custom prefix or modify the message
    const customMessage = `[Custom] ${message}`;

    // Call the parent implementation to print to console
    super.log(customMessage, context);
  }

  dir(message: any, context?: string) {
    // Call the parent implementation to print to console
    console.dir(message);
  }
  /**
   * Customise the 'error' method
   */
  error(message: any, stack?: string, context?: string) {
    // Example: Send critical errors to an external service here
    // e.g., sendToSentry(message, stack);

    super.error(message, stack, context);
  }

  /**
   * You can also override warn, debug, and verbose similarly
   */
  warn(message: any, context?: string) {
    super.warn(message, context);
  }
}

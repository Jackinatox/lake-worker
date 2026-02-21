import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { createLogger, format, transports, Logger } from 'winston';
import LokiTransport from 'winston-loki';
import { trace, context } from '@opentelemetry/api';

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: Logger;

  constructor() {
    // Format that adds trace context to logs
    const traceFormat = format((info) => {
      const span = trace.getSpan(context.active());
      if (span) {
        const spanContext = span.spanContext();
        info.trace_id = spanContext.traceId;
        info.span_id = spanContext.spanId;
        info.trace_flags = spanContext.traceFlags;
      }
      return info;
    });

    this.logger = createLogger({
      level: 'info',
      format: format.combine(
        traceFormat(),
        format.timestamp(),
        format.errors({ stack: true }),
        format.json(),
      ),
      defaultMeta: { service: 'NEST-LAKE-WORKER' },
      transports: [
        // Console transport for development
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.printf(
              ({ timestamp, level, message, trace_id, span_id, ...meta }) => {
                let msg = `${String(timestamp)} [${String(level)}] ${String(message)}`;
                if (trace_id && typeof trace_id === 'string') {
                  msg += ` [trace_id=${trace_id}] [span_id=${String(span_id)}]`;
                }
                if (Object.keys(meta).length > 0) {
                  msg += ` ${JSON.stringify(meta)}`;
                }
                return msg;
              },
            ),
          ),
        }),
        // Loki transport
        new LokiTransport({
          host: 'http://10.7.10.1:3100',
          labels: {
            service_name: 'nest-lake-worker',
            job: 'nest-lake-worker',
            environment: 'development',
          },
          json: true,
          format: format.json(),
          replaceTimestamp: true,
          onConnectionError: (err) =>
            console.error('Loki connection error:', err),
        }),
      ],
    });
  }

  log(message: string, context?: Record<string, unknown>) {
    this.logger.info(message, context);
  }

  error(message: string, context?: Record<string, unknown>) {
    this.logger.error(message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.logger.warn(message, context);
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.logger.debug(message, context);
  }

  verbose(message: string, context?: Record<string, unknown>) {
    this.logger.verbose(message, context);
  }

  // Additional method for structured logging
  logWithContext(level: string, message: string, context?: any) {
    this.logger.log(level, message, context);
  }
}

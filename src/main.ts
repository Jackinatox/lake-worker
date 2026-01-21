import './tracing';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { LoggerService } from './core/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use our custom logger
  const logger = app.get(LoggerService);
  app.useLogger(logger);

  logger.log('Application starting...');

  // Enable validation globally - validates all incoming request bodies
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties from request body
      forbidNonWhitelisted: true, // Throw error if unknown properties sent
      transform: true, // Auto-transform JSON to DTO class instances
    }),
  );

  app.enableVersioning({
    defaultVersion: '1',
    type: VersioningType.URI,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application is running on port ${port}`);
}
void bootstrap();

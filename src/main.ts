import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable validation globally - validates all incoming request bodies
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties from request body
      forbidNonWhitelisted: true, // Throw error if unknown properties sent
      transform: true, // Auto-transform JSON to DTO class instances
    }),
  );

  await app.listen(process.env.PORT ?? 3002);
}
void bootstrap();

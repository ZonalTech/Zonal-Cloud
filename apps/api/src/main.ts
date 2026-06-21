import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  // rawBody lets the GitHub webhook handler verify the HMAC signature against
  // the exact bytes GitHub signed (req.rawBody), not a re-serialized body.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Behind nginx/another reverse proxy: trust X-Forwarded-* so req.ip is the
  // real client address (used for audit logging) rather than the proxy's.
  app.set('trust proxy', true);

  app.setGlobalPrefix('v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const corsOrigins = (
    process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Zonal Cloud API running on http://localhost:${port}/v1`);
}

bootstrap();

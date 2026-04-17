import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({ origin: '*', credentials: true });

  const port = process.env.GATEWAY_PORT || 3000;
  await app.listen(port);

  console.log(`🚀 API Gateway running on http://localhost:${port}`);
  console.log(`📖 Swagger docs: http://localhost:${port}/docs`);
}

bootstrap();

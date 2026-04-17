import { NestFactory } from '@nestjs/core';
import { EventServiceModule } from './event-service.module';

async function bootstrap() {
  const app = await NestFactory.create(EventServiceModule, { logger: ['log', 'error', 'warn'] });
  const port = process.env.EVENT_SERVICE_PORT || 3002;
  await app.listen(port);
  console.log(`🏆 Event Service running on http://localhost:${port}`);
}
bootstrap();

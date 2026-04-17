import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { ChatServiceModule } from './chat-service.module';
import { CHAT_PACKAGE } from '@app/common/constants';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ChatServiceModule,
    {
      transport: Transport.GRPC,
      options: {
        package: CHAT_PACKAGE,
        protoPath: join(process.cwd(), 'libs/proto/src/chat.proto'),
        url: process.env.CHAT_SERVICE_URL || '0.0.0.0:50051',
        loader: { keepCase: true, longs: Number, enums: Number, defaults: true, oneofs: true },
      },
    },
  );
  await app.listen();
  console.log('💬 Chat Service (gRPC) running on port 50051');
}
bootstrap();

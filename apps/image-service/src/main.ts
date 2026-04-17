import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { ImageServiceModule } from './image-service.module';
import { IMAGE_PACKAGE } from '@app/common/constants';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ImageServiceModule,
    {
      transport: Transport.GRPC,
      options: {
        package: IMAGE_PACKAGE,
        protoPath: join(process.cwd(), 'libs/proto/src/image.proto'),
        url: process.env.IMAGE_SERVICE_URL || '0.0.0.0:50052',
      },
    },
  );
  await app.listen();
  console.log('🖼️  Image Service (gRPC) running on port 50052');
}
bootstrap();

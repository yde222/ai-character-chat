import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { DatabaseModule } from '@app/database';
import { CHAT_PACKAGE, IMAGE_PACKAGE, CHAT_SERVICE, IMAGE_MATCHING_SERVICE } from '@app/common/constants';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ChatGateway } from './gateways/chat.gateway';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    DatabaseModule,

    ClientsModule.registerAsync([
      {
        name: CHAT_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: CHAT_PACKAGE,
            protoPath: join(process.cwd(), 'libs/proto/src/chat.proto'),
            url: config.get('CHAT_SERVICE_URL', 'localhost:50051'),
            loader: { keepCase: true, longs: Number, enums: Number, defaults: true, oneofs: true },
          },
        }),
      },
      {
        name: IMAGE_MATCHING_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: IMAGE_PACKAGE,
            protoPath: join(process.cwd(), 'libs/proto/src/image.proto'),
            url: config.get('IMAGE_SERVICE_URL', 'localhost:50052'),
            loader: { keepCase: true, longs: Number, enums: Number, defaults: true, oneofs: true },
          },
        }),
      },
    ]),

    AuthModule,
    HealthModule,
  ],
  providers: [ChatGateway],
})
export class AppModule {}

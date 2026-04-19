import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  UserEntity,
  CharacterEntity,
  ChatSessionEntity,
  ChatMessageEntity,
  AttendanceEntity,
  BadgeEntity,
  UserBadgeEntity,
  ImageAssetEntity,
  UserAffinityEntity,
  SubscriptionEntity,
  DailyUsageEntity,
  DailyMissionEntity,
  UserPersonaEntity,
} from './entities';

const entities = [
  UserEntity,
  CharacterEntity,
  ChatSessionEntity,
  ChatMessageEntity,
  AttendanceEntity,
  BadgeEntity,
  UserBadgeEntity,
  ImageAssetEntity,
  UserAffinityEntity,
  SubscriptionEntity,
  DailyUsageEntity,
  DailyMissionEntity,
  UserPersonaEntity,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbType = config.get<string>('DB_TYPE');

        // PostgreSQL 모드 — DB_TYPE=postgres 설정 시
        if (dbType === 'postgres') {
          return {
            type: 'postgres',
            host: config.get('DB_HOST', 'localhost'),
            port: config.get<number>('DB_PORT', 5432),
            username: config.get('DB_USERNAME', 'aichat'),
            password: config.get('DB_PASSWORD', 'aichat_dev'),
            database: config.get('DB_DATABASE', 'ai_character_chat'),
            entities,
            synchronize: config.get('NODE_ENV') !== 'production', // 프로덕션에서는 migration 사용
            logging: config.get('DB_LOGGING') === 'true',
            // 커넥션 풀 — 동시 접속 처리
            extra: {
              max: config.get<number>('DB_POOL_SIZE', 10),
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 5000,
            },
          };
        }

        // 개발 환경 기본값: sql.js (WASM SQLite — 네이티브 빌드 불필요)
        return {
          type: 'sqljs' as any,
          entities,
          synchronize: true,
          logging: false,
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}

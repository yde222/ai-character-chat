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
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // 개발 환경: sql.js (WASM SQLite — 네이티브 빌드 불필요)
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

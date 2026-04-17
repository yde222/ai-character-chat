import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MatchingModule } from './modules/matching/matching.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MatchingModule,
  ],
})
export class ImageServiceModule {}

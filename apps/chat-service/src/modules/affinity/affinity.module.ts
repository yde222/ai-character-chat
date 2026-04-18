import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAffinityEntity } from '@app/database/entities';
import { AffinityService } from './affinity.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserAffinityEntity])],
  providers: [AffinityService],
  exports: [AffinityService],
})
export class AffinityModule {}

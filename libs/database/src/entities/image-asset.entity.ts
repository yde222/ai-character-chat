import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { CharacterEntity } from './character.entity';

/**
 * Image Asset Entity
 *
 * DB에 메타데이터만 저장, 실제 파일은 S3 + CloudFront
 *
 * Redis 캐시 전략:
 * - 앱 시작 시 전체 로드 → Redis SET/HASH
 * - 에셋 추가/삭제 시 캐시 무효화
 * - 매칭 서비스는 Redis만 조회 (DB 직접 조회 없음)
 */
@Entity('image_assets')
@Index(['characterId', 'emotion'])
export class ImageAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  characterId: string;

  @Column()
  emotion: number;

  @Column()
  cdnUrl: string;

  @Column({ default: 'image' })
  assetType: 'image' | 'gif' | 'animation';

  // 행동 태그 (JSON 배열: ["웃는", "손흔드는"])
  @Column({ type: 'simple-json', default: '[]' })
  actionTags: string[];

  // 매칭 우선도 (높을수록 자주 선택됨)
  @Column({ type: 'float', default: 1.0 })
  weight: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => CharacterEntity, (char) => char.assets)
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;
}

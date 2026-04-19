import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ChatSessionEntity } from './chat-session.entity';
import { ImageAssetEntity } from './image-asset.entity';

/**
 * Character Entity — AI 캐릭터 정의
 *
 * Phase 1: 운영팀이 직접 등록 (5~10개 캐릭터)
 * Phase 3: 유저 생성 캐릭터 (creatorId 필드 활성화)
 */
@Entity('characters')
export class CharacterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  systemPrompt: string;

  @Column({ type: 'text' })
  personality: string;

  @Column({ type: 'text', nullable: true })
  backgroundStory: string;

  @Column({ nullable: true })
  speechStyle: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ nullable: true })
  coverImageUrl: string;

  // ============================================================
  // 11순위 추가: 스토리 모드 + 프로필 강화 (Whif.io 벤치마크)
  // ============================================================

  // 프롤로그 — 채팅 시작 전 보여주는 도입부 서술
  @Column({ type: 'text', nullable: true })
  prologue: string;

  // 캐릭터 소개 (시놉시스 형태)
  @Column({ type: 'text', nullable: true })
  introduction: string;

  // 추천 페르소나 (JSON 배열)
  // 예: ["거짓 연인을 연기하는 유저", "은결이에게 서서히 콜드는 유저"]
  @Column({ type: 'simple-json', nullable: true })
  recommendedPersonas: string[];

  // 추천 플레이 시나리오 (JSON 배열)
  // 예: ["예쁘게 하고 외출해서 은결이 질투 유발하기", "진실이 들통난 후 고백"]
  @Column({ type: 'simple-json', nullable: true })
  recommendedPlays: string[];

  // 작가 코멘트
  @Column({ type: 'text', nullable: true })
  authorComment: string;

  // 장르 태그 (JSON 배열)
  // 예: ["현대물", "집착공", "HL", "미남공"]
  @Column({ type: 'simple-json', nullable: true })
  tags: string[];

  // 내러티브 모드 지원 여부
  @Column({ default: false })
  supportsNarrativeMode: boolean;

  // 감정 표현 가중치 (JSON)
  @Column({ type: 'simple-json', default: '{}' })
  emotionWeights: Record<string, number>;

  // 공개 여부
  @Column({ default: true })
  isPublic: boolean;

  // 프리미엄 전용 여부
  @Column({ default: false })
  isPremium: boolean;

  // Phase 3: 유저 생성 캐릭터
  @Column({ nullable: true })
  creatorId: string;

  // 인기도 (정렬/추천용)
  @Column({ default: 0 })
  totalSessions: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ChatSessionEntity, (session) => session.character)
  sessions: ChatSessionEntity[];

  @OneToMany(() => ImageAssetEntity, (asset) => asset.character)
  assets: ImageAssetEntity[];
}

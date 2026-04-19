import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserEntity } from './user.entity';

/**
 * User Persona Entity — 유저가 캐릭터와 대화할 때 사용하는 "나"의 설정
 *
 * ============================================================
 * 경쟁사 벤치마크 (Whif.io):
 * - 이름, 성별, 나이, 직업, 외모, 성격, 체향 등 상세 설정
 * - 랜덤 생성 기능
 * - 캐릭터별로 다른 페르소나 사용 가능
 *
 * 설계 결정:
 * - User : Persona = 1 : N (여러 페르소나 생성 가능)
 * - 캐릭터와 직접 연결하지 않음 → 하나의 페르소나를 여러 캐릭터에 재사용
 * - settings 필드는 자유 텍스트 (LLM에 그대로 주입)
 *   → 유저가 직접 작성한 설정을 LLM이 해석하게 함
 *   → 구조화하면 오히려 표현력이 제한됨
 *
 * 비용 영향:
 * - 페르소나 설정 텍스트 ≈ 100~200 토큰
 * - 매 턴 시스템 프롬프트에 포함 → 총 토큰의 약 3%
 * - 품질 대비 무시 가능한 비용
 * ============================================================
 */
@Entity('user_personas')
export class UserPersonaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  // 페르소나 이름 (캐릭터가 부를 이름)
  @Column({ length: 20 })
  name: string;

  // 성별
  @Column({
    type: 'varchar',
    length: 10,
    default: 'unset',
  })
  gender: 'male' | 'female' | 'unset';

  // 자유 형식 설정 텍스트 — LLM에 그대로 주입
  // 예: "나이: 25\n직업: 대학생\n외모: 검은 머리, 차분한 인상\n성격: 내성적이지만 호기심 많음"
  @Column({ type: 'text', nullable: true })
  settings: string;

  // 프로필 아바타 (선택)
  @Column({ nullable: true })
  avatarUrl: string;

  // 기본 페르소나 여부 (유저당 하나만 기본값)
  @Column({ default: false })
  isDefault: boolean;

  // 마지막 사용 시간 (최근 사용 순 정렬)
  @Column({ nullable: true })
  lastUsedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

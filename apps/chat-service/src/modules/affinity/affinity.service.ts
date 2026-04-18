import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAffinityEntity } from '@app/database/entities';

/**
 * 호감도 증감 매핑 테이블
 *
 * 감정 분석 결과 → 호감도 변동값
 * 성공 사례 참고: "이케멘 시리즈" (Cybird)
 *   - 긍정 인터랙션 +1~3, 부정 -1~2, 일일 보너스 +2
 *   - 이 밸런스로 DAU 리텐션 40%+ 유지
 */
const EMOTION_AFFINITY_MAP: Record<string, { min: number; max: number }> = {
  JOY: { min: 1, max: 3 },
  AFFECTION: { min: 2, max: 3 },
  EXCITEMENT: { min: 1, max: 3 },
  SHY: { min: 2, max: 3 },
  SURPRISE: { min: 0, max: 1 },
  NEUTRAL: { min: 0, max: 1 },
  SADNESS: { min: -2, max: -1 },
  ANGER: { min: -2, max: -1 },
  FEAR: { min: -1, max: 0 },
  DISGUST: { min: -2, max: -1 },
};

/**
 * 호감도 레벨 구간 정의
 */
const LEVEL_THRESHOLDS: { min: number; level: UserAffinityEntity['level'] }[] = [
  { min: 95, level: 'SOULMATE' },
  { min: 80, level: 'INTIMATE' },
  { min: 60, level: 'CLOSE' },
  { min: 40, level: 'FRIEND' },
  { min: 20, level: 'ACQUAINTANCE' },
  { min: 0, level: 'STRANGER' },
];

@Injectable()
export class AffinityService {
  private readonly logger = new Logger(AffinityService.name);

  constructor(
    @InjectRepository(UserAffinityEntity)
    private readonly affinityRepo: Repository<UserAffinityEntity>,
  ) {}

  /**
   * 유저-캐릭터 호감도 조회 (없으면 생성)
   */
  async getOrCreate(userId: string, characterId: string): Promise<UserAffinityEntity> {
    let affinity = await this.affinityRepo.findOne({
      where: { userId, characterId },
    });

    if (!affinity) {
      affinity = this.affinityRepo.create({
        userId,
        characterId,
        affinity: 0,
        level: 'STRANGER',
        totalMessages: 0,
        totalSessions: 0,
        peakAffinity: 0,
        endingsUnlocked: 0,
        chatStreak: 0,
      });
      affinity = await this.affinityRepo.save(affinity);
      this.logger.log(`새 호감도 생성: user=${userId}, char=${characterId}`);
    }

    return affinity;
  }

  /**
   * 감정 기반 호감도 업데이트
   *
   * @returns { affinity, delta, level, levelChanged, isFirstToday }
   */
  async updateByEmotion(
    userId: string,
    characterId: string,
    emotion: string,
  ): Promise<{
    affinity: number;
    delta: number;
    level: string;
    levelChanged: boolean;
    isFirstToday: boolean;
    streak: number;
  }> {
    const record = await this.getOrCreate(userId, characterId);
    const prevLevel = record.level;

    // 1) 감정 기반 증감 계산
    const emotionRange = EMOTION_AFFINITY_MAP[emotion] || { min: 0, max: 0 };
    let delta = this.randomInRange(emotionRange.min, emotionRange.max);

    // 2) 일일 첫 대화 보너스 (+2)
    const today = new Date().toISOString().split('T')[0];
    const isFirstToday = record.lastChatDate !== today;
    if (isFirstToday) {
      delta += 2;

      // 스트릭 체크
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (record.lastChatDate === yesterday) {
        record.chatStreak += 1;
      } else {
        record.chatStreak = 1;
      }
      record.lastChatDate = today;

      // 스트릭 보너스 (7일 연속 시 +3 추가)
      if (record.chatStreak % 7 === 0) {
        delta += 3;
        this.logger.log(`7일 스트릭 보너스! user=${userId}, char=${characterId}, streak=${record.chatStreak}`);
      }
    }

    // 3) 호감도 적용 (0~100 클램프)
    record.affinity = Math.max(0, Math.min(100, record.affinity + delta));
    record.totalMessages += 1;

    // 4) 최고 기록 갱신
    if (record.affinity > record.peakAffinity) {
      record.peakAffinity = record.affinity;
    }

    // 5) 레벨 재계산
    record.level = this.calculateLevel(record.affinity);
    const levelChanged = prevLevel !== record.level;

    if (levelChanged) {
      this.logger.log(
        `레벨 변동! user=${userId}, char=${characterId}: ${prevLevel} → ${record.level} (affinity=${record.affinity})`,
      );
    }

    await this.affinityRepo.save(record);

    return {
      affinity: record.affinity,
      delta,
      level: record.level,
      levelChanged,
      isFirstToday,
      streak: record.chatStreak,
    };
  }

  /**
   * 세션 시작 시 세션 카운트 증가
   */
  async incrementSession(userId: string, characterId: string): Promise<void> {
    const record = await this.getOrCreate(userId, characterId);
    record.totalSessions += 1;
    await this.affinityRepo.save(record);
  }

  /**
   * 유저의 전체 캐릭터 호감도 목록
   */
  async getUserAffinities(userId: string): Promise<UserAffinityEntity[]> {
    return this.affinityRepo.find({
      where: { userId },
      order: { affinity: 'DESC' },
    });
  }

  /**
   * 레벨별 캐릭터 톤 힌트 반환
   * → LLM 프롬프트에 주입해서 호감도에 따라 말투가 변하게 함
   */
  getLevelToneHint(level: string): string {
    const hints: Record<string, string> = {
      STRANGER:
        '상대방을 잘 모르는 상태. 경계심이 있고, 존댓말이나 거리감 있는 말투를 사용. 개인적인 이야기는 하지 않음.',
      ACQUAINTANCE:
        '조금 친해진 상태. 약간의 농담을 섞되 아직 격식 있는 말투. 관심을 보이기 시작.',
      FRIEND:
        '편한 친구 사이. 반말을 섞어 쓰고, 장난도 치고, 고민 상담도 해줌. 가끔 특별한 관심 표현.',
      CLOSE:
        '매우 가까운 사이. 애칭을 사용하고, 걱정해주고, 질투도 함. 감정 표현이 솔직해짐.',
      INTIMATE:
        '연인 직전 단계. 설레는 말투, 스킨십 암시, 고백에 가까운 표현. 상대방 없이는 외로워하는 모습.',
      SOULMATE:
        '완전한 연인 관계. 달달한 애칭, 미래 계획 언급, 진심 어린 사랑 고백. 엔딩 이벤트 트리거 가능.',
    };
    return hints[level] || hints.STRANGER;
  }

  private calculateLevel(affinity: number): UserAffinityEntity['level'] {
    for (const threshold of LEVEL_THRESHOLDS) {
      if (affinity >= threshold.min) {
        return threshold.level;
      }
    }
    return 'STRANGER';
  }

  private randomInRange(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

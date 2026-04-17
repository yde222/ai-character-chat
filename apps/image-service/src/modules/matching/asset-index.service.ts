import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmotionTag } from '@app/common/constants';

/**
 * Asset Index Service — 에셋 인덱스 관리
 *
 * ============================================================
 * Redis 인덱스 구조 설계:
 *
 * Phase 1 (MVP): 인메모리 Map → 충분 (에셋 수백 개 수준)
 * Phase 2 (Scale): Redis로 전환
 *
 * Redis 키 설계:
 *
 * 1) 감정별 에셋 목록 (SET)
 *    Key: asset:idx:{characterId}:{emotion}
 *    Value: SET of assetId
 *    예: asset:idx:haru:JOY → {"asset_001", "asset_002", ...}
 *    조회: O(N) SMEMBERS 또는 O(1) SRANDMEMBER
 *
 * 2) 에셋 상세 정보 (HASH)
 *    Key: asset:cache:{assetId}
 *    Value: HASH { cdnUrl, assetType, emotion, actionTags, confidence }
 *    예: asset:cache:asset_001 → {cdnUrl: "https://cdn...", ...}
 *    조회: O(1) HGETALL
 *
 * 3) 캐릭터별 전체 에셋 (SET)
 *    Key: asset:all:{characterId}
 *    Value: SET of assetId
 *    용도: 관리/통계
 *
 * 성능:
 * - 매칭 1회: SMEMBERS + HGETALL × N → ~1~3ms
 * - 메모리: 에셋 1000개 × ~200bytes = ~200KB/캐릭터
 *
 * CDN 구조:
 * CloudFront → S3 (원본 에셋)
 * URL 패턴: https://cdn.example.com/assets/{characterId}/{emotion}/{assetId}.webp
 * WebP 포맷: PNG 대비 30~50% 용량 절감, 모든 모던 브라우저 지원
 * ============================================================
 */

interface AssetEntry {
  assetId: string;
  cdnUrl: string;
  assetType: 'image' | 'gif' | 'animation';
  emotion: EmotionTag;
  actionTags: string[];
  confidence: number;
}

@Injectable()
export class AssetIndexService implements OnModuleInit {
  private readonly logger = new Logger(AssetIndexService.name);

  // MVP: 인메모리 인덱스
  // Key: `${characterId}:${emotion}` → AssetEntry[]
  private emotionIndex = new Map<string, AssetEntry[]>();

  async onModuleInit() {
    // 초기 에셋 데이터 로드 (MVP: 하드코딩 시드 데이터)
    await this.loadSeedAssets();
    this.logger.log(`Asset index loaded: ${this.getTotalCount()} assets`);
  }

  /**
   * 감정별 에셋 조회
   */
  async getAssetsByEmotion(
    characterId: string,
    emotion: EmotionTag,
  ): Promise<AssetEntry[]> {
    const key = `${characterId}:${emotion}`;
    return this.emotionIndex.get(key) || [];
  }

  private getTotalCount(): number {
    let count = 0;
    this.emotionIndex.forEach((assets) => (count += assets.length));
    return count;
  }

  /**
   * 시드 데이터 — MVP 테스트용
   *
   * 실제 운영 시:
   * 1. 아티스트가 캐릭터별 에셋 제작 (감정 6종 × 10~20장 = 60~120장)
   * 2. 관리자 도구로 업로드 → S3 + CloudFront 자동 배포
   * 3. Redis 인덱스 자동 갱신
   *
   * 에셋 제작 가이드라인:
   * - 해상도: 512×512 (채팅 UI 최적화)
   * - 포맷: WebP (애니메이션은 WebP animated 또는 Lottie)
   * - 파일 크기: < 100KB (모바일 데이터 고려)
   * - 투명 배경: 필수 (다크/라이트 모드 대응)
   */
  private async loadSeedAssets(): Promise<void> {
    const CDN_BASE = 'https://cdn.example.com/assets';
    const CHARACTER = 'default';

    const seedData: Array<{
      emotion: EmotionTag;
      count: number;
      actionTags: string[];
    }> = [
      { emotion: EmotionTag.JOY, count: 5, actionTags: ['웃는', '손흔드는', '점프하는'] },
      { emotion: EmotionTag.SADNESS, count: 3, actionTags: ['우는', '고개숙이는', '앉아있는'] },
      { emotion: EmotionTag.ANGER, count: 3, actionTags: ['화내는', '팔짱낀', '뒤돌아선'] },
      { emotion: EmotionTag.SURPRISE, count: 3, actionTags: ['놀란', '입벌린', '눈큰'] },
      { emotion: EmotionTag.AFFECTION, count: 5, actionTags: ['하트', '볼빨간', '안기는'] },
      { emotion: EmotionTag.NEUTRAL, count: 4, actionTags: ['서있는', '앉아있는', '대기'] },
      { emotion: EmotionTag.EXCITEMENT, count: 3, actionTags: ['뛰는', '환호하는', '별빛'] },
      { emotion: EmotionTag.SHY, count: 3, actionTags: ['얼굴가리는', '볼빨간', '눈피하는'] },
      { emotion: EmotionTag.FEAR, count: 2, actionTags: ['떨리는', '숨는'] },
      { emotion: EmotionTag.DISGUST, count: 2, actionTags: ['인상쓰는', '고개돌리는'] },
    ];

    for (const seed of seedData) {
      const key = `${CHARACTER}:${seed.emotion}`;
      const assets: AssetEntry[] = [];

      for (let i = 0; i < seed.count; i++) {
        const emotionName = EmotionTag[seed.emotion].toLowerCase();
        const actionTag = seed.actionTags[i % seed.actionTags.length];

        assets.push({
          assetId: `${CHARACTER}_${emotionName}_${i.toString().padStart(3, '0')}`,
          cdnUrl: `${CDN_BASE}/${CHARACTER}/${emotionName}/${i.toString().padStart(3, '0')}.webp`,
          assetType: i % 3 === 0 ? 'gif' : 'image',
          emotion: seed.emotion,
          actionTags: [actionTag],
          confidence: 0.8 + Math.random() * 0.2,
        });
      }

      this.emotionIndex.set(key, assets);
    }
  }
}

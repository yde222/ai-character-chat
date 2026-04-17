import { Injectable, Logger } from '@nestjs/common';
import { EmotionTag } from '@app/common/constants';
import { IAssetMatch } from '@app/common/interfaces';
import { AssetIndexService } from './asset-index.service';

/**
 * Image Matching Service — 감정 기반 에셋 매칭 엔진
 *
 * ============================================================
 * 아키텍처:
 *
 * [Chat Service] → gRPC → [이 서비스] → Redis → CDN URL 반환
 *
 * 매칭 알고리즘:
 * 1. 감정 태그로 1차 필터링 (Redis SET 조회, O(1))
 * 2. 행동 힌트로 2차 필터링 (태그 교집합)
 * 3. 최근 사용 에셋 제외 (중복 방지)
 * 4. 랜덤 선택 (같은 감정이어도 다른 이미지 → 자연스러움)
 *
 * 성능 목표: P99 < 50ms
 * 근거: Redis 조회 ~1ms + 로직 ~2ms + 네트워크 ~10ms = ~13ms
 * 마진: 37ms (CDN 프리워밍, GC 스파이크 대응)
 *
 * 베이글챗 추정 구조와의 차이점:
 * - 베이글챗: 텍스트→감정 분석을 이미지 서비스에서 자체 수행 (추정)
 * - 이 설계: 감정 분석은 Chat Service(LLM)에서 이미 완료 → 이미지 서비스는 매칭만
 * - 장점: 이미지 서비스의 책임이 단순해지고, 장애 격리가 깔끔해짐
 *
 * 라이브 스트리밍 경험 적용:
 * - 썸네일 생성 파이프라인 → 에셋 사전 처리 파이프라인과 동일 구조
 * - CDN 프리워밍 전략 → 자주 사용되는 에셋을 엣지에 캐싱
 * ============================================================
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(private readonly assetIndex: AssetIndexService) {}

  /**
   * 이미지 매칭 실행
   */
  async matchImage(data: {
    character_id: string;
    emotion: number;
    action_hints: string[];
    recent_asset_ids: string[];
  }): Promise<any> {
    const emotion = data.emotion as EmotionTag;

    // 1차: 감정 태그로 후보 조회
    let candidates = await this.assetIndex.getAssetsByEmotion(
      data.character_id,
      emotion,
    );

    // 후보가 없으면 NEUTRAL로 폴백
    if (candidates.length === 0) {
      candidates = await this.assetIndex.getAssetsByEmotion(
        data.character_id,
        EmotionTag.NEUTRAL,
      );
    }

    // 2차: 행동 힌트로 필터링 (있으면)
    if (data.action_hints.length > 0) {
      const hintFiltered = candidates.filter((c) =>
        c.actionTags.some((tag) => data.action_hints.includes(tag)),
      );
      if (hintFiltered.length > 0) {
        candidates = hintFiltered;
      }
      // 힌트 매칭 실패 시 감정 매칭 결과 그대로 사용
    }

    // 3차: 최근 사용 에셋 제외
    if (data.recent_asset_ids.length > 0) {
      const recentSet = new Set(data.recent_asset_ids);
      const deduped = candidates.filter((c) => !recentSet.has(c.assetId));
      if (deduped.length > 0) {
        candidates = deduped;
      }
      // 모든 에셋이 최근 사용됐으면 그래도 하나는 반환
    }

    // 4차: 랜덤 선택
    const selected = candidates[Math.floor(Math.random() * candidates.length)];

    if (!selected) {
      this.logger.warn(
        `No asset found: character=${data.character_id}, emotion=${EmotionTag[emotion]}`,
      );
      return {
        asset_id: '',
        cdn_url: '',
        asset_type: 'image',
        emotion: EmotionTag.NEUTRAL,
        confidence: 0,
      };
    }

    return {
      asset_id: selected.assetId,
      cdn_url: selected.cdnUrl,
      asset_type: selected.assetType,
      emotion: selected.emotion,
      confidence: selected.confidence,
    };
  }

  async getCharacterAssets(data: {
    character_id: string;
    emotion_filter: number;
    limit: number;
  }) {
    const assets = await this.assetIndex.getAssetsByEmotion(
      data.character_id,
      data.emotion_filter as EmotionTag,
    );

    return {
      assets: assets.slice(0, data.limit || 50).map((a) => ({
        asset_id: a.assetId,
        cdn_url: a.cdnUrl,
        asset_type: a.assetType,
        emotion: a.emotion,
        action_tags: a.actionTags,
      })),
      total_count: assets.length,
    };
  }
}

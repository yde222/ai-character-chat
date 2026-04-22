# ============================================================
# NestJS 모노레포 멀티스테이지 Dockerfile
#
# 설계 원칙:
# 1. 멀티스테이지 빌드 → 프로덕션 이미지 80% 경량화
# 2. 하나의 Dockerfile, ARG로 서비스 선택 → 빌드 파이프라인 단순화
# 3. Alpine 기반 → 최종 이미지 ~150MB (vs Debian ~450MB)
#
# 성공 사례: Discord
# - NestJS는 아니지만 동일 원칙 적용
# - 멀티스테이지 + Alpine으로 배포 이미지 70% 축소 (출처: Discord Engineering Blog, 2023)
#
# 사용법:
#   docker build --build-arg SERVICE=api-gateway -t ai-romance/api-gateway .
#   docker build --build-arg SERVICE=chat-service -t ai-romance/chat-service .
# ============================================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# 의존성 캐시 레이어 분리 (소스 변경 시 재설치 방지)
COPY package.json package-lock.json* yarn.lock* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

ARG SERVICE=api-gateway

COPY package.json package-lock.json* yarn.lock* ./
RUN npm ci

# 캐시 버스팅 — 값 변경 시 이후 모든 레이어 재빌드
# Railway Docker 캐시가 소스 변경을 감지하지 못할 때 이 값을 증가시킬 것
ARG CACHEBUST=2

# 소스 복사 (node_modules는 위에서 설치됨)
COPY tsconfig.json nest-cli.json ./
COPY apps/ apps/
COPY libs/ libs/

# 특정 서비스 빌드
RUN npx nest build ${SERVICE}

# 빌드 출력 경로 확인 및 엔트리포인트 심볼릭 링크 생성
# libs/ 참조 유무에 따라 경로가 달라지므로 동적으로 찾음
RUN MAIN_JS=$(find dist -name "main.js" -path "*${SERVICE}*" | head -1) && \
    echo "Found entry point: ${MAIN_JS}" && \
    mkdir -p dist/entry && \
    ln -s /app/${MAIN_JS} dist/entry/main.js

# Stage 3: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

ARG SERVICE=api-gateway
ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE}

# 보안: non-root 유저
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# 프로덕션 의존성만 복사
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# proto 파일 복사 (gRPC 서비스에 필요)
COPY libs/proto/ libs/proto/

# 유저 전환
USER nestjs

# 헬스체크
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/health || exit 1

# 서비스별 포트 기본값
# api-gateway: 3000, chat-service: 50051, image-service: 50052, event-service: 50053
EXPOSE 3000 50051 50052 50053

# 서비스 실행 — 빌드 시 생성된 심볼릭 링크로 경로 고정
CMD node dist/entry/main.js


# ============================================================
# Multi-stage Dockerfile — 서비스별 빌드
#
# 사용법:
# docker build --build-arg SERVICE=chat-service -t chat-service .
#
# 이미지 크기 최적화:
# - Build stage: node:20-slim (빌드 도구 포함)
# - Run stage: node:20-alpine (최소 런타임)
# - 최종 이미지: ~150MB (node_modules 프로덕션만)
# ============================================================

# Build stage
FROM node:20-slim AS builder

ARG SERVICE

WORKDIR /app

# 의존성 설치 (캐시 레이어 활용)
COPY package*.json ./
RUN npm ci --ignore-scripts

# 소스 복사 + 빌드
COPY . .
RUN npm run build:${SERVICE}

# Production dependencies only
RUN npm ci --omit=dev --ignore-scripts

# Run stage
FROM node:20-alpine AS runner

ARG SERVICE

WORKDIR /app

# 보안: non-root 유저
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# 빌드 결과물 + 프로덕션 의존성만 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/proto/src/*.proto ./libs/proto/src/

USER appuser

# 헬스체크
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

CMD ["node", "dist/apps/${SERVICE}/main.js"]

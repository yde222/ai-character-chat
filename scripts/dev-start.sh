#!/bin/bash
# ============================================================
# AI Character Chat — 로컬 개발 원클릭 실행
#
# 사용법:
#   chmod +x scripts/dev-start.sh
#   ./scripts/dev-start.sh
#
# DB 모드:
#   DB_TYPE=postgres (.env) → Docker PostgreSQL 자동 기동
#   DB_TYPE 미설정         → sql.js 인메모리 (Docker 불필요)
# ============================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 AI Character Chat — 로컬 개발 환경 시작"
echo "================================================"

# ── .env 로드 ────────────────────────────────────────────
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)
else
  echo "⚠️  .env 파일이 없습니다."
  echo "   cp .env.example .env 후 API 키를 설정하세요."
fi

# ── Docker PostgreSQL 자동 기동 ──────────────────────────
if [ "$DB_TYPE" = "postgres" ]; then
  echo ""
  echo "🐘 Step 0: Docker PostgreSQL 기동"

  if ! command -v docker &> /dev/null; then
    echo "   ❌ Docker가 설치되어 있지 않습니다."
    echo "   DB_TYPE=postgres를 사용하려면 Docker Desktop을 설치하세요."
    exit 1
  fi

  # PostgreSQL 컨테이너가 이미 실행 중인지 확인
  if docker ps --format '{{.Names}}' | grep -q 'ai-chat-postgres'; then
    echo "   ✅ PostgreSQL 이미 실행 중 (ai-chat-postgres)"
  else
    echo "   PostgreSQL 컨테이너 시작..."
    docker run -d \
      --name ai-chat-postgres \
      -e POSTGRES_USER=${DB_USERNAME:-aichat} \
      -e POSTGRES_PASSWORD=${DB_PASSWORD:-aichat_dev} \
      -e POSTGRES_DB=${DB_DATABASE:-ai_character_chat} \
      -p ${DB_PORT:-5432}:5432 \
      -v ai-chat-pgdata:/var/lib/postgresql/data \
      postgres:16-alpine \
      2>/dev/null || docker start ai-chat-postgres

    # PostgreSQL 준비 대기 (최대 15초)
    echo -n "   PostgreSQL 준비 대기"
    for i in $(seq 1 15); do
      if docker exec ai-chat-postgres pg_isready -U ${DB_USERNAME:-aichat} &>/dev/null; then
        echo " ✅ (${i}초)"
        break
      fi
      echo -n "."
      sleep 1
    done
  fi
  echo "   📊 DB: PostgreSQL (localhost:${DB_PORT:-5432}/${DB_DATABASE:-ai_character_chat})"
else
  echo ""
  echo "💾 DB 모드: sql.js (인메모리 — 서버 재시작 시 데이터 초기화)"
fi

# ── 의존성 설치 ───────────────────────────────────────────
if [ ! -d node_modules ]; then
  echo ""
  echo "📦 Step 1: 의존성 설치 (npm install)"
  npm install
else
  echo "📦 Step 1: node_modules 확인 — OK (skip)"
fi

# ── 빌드 ──────────────────────────────────────────────────
echo ""
echo "🔨 Step 2: TypeScript 빌드"
npx nest build chat-service
npx nest build image-service
npx nest build event-service
npx nest build api-gateway
echo "   ✅ 4개 서비스 빌드 완료"

# ── 서비스 기동 ───────────────────────────────────────────
echo ""
echo "🔥 Step 3: 서비스 기동"

PIDS=()

cleanup() {
  echo ""
  echo "🛑 서비스 종료 중..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait
  echo "   ✅ 모든 서비스 종료 완료"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Chat Service (gRPC :50051)
node dist/apps/chat-service/apps/chat-service/src/main.js &
PIDS+=($!)

# Image Service (gRPC :50052)
node dist/apps/image-service/apps/image-service/src/main.js &
PIDS+=($!)

# Event Service (HTTP :3002)
node dist/apps/event-service/main.js &
PIDS+=($!)

# gRPC 서버 기동 대기
sleep 2

# API Gateway (HTTP :3000 + WebSocket)
node dist/apps/api-gateway/apps/api-gateway/src/main.js &
PIDS+=($!)

sleep 2

echo ""
echo "================================================"
echo "   ✅ 전체 서비스 기동 완료!"
echo ""
echo "   🌐 API Gateway:    http://localhost:3000"
echo "   💬 Chat Service:   gRPC :50051"
echo "   🖼️  Image Service:  gRPC :50052"
echo "   🏆 Event Service:  http://localhost:3002"
echo "   ❤️  Health Check:   http://localhost:3000/health"
if [ "$DB_TYPE" = "postgres" ]; then
echo "   🐘 PostgreSQL:     localhost:${DB_PORT:-5432}"
fi
echo ""
echo "   종료: Ctrl+C"
echo "================================================"

# 모든 백그라운드 프로세스 대기
wait

#!/bin/bash
# ============================================================
# AI Character Chat — 로컬 개발 원클릭 실행
#
# 사용법:
#   chmod +x scripts/dev-start.sh
#   ./scripts/dev-start.sh
#
# Docker 없이 로컬에서 4개 서비스 기동
# DB: sql.js (인메모리 SQLite WASM) — PostgreSQL 불필요
# ============================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 AI Character Chat — 로컬 개발 환경 시작"
echo "================================================"

# ── .env 확인 ─────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "⚠️  .env 파일이 없습니다."
  echo "   .env.example 또는 .env 파일을 생성하고 API 키를 설정하세요."
  echo "   (GEMINI_API_KEY, ANTHROPIC_API_KEY)"
  echo ""
  echo "   없어도 서비스는 기동됩니다. LLM 응답만 불가."
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

# PID 파일 정리
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

# Chat Service (gRPC :50051) — DB 의존이라 먼저
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
echo "   📖 Swagger Docs:   http://localhost:3000/docs"
echo "   ❤️  Health Check:   http://localhost:3000/health"
echo ""
echo "   종료: Ctrl+C"
echo "================================================"

# 모든 백그라운드 프로세스 대기
wait

#!/usr/bin/env bash
# Smoke-test the /api/plan handler. Prereqs:
#   1. npm run dev (so http://localhost:3000 is up)
#   2. .env.local has GRABMAPS_API_KEY + SUPABASE_URL + SUPABASE_ANON_KEY
#   3. supabase/migrations/0001_gabo_schema.sql and supabase/seed.sql have been
#      run in the Supabase SQL editor

set -e
HOST="${HOST:-http://localhost:3000}"

curl -sS -X POST "$HOST/api/plan" \
  -H "Content-Type: application/json" \
  --data @"$(dirname "$0")/test-plan-payload.json" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch{console.log(s)}})'

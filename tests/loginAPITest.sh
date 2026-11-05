#!/bin/bash

# Requires the server running with JWT_SECRET set, and an admin seeded with
# the same ADMIN_EMAIL / ADMIN_PASSWORD (go run ./cmd/seed-admin).

BASE_URL="${API_URL:-http://localhost:8080}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass=0
fail=0

# Unique per run so re-runs don't collide with earlier rows
RUN_ID=$(date +%s)
NEW_EMAIL="pat.$RUN_ID@example.com"

run_test() {
    local description="$1"
    local expected_status="$2"
    local method="$3"
    local path="$4"
    local payload="$5"
    local auth_header="$6"   # optional: full Authorization header value

    local args=(-s -w "\n%{http_code}" -X "$method" "$BASE_URL$path" -H "Content-Type: application/json")
    [ -n "$payload" ] && args+=(-d "$payload")
    [ -n "$auth_header" ] && args+=(-H "Authorization: $auth_header")

    response=$(curl "${args[@]}")
    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)

    if [ "$status" -eq "$expected_status" ]; then
        echo -e "${GREEN}PASS${NC} [$status] $description"
        ((pass++))
    else
        echo -e "${RED}FAIL${NC} [$status expected $expected_status] $description"
        ((fail++))
    fi
    echo "       $body"
    echo ""
}

check() {
    local description="$1"
    local condition="$2"

    if [ "$condition" = "true" ]; then
        echo -e "${GREEN}PASS${NC} $description"
        ((pass++))
    else
        echo -e "${RED}FAIL${NC} $description"
        ((fail++))
    fi
    echo ""
}

echo -e "${YELLOW}Testing login functionality at $BASE_URL${NC}"
echo -e "${CYAN}New requester email for this run: $NEW_EMAIL${NC}"
echo "────────────────────────────────────────────"
echo ""

# ── POST /api/access-requests: happy path ─────────────────────────────────────

run_test "Valid access request" 202 POST /api/access-requests \
    "{\"name\":\"Pat Doe\",\"email\":\"$NEW_EMAIL\"}"
first_body="$body"

run_test "Email is trimmed and lowercased" 202 POST /api/access-requests \
    "{\"name\":\"Sam Lee\",\"email\":\"  Sam.$RUN_ID@EXAMPLE.com  \"}"

# ── POST /api/access-requests: duplicates look identical ──────────────────────

run_test "Duplicate email returns same success" 202 POST /api/access-requests \
    "{\"name\":\"Someone Else\",\"email\":\"$NEW_EMAIL\"}"
check "Duplicate response body matches first response" \
    "$([ "$body" = "$first_body" ] && echo true)"

run_test "Duplicate email, different case, returns same success" 202 POST /api/access-requests \
    "{\"name\":\"Someone Else\",\"email\":\"$(echo "$NEW_EMAIL" | tr a-z A-Z)\"}"
check "Different-case duplicate body matches first response" \
    "$([ "$body" = "$first_body" ] && echo true)"

run_test "Existing admin email returns same success" 202 POST /api/access-requests \
    "{\"name\":\"Imposter\",\"email\":\"$ADMIN_EMAIL\"}"
check "Admin-email response body matches first response" \
    "$([ "$body" = "$first_body" ] && echo true)"

# ── POST /api/access-requests: validation ─────────────────────────────────────

run_test "Missing name" 400 POST /api/access-requests \
    '{"email":"no.name@example.com"}'

run_test "Blank name" 400 POST /api/access-requests \
    '{"name":"   ","email":"blank.name@example.com"}'

run_test "Missing email" 400 POST /api/access-requests \
    '{"name":"No Email"}'

run_test "Invalid email" 400 POST /api/access-requests \
    '{"name":"Bad Email","email":"not-an-email"}'

run_test "Email with display name" 400 POST /api/access-requests \
    '{"name":"Display","email":"Display <display@example.com>"}'

run_test "Email missing domain" 400 POST /api/access-requests \
    '{"name":"No Domain","email":"nodomain@"}'

run_test "Empty body" 400 POST /api/access-requests '{}'

run_test "Malformed JSON" 400 POST /api/access-requests 'not json at all'

run_test "GET not allowed" 405 GET /api/access-requests

# ── POST /api/auth/login ──────────────────────────────────────────────────────

run_test "Admin login with correct password" 200 POST /api/auth/login \
    "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
token=$(echo "$body" | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//')
check "Login response contains a token" "$([ -n "$token" ] && echo true)"

run_test "Admin login with uppercase email" 200 POST /api/auth/login \
    "{\"email\":\"$(echo "$ADMIN_EMAIL" | tr a-z A-Z)\",\"password\":\"$ADMIN_PASSWORD\"}"

run_test "Admin login with wrong password" 401 POST /api/auth/login \
    "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"wrong-password\"}"
wrong_password_body="$body"

run_test "Unknown email" 401 POST /api/auth/login \
    '{"email":"nobody@example.com","password":"whatever"}'
check "Unknown email and wrong password give the same message" \
    "$([ "$body" = "$wrong_password_body" ] && echo true)"

run_test "Pending user (no password yet) cannot log in" 401 POST /api/auth/login \
    "{\"email\":\"$NEW_EMAIL\",\"password\":\"\"}"
check "Pending user gets the same message" \
    "$([ "$body" = "$wrong_password_body" ] && echo true)"

run_test "Malformed JSON" 400 POST /api/auth/login 'not json at all'

run_test "GET not allowed" 405 GET /api/auth/login

run_test "Old /api/login route is gone" 404 POST /api/login \
    "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"

# ── JWT on protected route (GET /api/user) ────────────────────────────────────

run_test "Valid token is accepted" 200 GET /api/user "" "Bearer $token"
check "Token carries the admin role" \
    "$(echo "$body" | grep -q '"role":"admin"' && echo true)"

run_test "No Authorization header" 401 GET /api/user

run_test "Garbage token" 401 GET /api/user "" "Bearer not.a.real.token"

run_test "Wrong auth scheme" 401 GET /api/user "" "Basic $token"

# ── Summary ───────────────────────────────────────────────────────────────────

echo "────────────────────────────────────────────"
echo -e "Results: ${GREEN}$pass passed${NC}, ${RED}$fail failed${NC}"
echo ""
echo "Check the server console: exactly two 'New access request' emails should"
echo "have been logged this run ($NEW_EMAIL and sam.$RUN_ID@example.com)."

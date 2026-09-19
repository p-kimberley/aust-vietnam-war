#!/usr/bin/env bash
# Creates one dev user per role in the local Keycloak (deploy/dev/compose.yaml). Safe to re-run.
#   member@avw.test / author@avw.test / editor@avw.test / admin@avw.test   password: DevPassw0rd!
# Never run this against a real environment.
set -euo pipefail

KC="${KC_URL:-http://localhost:8080}"
REALM=avw
PASSWORD='DevPassw0rd!'

token=$(curl -sf -d 'client_id=admin-cli&username=admin&password=admin&grant_type=password' \
  "$KC/realms/master/protocol/openid-connect/token" | sed 's/.*"access_token":"\([^"]*\)".*/\1/')
auth="Authorization: Bearer $token"
admin="$KC/admin/realms/$REALM"

for role in member author editor admin; do
  email="$role@avw.test"
  curl -s -o /dev/null -H "$auth" -H 'Content-Type: application/json' -X POST "$admin/users" -d "{
    \"username\": \"$email\", \"email\": \"$email\", \"firstName\": \"Dev\", \"lastName\": \"${role^}\",
    \"enabled\": true, \"emailVerified\": true, \"requiredActions\": []
  }" || true

  id=$(curl -sf -H "$auth" "$admin/users?email=$email&exact=true" | sed 's/.*"id":"\([^"]*\)".*/\1/')
  curl -sf -o /dev/null -H "$auth" -H 'Content-Type: application/json' -X PUT "$admin/users/$id/reset-password" \
    -d "{\"type\":\"password\",\"value\":\"$PASSWORD\",\"temporary\":false}"

  # Every user already has `member` through the default role; add the elevated role for the others.
  if [ "$role" != member ]; then
    role_json=$(curl -sf -H "$auth" "$admin/roles/$role")
    curl -sf -o /dev/null -H "$auth" -H 'Content-Type: application/json' -X POST "$admin/users/$id/role-mappings/realm" -d "[$role_json]"
  fi
  echo "seeded $email"
done

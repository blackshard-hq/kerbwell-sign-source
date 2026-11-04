#!/usr/bin/env bash
# kerbwell-bootstrap.test.sh IMAGE: the bootstrap job against a fresh Postgres, inside IMAGE.
#
# Starts a throwaway Postgres, migrates it with the image's own prisma-migrate-deploy.mjs, then
# runs docker/kerbwell-bootstrap.test.mjs (node --test) inside the image. Exit 0 only when every
# test passes. Containers are named scratch-kw-boot-*; the database password is random and
# passed through the environment, never on a command line.
#
#   DOCKER (default docker) runs the docker CLI, so builder-01 can route it through its broker.
set -euo pipefail

IMAGE="${1:?usage: kerbwell-bootstrap.test.sh IMAGE}"
DOCKER="${DOCKER:-docker}"
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="scratch-kw-boot-$$"
NET="scratch-kw-boot-net-$$"

PGPW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
export POSTGRES_PASSWORD="$PGPW"
export NEXT_PRIVATE_DATABASE_URL="postgres://postgres:${PGPW}@${RUN}-db:5432/postgres"
export NEXT_PRIVATE_DIRECT_DATABASE_URL="$NEXT_PRIVATE_DATABASE_URL"

cleanup() {
  $DOCKER rm -f "${RUN}-db" >/dev/null 2>&1 || true
  $DOCKER network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

$DOCKER network create "$NET" >/dev/null
$DOCKER run -d --name "${RUN}-db" --network "$NET" -e POSTGRES_PASSWORD postgres:15-alpine >/dev/null

for _ in $(seq 1 60); do
  if $DOCKER exec "${RUN}-db" pg_isready -U postgres -q 2>/dev/null; then break; fi
  sleep 1
done

$DOCKER run --rm --network "$NET" \
  -e NEXT_PRIVATE_DATABASE_URL -e NEXT_PRIVATE_DIRECT_DATABASE_URL \
  -v "$HERE/kerbwell-bootstrap.test.mjs:/app/apps/remix/kerbwell-bootstrap.test.mjs:ro" \
  --entrypoint sh "$IMAGE" -c 'node prisma-migrate-deploy.mjs --schema ../../packages/prisma/schema.prisma >/dev/null && node --test kerbwell-bootstrap.test.mjs'

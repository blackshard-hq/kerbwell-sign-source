#!/usr/bin/env bash
# Measures what docker/prisma-migrate-deploy.mjs puts on argv, against this repo's
# own Prisma 6.19.x schema engine, schema and migrations and a throwaway Postgres
# (Black Shard eSign, BS-A670).
#
# Every step runs under strace -f -e trace=execve. The check reads the made-up
# password from the run's env file in process and fails the step if any execve
# argv holds it or holds --datasource. A positive control runs the Prisma CLI's own
# `migrate status` the same way and must be caught, so a check that sees nothing
# cannot pass by being blind. Afterwards the Prisma CLI's own status must read the
# database as up to date, so the script's result is the CLI's result.
#
# The password is random per run, made up here, and exists only in this run's temp
# directory and container. Nothing reads a vault or an estate env file.
#
# Run from the repo root:  bash docker/prisma-migrate-deploy.test.sh
# Needs docker, strace, node, python3 and node_modules (npm ci). Prints SKIP and
# exits 0 when one is missing. Exit 1 on any failed step.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TOOL="$ROOT/docker/prisma-migrate-deploy.mjs"
IMAGE=${BS_PRISMA_TEST_PG_IMAGE:-postgres:16-alpine}

for need in docker strace node python3; do
  command -v "$need" >/dev/null 2>&1 || { echo "SKIP: $need not installed"; exit 0; }
done
[ -d "$ROOT/node_modules/prisma" ] || { echo "SKIP: no node_modules/prisma (run npm ci)"; exit 0; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "SKIP: image $IMAGE not present"; exit 0; }

W=$(mktemp -d "${TMPDIR:-/tmp}/esign-pmd.XXXXXX")
NAME="esign-pmd-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$W"; }
trap cleanup EXIT

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
# A copy of the real schema and migrations, so a test migration never touches the repo.
mkdir -p "$W/packages/prisma" "$W/apps/remix"
cp "$ROOT/packages/prisma/schema.prisma" "$W/packages/prisma/schema.prisma"
cp -r "$ROOT/packages/prisma/migrations" "$W/packages/prisma/migrations"
ln -s "$ROOT/node_modules" "$W/node_modules"
N_MIG=$(find "$W/packages/prisma/migrations" -mindepth 2 -maxdepth 2 -name migration.sql | wc -l)
# The made-up password is generated and written in process: never on argv.
python3 - "$W" "$PORT" <<'EOF'
import os, secrets, sys
w, port = sys.argv[1], sys.argv[2]
pw = "madeup" + secrets.token_hex(12)
url = f"postgres://esign:{pw}@127.0.0.1:{port}/esign"
for path, text in ((f"{w}/pg.env", f"POSTGRES_USER=esign\nPOSTGRES_PASSWORD={pw}\nPOSTGRES_DB=esign\n"),
                   (f"{w}/app.env", f"NEXT_PRIVATE_DATABASE_URL={url}\nNEXT_PRIVATE_DIRECT_DATABASE_URL={url}\n")):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, text.encode()); os.close(fd)
EOF
docker run -d --rm --name "$NAME" --env-file "$W/pg.env" -p "127.0.0.1:$PORT:5432" "$IMAGE" >/dev/null || { echo "FAIL: postgres did not start"; exit 1; }
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U esign -d esign >/dev/null 2>&1 && break
  python3 -c 'import time; time.sleep(0.5)'
done
docker exec "$NAME" pg_isready -U esign -d esign >/dev/null 2>&1 || { echo "FAIL: postgres not ready"; exit 1; }

cat > "$W/check.py" <<'EOF'
import re, sys
envf, log, want_leak = sys.argv[1], sys.argv[2], sys.argv[3] == "leak"
url = [l.split("=", 1)[1].strip() for l in open(envf) if l.startswith("NEXT_PRIVATE_DATABASE_URL=")][0]
pw = url.split("://", 1)[1].split("@", 1)[0].split(":", 1)[1]
bad = 0
for l in open(log, errors="replace"):
    if "execve(" not in l or "= -1" in l:
        continue
    m = re.search(r'execve\("([^"]+)", \[(.*?)\]', l)
    if m and (pw in m.group(2) or '"--datasource"' in m.group(2)):
        bad += 1
print(bad)
sys.exit(0 if (bad > 0) == want_leak else 1)
EOF

FAILS=0
run_env() {  # run_env <cmd...>: the URL variables come from the env file, never argv
  (set -a; . "$W/app.env"; set +a; cd "$W/apps/remix" && "$@")
}
step() {  # step <expected-exit> <label> <script args...>
  local want=$1 label=$2; shift 2
  run_env strace -f -qq -e trace=execve -s 8192 -o "$W/st.log" node "$TOOL" "$@" >"$W/out" 2>&1
  local rc=$? leaks clean
  leaks=$(python3 "$W/check.py" "$W/app.env" "$W/st.log" clean)
  clean=$?
  if [ "$rc" = "$want" ] && [ "$clean" = 0 ]; then
    echo "PASS  $label (exit $rc, argv with the password or --datasource: $leaks)"
  else
    echo "FAIL  $label (exit $rc want $want, argv with the password or --datasource: $leaks)"; sed 's/^/      /' "$W/out"; FAILS=$((FAILS + 1))
  fi
}
count_rows() { docker exec "$NAME" psql -U esign -d esign -Atc "$1" 2>/dev/null; }
cli_status() { run_env node "$W/node_modules/prisma/build/index.js" migrate status --schema ../../packages/prisma/schema.prisma >"$W/status.out" 2>&1; }

# Positive control first, read only: the Prisma CLI itself must be caught by the same check.
run_env strace -f -qq -e trace=execve -s 8192 -o "$W/st.log" node "$W/node_modules/prisma/build/index.js" migrate status --schema ../../packages/prisma/schema.prisma >/dev/null 2>&1
if leaks=$(python3 "$W/check.py" "$W/app.env" "$W/st.log" leak); then
  echo "PASS  control: prisma migrate status is caught ($leaks argv with the password or --datasource)"
else
  echo "FAIL  control: the check did not see the Prisma CLI's own argv leak"; FAILS=$((FAILS + 1))
fi

step 0 "deploy on an empty database applies all $N_MIG" --schema ../../packages/prisma/schema.prisma
grep -q "applied $N_MIG:" "$W/out" && echo "PASS  reports $N_MIG applied" || { echo "FAIL  applied count"; sed -n 1,3p "$W/out" | cut -c1-200; FAILS=$((FAILS + 1)); }
[ "$(count_rows 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')" = "$N_MIG" ] \
  && echo "PASS  $N_MIG finished rows in _prisma_migrations" || { echo "FAIL  finished rows"; FAILS=$((FAILS + 1)); }
cli_status
grep -q "Database schema is up to date" "$W/status.out" && echo "PASS  the Prisma CLI reads the result as up to date" \
  || { echo "FAIL  Prisma CLI status"; sed 's/^/      /' "$W/status.out" | tail -8; FAILS=$((FAILS + 1)); }
step 0 "second deploy is a no-op" --schema ../../packages/prisma/schema.prisma
grep -q "No pending migrations to apply" "$W/out" && echo "PASS  no pending migrations" || { echo "FAIL  no-op text"; FAILS=$((FAILS + 1)); }
step 0 "default --schema from apps/remix"
mkdir -p "$W/packages/prisma/migrations/29990101000000_bad"
printf 'ALTER TABLE "NoSuchTable" ADD COLUMN "x" TEXT;\n' > "$W/packages/prisma/migrations/29990101000000_bad/migration.sql"
step 1 "a failing migration exits 1 (P3018)" --schema ../../packages/prisma/schema.prisma
grep -q P3018 "$W/out" && echo "PASS  P3018 reported" || { echo "FAIL  no P3018"; sed 's/^/      /' "$W/out" | head -5; FAILS=$((FAILS + 1)); }
grep -q madeup "$W/out" && { echo "FAIL  the password reached the output"; FAILS=$((FAILS + 1)); } || echo "PASS  no password in the output"
step 2 "a URL as an argument is refused" --schema "postgres://nohost/nodb"
(unset NEXT_PRIVATE_DATABASE_URL; cd "$W/apps/remix" && node "$TOOL" >/dev/null 2>&1); rc=$?
[ "$rc" = 2 ] && echo "PASS  refuses with the url variable unset (exit 2)" || { echo "FAIL  unset url exit $rc"; FAILS=$((FAILS + 1)); }

if [ "$FAILS" = 0 ]; then echo "RESULT PASS"; exit 0; fi
echo "RESULT FAIL ($FAILS)"; exit 1

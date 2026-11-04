#!/usr/bin/env bash
# kerbwell-source.sh: publish the corresponding source of a Kerbwell Sign build (AGPL-3.0 s13).
#
# The private repository (blackshard-hq/kerbwell-sign) stays private. Every image build first
# publishes the exact source tree it is built from to the public, read-only mirror, as one
# snapshot commit whose git tree is byte-for-byte the build's tree, tagged src-<tree12>. The
# image then carries that tag's URL as BRAND_SOURCE_URL (docker/Dockerfile), and the sign site's
# footer links to it.
#
# Anyone can check the link names the running build: the tag's commit has the same tree id as
# the fork commit (git rev-parse <commit>^{tree}), which the image also records in its
# org.opencontainers.image.revision label.
#
#   kerbwell-source.sh url     [REV]   print the mirror URL for REV's tree (default HEAD)
#   kerbwell-source.sh scan    [REV]   secret-scan REV's tree with gitleaks; exit 1 on any finding
#   kerbwell-source.sh publish [REV]   scan, then push the snapshot and tag to the mirror (idempotent)
#   kerbwell-source.sh check   URL     exit 0 only when URL answers 200 to an anonymous request
#   kerbwell-source.sh release [REV]   publish, then check; prints the URL on success
#
# Environment:
#   KERBWELL_SOURCE_MIRROR      owner/name of the public mirror (default blackshard-hq/kerbwell-sign-source)
#   KERBWELL_SOURCE_PUSH_URL    git remote to push to (default https://github.com/$KERBWELL_SOURCE_MIRROR.git);
#                               credentials come from git's own credential helper or GIT_SSH_COMMAND,
#                               never from this script's arguments
#   KERBWELL_SOURCE_ATTEMPTS    check retries, 5 s apart (default 6), for GitHub's short publish lag
#   KERBWELL_SOURCE_BRANCH      the mirror branch that holds the snapshots in order (default snapshots)
#
# Exit codes: 0 done, 1 scan finding or check failed, 2 usage or configuration.
set -euo pipefail

MIRROR="${KERBWELL_SOURCE_MIRROR:-blackshard-hq/kerbwell-sign-source}"
PUSH_URL="${KERBWELL_SOURCE_PUSH_URL:-https://github.com/${MIRROR}.git}"
ATTEMPTS="${KERBWELL_SOURCE_ATTEMPTS:-6}"
# The mirror's only branch: every snapshot in build order. Its tags are what the sites link to.
BRANCH="${KERBWELL_SOURCE_BRANCH:-snapshots}"
ROOT="$(git rev-parse --show-toplevel)"

say() { printf '[kerbwell-source] %s\n' "$*" >&2; }
die() { say "$1"; exit "${2:-2}"; }

tree_of() { git -C "$ROOT" rev-parse --verify --quiet "${1:-HEAD}^{tree}" || die "not a revision: ${1:-HEAD}"; }
commit_of() { git -C "$ROOT" rev-parse --verify --quiet "${1:-HEAD}^{commit}" || die "not a revision: ${1:-HEAD}"; }
tag_of() { printf 'src-%s' "$(tree_of "$1" | cut -c1-12)"; }
url_of() { printf 'https://github.com/%s/tree/%s' "$MIRROR" "$(tag_of "$1")"; }

scan() {
  local rev="${1:-HEAD}" work
  command -v gitleaks >/dev/null || die "gitleaks is not installed"
  work="$(mktemp -d)"
  git -C "$ROOT" archive --format=tar "$(commit_of "$rev")" | tar -x -C "$work"
  # Findings are reported by file and rule only (--redact), so a secret is never printed.
  # Reviewed upstream samples are listed by path:rule:line in the tree's own
  # docker/kerbwell-gitleaks.ignore; anything else fails.
  if ! (cd "$work" && gitleaks dir . --no-banner --redact --exit-code 1 \
    --gitleaks-ignore-path "$work/docker/kerbwell-gitleaks.ignore" >&2); then
    rm -rf "$work"
    say "secret scan found something in $(tree_of "$rev"); nothing published"
    return 1
  fi
  rm -rf "$work"
  say "secret scan clean: tree $(tree_of "$rev")"
}

publish() {
  local rev="${1:-HEAD}" tree commit tag parent snapshot
  tree="$(tree_of "$rev")"
  commit="$(commit_of "$rev")"
  tag="$(tag_of "$rev")"

  if git ls-remote --exit-code --tags "$PUSH_URL" "refs/tags/$tag" >/dev/null 2>&1; then
    say "mirror already holds $tag"
    return 0
  fi

  scan "$rev" || return 1

  parent=""
  if git -C "$ROOT" fetch --quiet --depth=1 "$PUSH_URL" "refs/heads/${BRANCH}" 2>/dev/null; then
    parent="$(git -C "$ROOT" rev-parse FETCH_HEAD)"
  fi

  # One commit, this tree, no fork history. Author and date are fixed so a rerun after a
  # failed push makes the same commit.
  snapshot="$(
    GIT_AUTHOR_NAME='Kerbwell Sign' GIT_AUTHOR_EMAIL='source@kerbwell.com.au' \
      GIT_COMMITTER_NAME='Kerbwell Sign' GIT_COMMITTER_EMAIL='source@kerbwell.com.au' \
      GIT_AUTHOR_DATE="$(git -C "$ROOT" show -s --format=%cI "$commit")" \
      GIT_COMMITTER_DATE="$(git -C "$ROOT" show -s --format=%cI "$commit")" \
      git -C "$ROOT" commit-tree "$tree" ${parent:+-p "$parent"} \
      -m "Kerbwell Sign source, tree ${tree}" \
      -m "Corresponding source (AGPL-3.0 section 13) of the Kerbwell Sign build made from this tree. Based on Documenso (https://github.com/documenso/documenso), AGPL-3.0."
  )"

  git -C "$ROOT" push --quiet "$PUSH_URL" "${snapshot}:refs/heads/${BRANCH}" "${snapshot}:refs/tags/${tag}"
  say "published $tag ($snapshot, tree $tree)"
}

check() {
  local url="${1:-}" attempt result code effective
  [[ "$url" =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/tree/[A-Za-z0-9._/-]+$ ]] ||
    die "check needs a https://github.com/<owner>/<repo>/tree/<ref> URL"

  for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
    # Anonymous: no netrc, no cookies, no auth header. A private or missing ref answers 404,
    # and a sign-in wall ends on /login; both fail.
    result="$(env -u GITHUB_TOKEN -u GH_TOKEN curl --silent --show-error --location --max-redirs 3 \
      --netrc-file /dev/null --output /dev/null --write-out '%{http_code} %{url_effective}' \
      --max-time 20 "$url" || true)"
    code="${result%% *}"
    effective="${result#* }"
    if [[ "$code" == "200" && "$effective" != *"/login"* && "$effective" != *"/session"* ]]; then
      say "source URL answers 200 without sign-in: $url"
      return 0
    fi
    say "attempt $attempt: $url answered ${code:-nothing}${effective:+ at $effective}"
    if ((attempt < ATTEMPTS)); then sleep 5; fi
  done
  say "source URL is not publicly reachable: $url"
  return 1
}

cmd="${1:-}"
shift || true
case "$cmd" in
  url) url_of "${1:-HEAD}"; echo ;;
  scan) scan "${1:-HEAD}" ;;
  publish) publish "${1:-HEAD}" ;;
  check) check "${1:-}" ;;
  release)
    publish "${1:-HEAD}"
    check "$(url_of "${1:-HEAD}")"
    url_of "${1:-HEAD}"
    echo
    ;;
  *) die "usage: kerbwell-source.sh url|scan|publish|release [REV] | check URL" ;;
esac

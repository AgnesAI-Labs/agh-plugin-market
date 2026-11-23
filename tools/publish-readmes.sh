#!/usr/bin/env bash
set -euo pipefail

# Both SHAs come from the workflow's local checkout and validated candidate.
base=$1
head=$2
branch="automation/market-readmes-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
ref="refs/heads/$branch"
title='docs: sync market README tables'
context='market / validate-index'

api() {
  local path=$1
  shift
  gh api "repos/$GITHUB_REPOSITORY/$path" "$@"
}

push() {
  # Use the job's GH_TOKEN without putting it in the repo config or remote URL.
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push "$@"
}

require_current_main() {
  local current
  current=$(api git/ref/heads/main --jq .object.sha)
  if [[ $current != "$base" ]]; then
    echo '::notice::main moved; stopping this README sync attempt.'
    exit 0
  fi
}

require_current_pr() {
  local current
  current=$(api "pulls/$number" --jq '[.state, .head.repo.full_name, .head.ref, .head.sha,
    .base.repo.full_name, .base.ref, .base.sha, (.mergeable | tostring)] | @tsv')
  if [[ $current != "$expected"$'\t'* ]]; then
    echo "::notice::README sync PR #$number changed; stopping this attempt."
    exit 0
  fi
  mergeable=${current##*$'\t'}
}

cleanup() {
  # Deleting the head ref closes its open PR. An exact lease leaves updates alone.
  if ! push --force-with-lease="$ref:$head" origin ":$ref"; then
    echo "::warning::Could not clean up $branch with its exact-head lease."
  fi
}

# The merge API pins the head; the strict required check is what protects against
# main advancing between our final check and the merge request.
protected=$(api rules/branches/main --jq '
  any(.[]; .type == "pull_request") and
  any(.[]; .type == "required_status_checks" and
    .parameters.strict_required_status_checks_policy == true and
    any(.parameters.required_status_checks[]?;
      .context == "market / validate-index" and .integration_id == 15368))')
if [[ $protected != true ]]; then
  echo '::error::Required main protections are not active; no README writeback attempted.'
  exit 1
fi
require_current_main
push --force-with-lease="$ref:" origin "$head:$ref"
trap cleanup EXIT
require_current_main

if ! number=$(api pulls --method POST -f base=main -f head="$branch" -f title="$title" \
  -f body="Regenerate the bilingual README tables from the validated market index at $base." \
  --jq .number); then
  echo '::error::Could not create the README sync PR. Repository and organization policy must allow GitHub Actions to create pull requests.'
  exit 1
fi
expected=$(printf 'open\t%s\t%s\t%s\t%s\tmain\t%s' "$GITHUB_REPOSITORY" "$branch" "$head" "$GITHUB_REPOSITORY" "$base")
require_current_main
require_current_pr

# GITHUB_TOKEN PR creation does not trigger Market index's pull_request_target.
# Publish the same status only on this run's exact, already validated candidate.
api "statuses/$head" --method POST -f context="$context" -f state=success \
  -f description='Market index and sources are valid' \
  -f target_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" >/dev/null

# GitHub computes mergeability for new PRs asynchronously.
for ((attempt = 0; attempt < 15; attempt++)); do
  require_current_main
  require_current_pr
  [[ $mergeable == null ]] || break
  sleep 2
done
if [[ $mergeable != true ]]; then
  echo "::error::GitHub did not confirm that README sync PR #$number is mergeable."
  exit 1
fi
if result=$(api "pulls/$number/merge" --method PUT -f sha="$head" -f merge_method=squash \
  -f commit_title="$title" -f commit_message='Regenerate the English and Chinese README tables from the market index.' \
  --jq .merged) && [[ $result == true ]]; then
  echo "Merged README sync PR #$number."
else
  require_current_main
  require_current_pr
  echo "::error::GitHub did not merge README sync PR #$number."
  exit 1
fi

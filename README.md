# AGH plugin market

English | [中文](README.zh-CN.md)

The official plugin market index of [Agnes Harness](https://github.com/AgnesAI-Labs/agnes-harness) (AGH). There is no central store: every plugin lives in its own GitHub repository, and this repository lists the official ones.

- `plugins.txt`: the source list, one Git repository per line.
- `docs/index.json`: the published index, served through GitHub Pages. AGH's **Plugins → Market** reads it.

## Format

`index.json` follows format 1 of the DeepSeek Harness plugin market index (`packages/util/plugin-market-index` in DSH), so the same readers and validators apply. There are four AGH-specific differences:

- the engine requirement is `engines.agh` instead of `engines.dsh`;
- a package is a plugin when its `package.json` carries the `agnes` declaration, not `dsh.bundle`;
- a Git version `{ "type": "git", "url": U, "commit": C }` installs as `agh plugins add git:U#C`;
- locale keys are lowercase (`zh-cn`), as format 1 requires; AGH maps them to its own locale ids.

Each version pins the commit of its release tag. Until the full generator exists, `node tools/build-index.mjs <dir-with-clones>` rebuilds the index from local clones of the listed repositories (newest release tag of each). The output passes the DSH format 1 validator.

## List your plugin

1. Put your plugin in its own GitHub repository with `package.json` at the root, and release it with `vX.Y.Z` tags.
2. Add the GitHub topic `agh-plugin` to the repository, so it appears on [github.com/topics/agh-plugin](https://github.com/topics/agh-plugin).
3. Open a pull request against `main` with the repository URL in `plugins.txt` and the regenerated `docs/index.json`.

For an already listed repository, keep its URL and add a line such as `# pin: https://github.com/OWNER/REPO 1.2.3 FULL_COMMIT_SHA` to `plugins.txt`. Use the actual 40-character lowercase Git commit SHA without the `v` prefix on the version. The pin must match the index; when replacing the only listed version, remove its old pin if present. A version that remains in the index cannot point to a different commit. Rebuild and review the diff: the generator can pick up unrelated tags, but CI rejects undeclared updates. For removal, remove the URL, its pins, and its index entry together.

Run the required `market / validate-index` check locally from the repository root:

```sh
node tools/validate-index.mjs "$(git rev-parse origin/main)"
```

The index check validates format 1, unique package names, Git sources, and consistency with `plugins.txt`. The published file must not exceed 2 MiB (2,097,152 bytes), the AGH daemon's download limit. This check is offline and does not verify that a release tag exists.

If `main` advances while your PR is open, update your branch before merging and let the check run on the new head.

### Release review (report only)

`market / review-release` links to a report for the current PR commit. It scans the PR title, description, and proposed commit history for credentials, then checks added or updated indexed releases. It verifies the public `vX.Y.Z` tag and pinned commit, checks the root manifest, declared entry files and assets, and scans text files (including committed build output) and filenames with Gitleaks. It does not run plugins, install dependencies, recheck unchanged releases, or prove that binary media is safe.

| Result | Next step |
| --- | --- |
| `passed` | No findings from the configured checks. Eligible PRs may be merged by the publisher below; this is not a safety or installation guarantee. |
| `needs-review` | A maintainer must review the specific findings, such as a publisher outside `AgnesAI-Labs`, licensing, declared capabilities, install hooks, runtime dependencies, or sensitive APIs. Organization ownership is not a guarantee of safety. |
| `failed` | Fix the indicated release or PR issue and push a new revision. For potential credentials, verify privately and revoke or rotate anything exposed before cleaning the history and submitting a clean release. The report does not include matching values or raw scanner output. |
| `incomplete` | Fix missing access or scan coverage, or retry a scanner or network failure. If a batch exceeds 12 changed releases, split the PR. |

This report is independent and advisory: it only reports findings and does not write repository contents, approve, or merge PRs. The publisher runs its own fresh review rather than trusting this status.

### Unattended review, merge, and publish

When enabled, **Market release publisher** runs after a successful PR index check and every ten minutes. Each audit selects at most one open, non-draft PR to `main`. The PR must change `docs/index.json` and may also change `plugins.txt`; no other files may change. Only two kinds of changes qualify:

- A version update to an already indexed repository on the allowlist in [`tools/publish-release.mjs`](tools/publish-release.mjs). The initial allowlist is `AgnesAI-Labs/agh-app-devboard`, `AgnesAI-Labs/agh-app-pharma-gmp`, and `AgnesAI-Labs/agh-app-aerospace-quality`.
- A presentation-only change from a branch in this repository (not a fork): only the catalog's top-level `title` or `description` may change, with no changes to plugin entries or `plugins.txt`.

New listings or publishers, changes outside these categories, and repository or tooling changes (including changes to the allowlist) require manual review and merge. The read-only audit uses trusted `main` code, never checks out or executes contributor code, and runs fresh index validation and release review against the current PR head. Only `passed` can proceed; `needs-review`, `failed`, and `incomplete` never qualify for automatic merge.

An isolated merge job uses the repository's short-lived `GITHUB_TOKEN` and requests a merge for the audited commit only. It does not post approvals or bypass any rule: GitHub still requires a pull request and the strict `market / validate-index` check (the PR must be up to date). No GitHub App, PAT, organization administrator, or bypass actor is needed.

GitHub Actions explicitly deploys `docs/index.json` and `docs/.nojekyll` to Pages after an automatic merge; it also deploys changes to these files merged manually to `main`. The [public index URL](https://agnesai-labs.github.io/agh-plugin-market/index.json) is unchanged. Publication is verified by comparing the public index byte for byte with the committed file. If verification times out after a merge, use the reported SHA to diagnose or retry the Pages deployment rather than merging again.

**Repository admin setup and controls**

1. Keep the `main` pull request rule and strict `market / validate-index` requirement with GitHub Actions as the check source. Do not add bypass actors. In **Settings → Pages → Build and deployment → Source**, switch from **Deploy from a branch** (`main:/docs`) to **GitHub Actions**.
2. On `main`, use **Market release publisher → Run workflow** with `dry_run` checked (the default). This runs the audit without merging or deploying, even with automatic publishing disabled.
3. Set the repository Actions variable `MARKET_PUBLISHER_ENABLED` to `true` to enable automatic merges or run manually with `dry_run` unchecked. Removing the variable or setting it to `false` disables new automatic merges, not Pages deployments from manual merges. To stop urgently, also cancel active publisher runs; cancellation does not undo a merge that already happened.
4. To roll back the deployment setup, disable the publisher and switch Pages back to **Deploy from a branch → `main` → `/docs`**, then verify the same public URL. To undo a published catalog change, merge a revert PR through the normal checks and verify the resulting deployment.

## Listed plugins

| Repository | Package |
|---|---|
| [agh-app-devboard](https://github.com/AgnesAI-Labs/agh-app-devboard) | `@agnes-showcase/devboard` |
| [agh-app-pharma-gmp](https://github.com/AgnesAI-Labs/agh-app-pharma-gmp) | `@agnes-showcase/pharma-gmp` |
| [agh-app-aerospace-quality](https://github.com/AgnesAI-Labs/agh-app-aerospace-quality) | `@agnes-showcase/aerospace-quality` |
| [DingTalk channel](https://github.com/lzc970718/agh-plugin-dingtalk) | `@agnes/channel-dingtalk` |
| [Feishu channel](https://github.com/lzc970718/agh-plugin-feishu) | `@agnes/channel-feishu` |
| [WeChat channel](https://github.com/lzc970718/agh-plugin-wechat) | `@agnes/channel-wechat` |

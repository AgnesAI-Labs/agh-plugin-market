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
| `passed` | No findings from the configured checks. Continue normal review; this is not a safety or installation guarantee. |
| `needs-review` | A maintainer must review the specific findings, such as a publisher outside `AgnesAI-Labs`, licensing, declared capabilities, install hooks, runtime dependencies, or sensitive APIs. Organization ownership is not a guarantee of safety. |
| `failed` | Fix the indicated release or PR issue and push a new revision. For potential credentials, verify privately and revoke or rotate anything exposed before cleaning the history and submitting a clean release. The report does not include matching values or raw scanner output. |
| `incomplete` | Fix missing access or scan coverage, or retry a scanner or network failure. If a batch exceeds 12 changed releases, split the PR. |

The report itself is advisory. It neither approves nor merges a PR. The separate publisher below uses a fresh review, not the advisory status.

### Automatic merge after maintainer approval

Once enabled, **Market release publisher** checks for approved catalog PRs every ten minutes. It considers only non-draft PRs that change `docs/index.json` and optionally `plugins.txt`, with no changes elsewhere. A maintainer other than the author must approve the **current** PR commit. Pushes require approval of the new commit. The publisher reruns index validation and release review: `passed` and `needs-review` can proceed with human approval; `failed` and `incomplete` cannot. Repository maintenance PRs still use the normal merge flow.

The read-only audit never receives the publishing key. The publisher rechecks the current commit, PR text, approval, and branch protections before requesting a merge for that exact commit. After merging it waits for the [public index](https://agnesai-labs.github.io/agh-plugin-market/index.json) to match the committed bytes. If Pages verification times out, the run fails and reports the merge SHA; check the Pages deployment instead of merging again.

**One-time setup for repository admins**

1. Register an organization-owned GitHub App and install it **only** on `agh-plugin-market`. Grant repository **Contents: Read and write** (Metadata is read-only); disable webhooks and do not add the App to a ruleset bypass list. Keep Pages on `main:/docs`.
2. Create the `market-publisher` Actions environment, allow deployments only from the `main` branch, and store the App private key as the **environment** secret `MARKET_PUBLISHER_PRIVATE_KEY`. Set the repository Actions variable `MARKET_PUBLISHER_CLIENT_ID` to the App's client ID.
3. In the `main` PR rules, require at least one approval and dismiss stale approvals when new commits change the diff. This also applies to manual merges. Keep `market / validate-index` required and strict (the PR must be up to date) with GitHub Actions as the source. Do not add bypass actors. The publisher refuses to merge if the approval or index rule is missing.
4. Use **Market release publisher → Run workflow** on `main` with `dry_run` checked to rehearse. It does not create a merge token or update `main`. Set the repository Actions variable `MARKET_PUBLISHER_ENABLED` to `true` to activate scheduled merges. Remove it or set it to `false` to stop new automatic merges; cancel any active publisher run if stopping urgently.

## Listed plugins

| Repository | Package |
|---|---|
| [agh-app-devboard](https://github.com/AgnesAI-Labs/agh-app-devboard) | `@agnes-showcase/devboard` |
| [agh-app-pharma-gmp](https://github.com/AgnesAI-Labs/agh-app-pharma-gmp) | `@agnes-showcase/pharma-gmp` |
| [agh-app-aerospace-quality](https://github.com/AgnesAI-Labs/agh-app-aerospace-quality) | `@agnes-showcase/aerospace-quality` |
| [DingTalk channel](https://github.com/lzc970718/agh-plugin-dingtalk) | `@agnes/channel-dingtalk` |
| [Feishu channel](https://github.com/lzc970718/agh-plugin-feishu) | `@agnes/channel-feishu` |
| [WeChat channel](https://github.com/lzc970718/agh-plugin-wechat) | `@agnes/channel-wechat` |

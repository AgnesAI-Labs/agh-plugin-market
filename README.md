# AGH plugin market

English | [中文](README.zh-CN.md)

The official plugin market index of [Agnes Harness](https://github.com/AgnesAI-Labs/agnes-harness) (AGH). There is no central store: each plugin lives in its own GitHub repository, including plugins published by the community.

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

### Submit a new public listing

1. Put your plugin in its own public GitHub repository with `package.json` at the root. Name the package `@<lowercase-github-owner>/<name>`: for `https://github.com/Octo-Cat/agh-example`, use a name such as `@octo-cat/example`. The scopes `agnes`, `agnesai`, `agnes-ai`, `agnesai-labs`, `agnes-harness`, and `agnes-showcase` are reserved, regardless of case.
2. At the plugin repository root, add `agh.market.json` to the commit you will tag. Run `gh api user --jq .id` while signed in as the GitHub account that will open the market PR. Replace `12345` below with that numeric account ID (not a username or a quoted string):

   ```json
   {
     "repository": "https://github.com/Octo-Cat/agh-example",
     "submitters": [12345]
   }
   ```

   These are the only allowed keys. Use the canonical `https://github.com/OWNER/REPO` URL, which must match the indexed Git source ignoring case. `submitters` must contain 1–32 distinct positive safe integers. The public tag proves that whoever published the release delegated submission to those accounts. The publisher checks the account that opened the PR, not a Git commit author. A copy of the file on the plugin's default branch does not count unless it is also in the exact tagged commit.
3. Publish a stable `vX.Y.Z` tag whose version matches `package.json`, and add the `agh-plugin` topic so others can find the plugin at [github.com/topics/agh-plugin](https://github.com/topics/agh-plugin). Verify the exact tag is public on that repository without redirects, and that its commit is the full 40-character lowercase SHA you will put in `source.commit`. For example:

   ```sh
   GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c http.followRedirects=false ls-remote --exit-code \
     https://github.com/Octo-Cat/agh-example 'refs/tags/v1.2.3' 'refs/tags/v1.2.3^{}'
   ```

   For an annotated tag, use the commit SHA from the `^{}` line, not the tag object's SHA.
4. If you do not have write access to this market repository, fork it, sync the fork with the latest upstream `main`, and create a branch from that revision. Open the PR from your fork against `AgnesAI-Labs/agh-plugin-market:main`. No membership in the organization or a team is required.
5. Append exactly one line to `plugins.txt`: the canonical repository URL. Append exactly one plugin row to the end of the `plugins` array in `docs/index.json` with one stable version pinned to the tagged commit. Leave all existing lines and listings, top-level index fields, and other files unchanged. No `# pin` line is needed for this first listing.

Use `node tools/build-index.mjs <dir-with-clones>` to generate the candidate row. It needs a local clone of each repository listed in `plugins.txt`, each under its repository name with release tags fetched. Run it in a disposable checkout that includes your appended URL: it overwrites `docs/index.json` and can pick up unrelated tags. Copy **only** your candidate row into the index on your PR branch, and check that it selected the intended version and commit.

`title` and `description` are optional display text: use plain strings or locale maps with `en` and/or `zh-cn`. `author` is optional; if present, it must be the GitHub repository owner's username or organization name, ignoring case. The generator fills this in for owner-scoped packages. `homepage` may be omitted; if set, it must be the same HTTPS GitHub repository URL. `repository` contains only `url`. Use the generator's metadata shape: `keywords` from the plugin manifest or `[]`, empty `labels` (`[]`), and empty `sortKeys` (`{}`).

### Update or remove an existing listing

For a version update, keep the repository URL and add a line such as `# pin: https://github.com/OWNER/REPO 1.2.3 FULL_COMMIT_SHA` to `plugins.txt`. Use the full 40-character lowercase commit SHA and omit the `v` prefix from the version. The pin must match the index; when replacing the only listed version, remove its old pin if present. A version that remains in the index cannot point to a different commit. For public listings using the repository-owner namespace, the exact new tagged commit must also carry a valid `agh.market.json` authorizing the account that opens the update PR. Copy only the intended update from the generator and review the diff; CI rejects undeclared updates. For removal, remove the URL, its pins, and its index entry together.

### Check your submission

Run the required `market / validate-index` check locally from the repository root. In a fork, add the original market repository once with `git remote add upstream https://github.com/AgnesAI-Labs/agh-plugin-market.git` if you have not set up that remote yet. If `origin` is already the original market repository, use `origin` instead of `upstream`:

```sh
git fetch upstream main
node tools/validate-index.mjs "$(git rev-parse upstream/main)"
```

The index check validates format 1, unique package names, Git sources, and consistency with `plugins.txt`. The published file must not exceed 2 MiB (2,097,152 bytes), the AGH daemon's download limit. This check is offline and does not verify that a release tag exists.

If `main` advances while your PR is open, update your branch and let the checks run on the new head.

### Release review (report only)

Open the `market / review-release` report for the latest PR commit and check the findings. It scans the PR title, description, and proposed commit history for credentials, then checks added or updated indexed releases. It verifies the public `vX.Y.Z` tag and pinned commit, checks public submission proof where required, checks the root manifest, declared entry files and assets, and scans text files (including committed build output) and filenames with Gitleaks. These static checks cannot establish that a plugin is safe: they do not run plugins, install dependencies, recheck unchanged releases, or prove that binary media is safe.

For automatic public admission, a plugin row's `capabilities` must be an empty object (`{}`). A package with no plugin rows does not need a capability declaration. A release requesting capabilities goes to manual review.

| Result | Next step |
| --- | --- |
| `passed` | No findings from the configured checks. Eligible PRs may be merged by the publisher below; this is not a safety or installation guarantee. |
| `needs-review` | A maintainer must assess the specific findings, such as licensing, declared capabilities, install hooks, runtime dependencies, or sensitive APIs. Being outside `AgnesAI-Labs` is not by itself a finding for a proven public submission. |
| `failed` | Fix the indicated release or PR issue and push a new revision. For potential credentials, verify privately and revoke or rotate anything exposed before cleaning the history and submitting a clean release. The report does not include matching values or raw scanner output. |
| `incomplete` | Fix missing access or scan coverage, or retry a scanner or network failure. If a batch exceeds 12 changed releases, split the PR. |

This report is independent and advisory: it only reports findings and does not write repository contents, approve, or merge PRs. The publisher runs its own fresh review rather than trusting this status.

### Unattended review, merge, and publish

When enabled, **Market release publisher** runs after a successful PR index check and every ten minutes. Each audit selects at most one open, non-draft PR to `main`. The PR must change `docs/index.json` and may also change `plugins.txt`; no other files may change. These changes can qualify:

- A single new public listing that follows the submission rules above. Any GitHub user authorized by the exact release's `agh.market.json` can submit it, including from a fork.
- A version update to an existing public listing in its repository-owner namespace that follows the pin and release-proof rules above, or a version update to an already indexed repository on the legacy allowlist in [`tools/publish-release.mjs`](tools/publish-release.mjs). The legacy allowlist includes `AgnesAI-Labs/agh-app-devboard`, `AgnesAI-Labs/agh-app-pharma-gmp`, and `AgnesAI-Labs/agh-app-aerospace-quality`.
- A presentation-only change from a branch in this repository (not a fork): only the catalog's top-level `title` or `description` may change, with no changes to plugin entries or `plugins.txt`.

Changes outside these categories, and repository or tooling changes (including changes to the legacy allowlist), require manual review and merge. The read-only audit uses trusted `main` code, never checks out or executes contributor code, and runs fresh index validation and release review against the current PR head. Only `passed` can proceed; `needs-review`, `failed`, and `incomplete` never qualify for automatic merge.

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

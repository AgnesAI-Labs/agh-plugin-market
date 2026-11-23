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

### Submit a new public plugin

Follow the [public plugin submission guide](docs/submit-plugin.md) to prepare a release, open a market PR, and confirm publication. It also covers updates and removals.

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

### Behavioral code review (report only)

`market / code-review` links to a separate Semgrep report for the PR revision. It analyzes tracked JavaScript and TypeScript, including checked-in build output, in the exact tagged commits of new or changed listings. On updates it compares file contents with the previous indexed release. Initial rules look for sensitive data flowing into a network request and downloaded content flowing into execution. Findings explain the behavior to check and link to the pinned file and line when its path can be safely displayed.

These are signals for human review, not findings of malicious intent. The rules do not cover all languages, cross-file flows, runtime behavior, or ordinary correctness bugs. A report distinguishes unavailable or incomplete scans from no findings and from no applicable code. The job does not execute the plugin or install its dependencies. **The publisher neither waits for this report nor uses its result.** A PR may be merged under the existing rules before the report is available, even if the report later identifies a finding.

### Unattended review, merge, and publish

When enabled, **Market release publisher** runs after a successful PR index check and every ten minutes. Each audit selects at most one open, non-draft PR to `main`. The PR must change `docs/index.json` and may also change `plugins.txt`; no other files may change. These changes can qualify:

- A single new public listing that follows the submission rules above. Any GitHub user authorized by the exact release's `agh.market.json` can submit it, including from a fork.
- A version update to an existing public listing in its repository-owner namespace that follows the pin and release-proof rules above, or a version update to an already indexed repository on the legacy allowlist in [`tools/publish-release.mjs`](tools/publish-release.mjs). The legacy allowlist includes `AgnesAI-Labs/agh-app-devboard`, `AgnesAI-Labs/agh-app-pharma-gmp`, and `AgnesAI-Labs/agh-app-aerospace-quality`.
- A presentation-only change from a branch in this repository (not a fork): only the catalog's top-level `title` or `description` may change, with no changes to plugin entries or `plugins.txt`.

Changes outside these categories, and repository or tooling changes (including changes to the legacy allowlist), require manual review and merge. The read-only audit uses trusted `main` code, never checks out or executes contributor code, and runs fresh index validation and release review against the current PR head. Only `passed` can proceed; `needs-review`, `failed`, and `incomplete` never qualify for automatic merge.

An isolated merge job uses the repository's short-lived `GITHUB_TOKEN` and requests a merge for the audited commit only. It does not post approvals or bypass any rule: GitHub still requires a pull request and the strict `market / validate-index` check (the PR must be up to date). No GitHub App, PAT, organization administrator, or bypass actor is needed.

GitHub Actions publishes the index, both catalog pages, and both README previews together on GitHub Pages. The pages and previews are generated from the validated index after automatic and manual catalog merges; no README writeback or bot-authored PR is needed. The [public index URL](https://agnesai-labs.github.io/agh-plugin-market/index.json) is unchanged. The deployment verifies the published index and catalog assets byte for byte. If verification fails after a merge, retry **Market Pages** on `main` rather than merging again.

**Repository admin setup and controls**

1. Keep the `main` pull request rule and strict `market / validate-index` requirement with GitHub Actions as the check source. Do not add bypass actors. In **Settings → Pages → Build and deployment → Source**, switch from **Deploy from a branch** (`main:/docs`) to **GitHub Actions**.
2. On `main`, use **Market release publisher → Run workflow** with `dry_run` checked (the default). This runs the audit without merging or deploying, even with automatic publishing disabled.
3. Set the repository Actions variable `MARKET_PUBLISHER_ENABLED` to `true` to enable automatic merges or run manually with `dry_run` unchecked. Removing the variable or setting it to `false` disables new automatic merges, not Pages deployments from manual merges. To stop urgently, also cancel active publisher runs; cancellation does not undo a merge that already happened.
4. To roll back the deployment setup, disable the publisher and switch Pages back to **Deploy from a branch → `main` → `/docs`**, then verify the same public index URL. Branch-based publishing serves the index but does not generate the catalog pages or previews. To undo a published catalog change, merge a revert PR through the normal checks and verify the resulting deployment.

## Listed plugins

[Browse the live plugin catalog](https://agnesai-labs.github.io/agh-plugin-market/plugins.html) for selectable text, repository links, and the latest published versions. GitHub may cache the preview below; the catalog page is the reference if they differ.

[![Preview of the AGH plugin catalog: plugin names, packages, and latest stable versions](https://agnesai-labs.github.io/agh-plugin-market/plugins.svg)](https://agnesai-labs.github.io/agh-plugin-market/plugins.html)

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

For new entries and versions, copy `agnes.provides` to the index's `provides` and copy `engines.agh` exactly from the pinned root `package.json`. Keep retained versions unchanged even if they lack `engines.agh`. Older versions without `provides` stay unclassified. `publishTimestamp` records Git committer time in seconds (`%ct`), not publication time.

Use `node tools/project-provides.mjs --write PACKAGE@VERSION` to fill in only `provides` for a submission. `node tools/build-index.mjs <dir-with-clones>` still rebuilds the index from local clones using one release tag per repository. Do not use the rebuild command for a submission or an existing version's metadata.

## List your plugin

### Submit a new public plugin

Follow the [public plugin submission guide](docs/submit-plugin.md) to prepare a release, open a market PR, and confirm publication. It also covers updates and removals.

If your new or updated plugin has a UI, see [how to choose and test it before submission](docs/submit-plugin.md#plugin-ui-before-submission).

Before opening a market PR for a new listing or version, add the `agh-plugin` Topic to the plugin repository. The required `market / validate-index` check verifies the Topic, then checks `provides`, `engines.agh`, and Git committer time against the exact public pin. The range records the author's compatibility declaration, not an installation or compatibility test. Unchanged versions are not fetched.

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

When enabled, **Market release publisher** runs after a successful PR index check and every ten minutes. Each audit selects at most one open, non-draft PR to `main`. The PR must change `docs/index.json` and may also change `plugins.txt` and the generated catalog tables in the two root READMEs. The publisher checks that the complete READMEs exactly match the base versions with only the expected table updates. Changes outside the generated tables, or to any other files, require a reviewed merge. These catalog changes can qualify:

- A single new public listing that follows the submission rules above. Any GitHub user authorized by the exact release's `agh.market.json` can submit it, including from a fork.
- A version update to an existing public listing in its repository-owner namespace that follows the pin and release-proof rules above, or a version update to an already indexed repository on the legacy allowlist in [`tools/publish-release.mjs`](tools/publish-release.mjs). The legacy allowlist includes `AgnesAI-Labs/agh-app-devboard`, `AgnesAI-Labs/agh-app-pharma-gmp`, and `AgnesAI-Labs/agh-app-aerospace-quality`.
- A presentation-only change from a branch in this repository (not a fork): only the catalog's top-level `title` or `description` may change, with no changes to plugin entries or `plugins.txt`.

Changes outside these categories, including historical metadata maintenance, require manual review and merge. The read-only audit uses trusted `main` code and runs fresh validation and release review against the current PR head. It never checks out or executes contributor code. Only `passed` can proceed; `needs-review`, `failed`, and `incomplete` never qualify for automatic merge.

An isolated merge job uses the repository's short-lived `GITHUB_TOKEN` and requests a merge for the audited commit only. It does not post approvals or bypass any rule: GitHub still requires a pull request and the strict `market / validate-index` check (the PR must be up to date). No GitHub App, PAT, organization administrator, or bypass actor is needed.

Generate the two README tables with `node tools/sync-readmes.mjs` from the market checkout and include them in the same PR as the catalog change. GitHub Actions checks both tables against the index. The tables update in the same merge; no separate README PR or credentials beyond your own GitHub account are needed. The [public index URL](https://agnesai-labs.github.io/agh-plugin-market/index.json) is unchanged.

**Market Pages** builds and uploads the site before a separate job deploys it and verifies the live index and catalog assets byte for byte against that artifact. Both manual and automatic publication share one lock from checkout through verification. If publication or verification fails after a merge, start a fresh **Actions → Market Pages → Run workflow** on `main`. Do not rerun only the deployment job, rerun the automatic publisher, or merge the PR again.

**Repository admin setup and controls**

1. Keep the `main` pull request rule and strict `market / validate-index` requirement with GitHub Actions as the check source. Do not add bypass actors. The publisher requires Pages to use **GitHub Actions** as its source.
2. On `main`, use **Market release publisher → Run workflow** with `dry_run` checked (the default). This runs the audit without merging or deploying, even with automatic publishing disabled.
3. Set the repository Actions variable `MARKET_PUBLISHER_ENABLED` to `true` to enable automatic merges or run manually with `dry_run` unchecked. Removing the variable or setting it to `false` disables new automatic merges, not Pages deployments from manual merges. To stop urgently, also cancel active publisher runs; cancellation does not undo a merge that already happened.
4. To roll back the deployment setup, disable the publisher and switch Pages back to **Deploy from a branch → `main` → `/docs`**, then verify the same public index URL. Branch-based publishing serves the index but does not generate the catalog HTML or legacy SVG assets. To undo a published catalog change, merge a revert PR through the normal checks and verify the resulting deployment.

**Maintaining the submission process.** Any PR that changes the contributor-facing format, steps, eligibility, checks, or README sync must update both the [English](docs/submit-plugin.md) and [Chinese](docs/submit-plugin.zh-CN.md) tutorials in the same PR. CI checks that tutorial edits are paired; reviewers must check that both guides describe the new behavior accurately. Catalog-only submissions and maintenance that does not change the contribution process do not need tutorial edits.

### Maintain historical plugin types

Start from current `main`. Run `node tools/project-provides.mjs --check --historical` to report missing fields or `node tools/project-provides.mjs --write --historical` to fill them from pinned Git objects. Only use `--historical` for existing releases. If the exact release tag is missing or points elsewhere, the tool requires the pin to equal or be an ancestor of the listed repository's default branch tip.

Pass one or more `PACKAGE@VERSION` arguments to process a smaller batch. GitHub allows 60 unauthenticated REST requests per hour per IP, shared with other requests. A check exits unsuccessfully when it reports pending writes. If a selected version cannot be verified, the tool reports why and writes nothing. Retry or select a verifiable batch. Leave fields missing when there is no proof or no declaration.

Open an index-only PR for enrichment. Open a separate index-only PR to remove any mistakenly added `provides` fields. The required check traces each removal to an index-only enrichment on trusted `main` history. A maintainer must verify that evidence before merging. Neither type of PR qualifies for unattended publication or needs a Topic check.

Do not add or change `engines.agh` in a type-maintenance PR. Missing or invalid ranges do not block historical type maintenance or removal of a listing.

## Listed plugins

[Browse the live plugin catalog on GitHub Pages](https://agnesai-labs.github.io/agh-plugin-market/plugins.html).

<!-- market-catalog:start -->

| Plugin | Package | Latest stable version |
| --- | --- | --- |
| [DevBoard R&#38;D lifecycle workbench](https://github.com/AgnesAI-Labs/agh-app-devboard) | `@agnes-showcase/devboard` | `3.8.0` |
| [Sableleaf GMP Quality Hub](https://github.com/AgnesAI-Labs/agh-app-pharma-gmp) | `@agnes-showcase/pharma-gmp` | `1.2.5` |
| [Aerospace programme quality](https://github.com/AgnesAI-Labs/agh-app-aerospace-quality) | `@agnes-showcase/aerospace-quality` | `1.1.4` |
| [DingTalk channel](https://github.com/lzc970718/agh-plugin-dingtalk) | `@agnes/channel-dingtalk` | `0.3.8` |
| [Feishu channel](https://github.com/lzc970718/agh-plugin-feishu) | `@agnes/channel-feishu` | `0.1.3` |
| [WeChat channel](https://github.com/lzc970718/agh-plugin-wechat) | `@agnes/channel-wechat` | `0.1.3` |
| [Shared Engineering Memory](https://github.com/wblxr408/agh-engineering-memory) | `@wblxr408/engineering-memory` | `0.2.0` |
| [Agnes startup animation](https://github.com/wblxr408/agh-plugin-startup-animation) | `@wblxr408/startup-animation` | `0.4.0` |
| [Knowledge Atlas](https://github.com/wblxr408/agh-plugin-knowledge-graph) | `@wblxr408/knowledge-graph` | `2.0.0` |
| [Qualitative Research](https://github.com/wblxr408/agh-plugin-qualitative-research) | `@wblxr408/qualitative-research` | `0.6.1` |
| [Agnes Harness Mountain Gate](https://github.com/wblxr408/agh-mountain-gate) | `@wblxr408/mountain-gate` | `2.0.0` |
| [Document Reconciliation](https://github.com/wblxr408/agh-plugin-messy-etl) | `@wblxr408/messy-etl` | `1.0.1` |
| [LLM Career Map](https://github.com/wblxr408/agh-plugin-career-map) | `@wblxr408/career-map` | `1.0.0` |
| [ADRS Research Desk](https://github.com/wblxr408/agh-plugin-adrs) | `@wblxr408/adrs` | `1.0.0` |
| [ContextRail Evidence Handoff](https://github.com/wblxr408/agh-plugin-contextrail) | `@wblxr408/contextrail` | `1.0.0` |
| [SubmitFlow Job Tracker](https://github.com/wblxr408/agh-plugin-submitflow) | `@wblxr408/submitflow` | `1.0.0` |
| [Troubleshooting Skill Distiller](https://github.com/wblxr408/agh-plugin-field-distiller) | `@wblxr408/field-distiller` | `1.0.0` |
| [Research Workflows](https://github.com/wblxr408/agh-plugin-research-workflows) | `@wblxr408/research-workflows` | `1.0.0` |
| [Learning Card Workflow](https://github.com/wblxr408/agh-plugin-learning-card-workflow) | `@wblxr408/learning-card-workflow` | `1.0.0` |
| [Project Delivery Workflows](https://github.com/wblxr408/agh-plugin-delivery-workflows) | `@wblxr408/delivery-workflows` | `1.0.0` |
| [BugHunter Defensive Code Review](https://github.com/wblxr408/agh-plugin-bughunter-code-review) | `@wblxr408/bughunter-code-review` | `1.0.0` |
| [ARTEX Audit Evidence Review](https://github.com/wblxr408/agh-plugin-artex-evidence-review) | `@wblxr408/artex-evidence-review` | `1.0.0` |
| [Video Editing Studio](https://github.com/wblxr408/agh-video-editing-studio) | `@wblxr408/video-editing-studio` | `2.0.0` |
| [Reactive Resume](https://github.com/yuhe520521/agh-plugin-reactive-resume) | `@yuhe520521/reactive-resume` | `0.2.0` |
| [BugX Autonomous Code Review](https://github.com/Bencibr/agh-plugin-bugx) | `@bencibr/bugx` | `0.1.4` |
| [Agnes Desktop Pet](https://github.com/wblxr408/agh-desktop-pet) | `@wblxr408/desktop-pet` | `0.1.3` |

<!-- market-catalog:end -->

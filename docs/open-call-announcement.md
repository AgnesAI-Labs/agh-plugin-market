# The AGH Plugin Market is open for community submissions

English | [简体中文](open-call-announcement.zh-CN.md)

Built a useful tool, skill, UI extension, or workflow for Agnes Harness? Share it on the **AGH Plugin Market** so other users can discover it under **Plugins → Market**.

**Anyone with a GitHub account can submit a plugin.** No AgnesAI-Labs membership or allowlist entry is required. You keep maintaining the plugin in your own public GitHub repository; the market lists a specific release commit.

## How to submit

1. In your public plugin repository, prepare `package.json` and `agh.market.json`, authorize the GitHub account that will open the PR, and push a stable `vX.Y.Z` tag.
2. Fork [`agh-plugin-market`](https://github.com/AgnesAI-Labs/agh-plugin-market), add your listing to `plugins.txt` and `docs/index.json`, and open a PR against the upstream `main` branch.
3. Check the automated review report on your PR. Eligible submissions are **merged and published automatically, without manual approval**. If your submission doesn't pass, address the findings and push to the same PR to rerun the checks.

Submitting for the first time? The [English submission guide](submit-plugin.md) includes copyable examples, publication checks, and instructions for updates and common review findings.

# AGH 插件市场现已开放社区投稿

[English](open-call-announcement.md) | 简体中文

你为 Agnes Harness 做了好用的工具、技能、界面扩展或工作流？欢迎提交到 **AGH 插件市场**，让更多用户在「插件 → 市场」里发现它。

**任何 GitHub 用户都可以投稿**，不需要加入 AgnesAI-Labs，也不需要申请白名单。插件继续由你在自己的公开 GitHub 仓库中维护；市场索引指向具体的发版提交。

## 如何投稿

1. 在你的公开插件仓库中准备 `package.json` 和 `agh.market.json`，授权将要发起 PR 的 GitHub 账号，并发布稳定版 `vX.Y.Z` tag。
2. Fork [`agh-plugin-market`](https://github.com/AgnesAI-Labs/agh-plugin-market)，在 `plugins.txt` 和 `docs/index.json` 中添加插件记录，在市场仓库根目录运行 `node tools/sync-readmes.mjs`，并将两份自动生成的 README 表格一并提交到原仓库 `main` 的同一个 PR。
3. 在 PR 中查看自动审核报告。符合规则的投稿会**自动合并并上架，无需人工批准**；未通过的投稿不会自动合并，可以按报告修正后推送到同一 PR，重新运行检查。

第一次投稿？[中文上架教程](submit-plugin.zh-CN.md)提供可复制的示例，也说明了如何确认上架、更新版本和处理常见审核问题。

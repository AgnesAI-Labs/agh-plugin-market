# AGH 插件市场

[English](README.md) | 中文

[Agnes Harness](https://github.com/AgnesAI-Labs/agnes-harness)（AGH）的官方插件市场索引。AGH 不做中心化商店：每个插件都放在自己的 GitHub 仓库里，社区发布的插件也可以收录。

- `plugins.txt`：来源列表，一行一个 Git 仓库。
- `docs/index.json`：对外发布的索引，经 GitHub Pages 提供，AGH 的「插件 → 市场」读取它。

## 格式

`index.json` 沿用 DeepSeek Harness 插件市场索引的 format 1（DSH 的 `packages/util/plugin-market-index`），可以用同一套读取与校验逻辑。与 DSH 有四处不同：

- 运行环境要求写在 `engines.agh`，而不是 `engines.dsh`；
- 判断一个包是不是插件，看 `package.json` 里有没有 `agnes` 声明，而不是 `dsh.bundle`；
- Git 版本 `{ "type": "git", "url": U, "commit": C }` 用 `agh plugins add git:U#C` 安装；
- 语言键用小写（`zh-cn`），这是 format 1 的要求；AGH 读取时再对应到自己的语言标识。

每个版本都固定到对应发版 tag 的提交。完整的生成工具做好之前，用 `node tools/build-index.mjs <放各仓库克隆的目录>` 从本地克隆重建索引（每个仓库取最新的发版 tag）。产出的索引能通过 DSH format 1 的校验。

## 上架你的插件

### 提交新的公开插件

请阅读[公开插件上架教程](docs/submit-plugin.zh-CN.md)，按步骤准备插件和发版授权、提交并检查市场 PR，以及确认上架、更新版本或下架。

### 发版审核（仅报告）

打开 `market / review-release` 链接，查看 PR 最新提交的报告和具体发现。它扫描 PR 标题、描述和拟合入的提交历史中的凭据，再审核索引里新增或更新的版本。它核对公开的 `vX.Y.Z` tag 与固定提交，在需要时验证公开投稿的授权文件，检查根清单、声明入口和资源，并用 Gitleaks 扫描文本文件（含已提交的构建产物）和文件名。这些静态检查不能证明插件安全：它们不运行插件、不安装依赖、不重查未改动的版本，也不保证二进制媒体安全。

公开投稿走自动准入时，插件行的 `capabilities` 必须是空对象（`{}`）。没有插件行的包无需声明能力；申请了能力的版本转人工审核。

| 结果 | 怎么处理 |
| --- | --- |
| `passed` | 配置的检查没有发现问题。符合下文条件的 PR 可由发布作业自动合并；这不保证插件安全或可安装。 |
| `needs-review` | 维护者人工核查报告列出的原因，例如许可证、声明能力、安装脚本、运行时依赖或敏感 API。公开投稿通过授权验证后，不属于 `AgnesAI-Labs` 本身并不构成问题。 |
| `failed` | 修复报告所指的版本或 PR 问题并推送。疑似凭据请私下核查；已泄露的先吊销或轮换，再清理历史、提交干净发版。报告不展示命中值或扫描器原始输出。 |
| `incomplete` | 解决访问或扫描覆盖问题，或在扫描器、网络恢复后重试。一次超过 12 个变更版本时请拆 PR。 |

此报告独立运行，仅报告检查结果，不修改仓库内容，也不批准或合并 PR。下方的发布作业会重新审核，不以此报告的状态作为合并依据。

### 无人值守审核、合并和发布

启用后，**Market release publisher** 在 PR 索引检查通过后运行，并每十分钟再检查一次。每次最多选择一个目标为 `main`、仍打开且非草稿的 PR。PR 必须改动 `docs/index.json`，可以同时改动 `plugins.txt`，不得改动其他文件。以下变更有资格自动合并：

- 按上述规则新增一个公开插件。任何获得该版本 `agh.market.json` 授权的 GitHub 用户都可以投稿，也可以从 fork 提交。
- 更新使用仓库所有者作用域的已收录公开插件版本，且符合上述固定提交和发版授权规则；或更新已收录且在 [`tools/publish-release.mjs`](tools/publish-release.mjs) 原有白名单中的仓库版本。原有名单包括 `AgnesAI-Labs/agh-app-devboard`、`AgnesAI-Labs/agh-app-pharma-gmp` 和 `AgnesAI-Labs/agh-app-aerospace-quality`。
- 仅修改市场展示文案，且 PR 的源分支必须在本仓库中（不能来自 fork）。只能修改索引顶层的 `title` 或 `description`，不得修改插件条目或 `plugins.txt`。

超出上述类别的变更，以及仓库维护或工具变更（包括原有白名单的变更），都须人工审核并合并。只读审核作业使用可信的 `main` 代码，不检出或执行投稿者的代码，并针对 PR 当前提交重新验证索引和审核发版。只有 `passed` 可以自动合并，`needs-review`、`failed` 和 `incomplete` 均不行。

独立的合并作业使用仓库内置的短期 `GITHUB_TOKEN`，仅请求合并已经审核的提交。它不会提交批准，也不会绕过规则：GitHub 仍要求通过 PR 合并，并通过严格的 `market / validate-index` 检查（PR 必须跟上 `main`）。无需 GitHub App、PAT、组织管理员或具有绕过权限的账号。

自动合并后，GitHub Actions 会显式将 `docs/index.json` 和 `docs/.nojekyll` 部署到 Pages；手动合并到 `main` 的这两个文件的变更也会发布。[线上索引地址](https://agnesai-labs.github.io/agh-plugin-market/index.json)不变。发布验证会逐字节比较线上索引与提交中的文件。如果合并后验证超时，请用作业报告的 SHA 排查或重试 Pages 部署，不要重复合并。

**仓库管理员配置与停用**

1. 保留 `main` 上的 PR 规则和严格的 `market / validate-index` 必过检查，检查来源设为 GitHub Actions。不要添加可绕过规则的账号。在 **Settings → Pages → Build and deployment → Source** 中，将来源从 **Deploy from a branch**（`main:/docs`）切换到 **GitHub Actions**。
2. 在 `main` 上通过 **Market release publisher → Run workflow** 运行作业，保留默认勾选的 `dry_run`。即使未启用自动发布，也可用此模式执行审核，不会合并或部署。
3. 将仓库 Actions 变量 `MARKET_PUBLISHER_ENABLED` 设为 `true`，即可启用自动合并，也可取消勾选 `dry_run` 手动发起。删除变量或设为 `false` 将停止新的自动合并，但不影响手动合并后触发的 Pages 部署。紧急停止时，还需取消正在运行的发布作业；取消不能撤销已完成的合并。
4. 如需回退部署配置，先停用自动发布，再将 Pages 来源切回 **Deploy from a branch → `main` → `/docs`**，然后确认原线上地址可正常访问。如需撤销已发布的索引变更，请提交回退 PR，按正常流程通过检查后合并，再验证部署结果。

## 已收录

| 仓库 | 包名 |
|---|---|
| [agh-app-devboard](https://github.com/AgnesAI-Labs/agh-app-devboard) | `@agnes-showcase/devboard` |
| [agh-app-pharma-gmp](https://github.com/AgnesAI-Labs/agh-app-pharma-gmp) | `@agnes-showcase/pharma-gmp` |
| [agh-app-aerospace-quality](https://github.com/AgnesAI-Labs/agh-app-aerospace-quality) | `@agnes-showcase/aerospace-quality` |
| [钉钉渠道](https://github.com/lzc970718/agh-plugin-dingtalk) | `@agnes/channel-dingtalk` |
| [飞书渠道](https://github.com/lzc970718/agh-plugin-feishu) | `@agnes/channel-feishu` |
| [微信渠道（个人微信）](https://github.com/lzc970718/agh-plugin-wechat) | `@agnes/channel-wechat` |

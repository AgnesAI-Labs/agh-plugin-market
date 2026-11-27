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

新收录的插件和新增版本必须从固定提交的根 `package.json` 复制 `agnes.provides` 到索引的 `provides`，并原样复制 `engines.agh`。保留的旧版本即使没有 `engines.agh`，也保持不变。没有 `provides` 的历史版本保持未分类。`publishTimestamp` 记录 Git 提交者时间（`%ct`），单位为秒，不是发版或上架时间。

投稿时运行 `node tools/project-provides.mjs --write PACKAGE@VERSION`，该命令只生成 `provides`。`node tools/build-index.mjs <放各仓库克隆的目录>` 仍可从本地克隆重建索引，每个仓库取一个发版 tag。不要用重建命令投稿或补录历史类型。

## 上架你的插件

### 提交新的公开插件

请阅读[公开插件上架教程](docs/submit-plugin.zh-CN.md)，按步骤准备插件和发版授权、提交并检查市场 PR，以及确认上架、更新版本或下架。

如果首次上架或更新的插件带有界面，请参阅[如何在投稿前选择和测试插件界面](docs/submit-plugin.zh-CN.md#plugin-ui-before-submission)。

首次上架或提交新版前，必须在插件仓库设置 `agh-plugin` 话题。`market / validate-index` 必过检查会核验话题，并用公开仓库中的确切固定提交复核 `provides`、`engines.agh` 和 Git 提交者时间。范围是作者的兼容性声明，不是安装或兼容性测试结果。没有改动的旧版本不会回源核验。

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

### 代码行为审核（仅报告）

`market / code-review` 链接到独立的 Semgrep 报告。它分析新增或更新版本的固定发版提交，覆盖 Git 中的 JavaScript、TypeScript 和已提交的构建产物；更新版本会和索引里已有的上一版比较文件内容。首批规则关注敏感数据进入网络请求，以及下载内容进入执行入口。报告解释需要核查的行为；能安全展示路径时，链接到固定提交的具体行。

报告给人工核查提供线索，不判定作者意图。规则不覆盖所有语言、跨文件数据流、实际运行行为或普通功能 bug；报告区分覆盖不足、未发现问题和没有适用代码。作业不执行插件，也不安装依赖。**发布器不等这份报告，也不读取它的结果。** PR 可能在报告生成前按现有规则合并，即使报告之后发现了问题。

### 无人值守审核、合并和发布

启用后，**Market release publisher** 在 PR 索引检查通过后运行，并每十分钟再检查一次。每次最多选择一个目标为 `main`、仍打开且非草稿的 PR。PR 必须改动 `docs/index.json`，可以同时改动 `plugins.txt` 和根目录两份 README 中的自动生成表格。发布器会验证两份 README 的完整内容与基准版本一致，只有预期的表格更新例外。表格外的改动或其他文件的改动须人工审核并合并。以下目录变更有资格自动合并：

- 按上述规则新增一个公开插件。任何获得该版本 `agh.market.json` 授权的 GitHub 用户都可以投稿，也可以从 fork 提交。
- 更新使用仓库所有者作用域的已收录公开插件版本，且符合上述固定提交和发版授权规则；或更新已收录且在 [`tools/publish-release.mjs`](tools/publish-release.mjs) 原有白名单中的仓库版本。原有名单包括 `AgnesAI-Labs/agh-app-devboard`、`AgnesAI-Labs/agh-app-pharma-gmp` 和 `AgnesAI-Labs/agh-app-aerospace-quality`。
- 仅修改市场展示文案，且 PR 的源分支必须在本仓库中（不能来自 fork）。只能修改索引顶层的 `title` 或 `description`，不得修改插件条目或 `plugins.txt`。

超出上述类别的变更（包括历史类型维护）须人工审核并合并。只读审核作业使用可信的 `main` 代码，针对 PR 当前提交重新验证索引及发版证明，不检出或执行投稿者的代码。只有 `passed` 可以自动合并，`needs-review`、`failed` 和 `incomplete` 均不行。

独立的合并作业使用仓库内置的短期 `GITHUB_TOKEN`，仅请求合并已经审核的提交。它不会提交批准，也不会绕过规则：GitHub 仍要求通过 PR 合并，并通过严格的 `market / validate-index` 检查（PR 必须跟上 `main`）。无需 GitHub App、PAT、组织管理员或具有绕过权限的账号。

在市场仓库根目录运行 `node tools/sync-readmes.mjs` 生成两份 README 表格，并随目录变更一起提交到同一个 PR。GitHub Actions 会用索引核对中英文表格，合并时一并更新，不需要另开 README PR，也不需要使用个人 GitHub 账号之外的凭据。[线上索引地址](https://agnesai-labs.github.io/agh-plugin-market/index.json)不变。

**Market Pages** 先构建并上传站点，再由独立作业部署，并将线上索引和目录文件与上传产物逐字节核对。手动与自动发布共用一把锁，从检出代码一直持有到验证结束。合并后若发布或验证失败，请在 `main` 上通过 **Actions → Market Pages → Run workflow** 发起一次新运行。不要只重跑部署作业、重跑自动发布器或重复合并 PR。

**仓库管理员配置与停用**

1. 保留 `main` 上的 PR 规则和严格的 `market / validate-index` 必过检查，检查来源设为 GitHub Actions。不要添加可绕过规则的账号。自动发布要求 Pages 的来源为 **GitHub Actions**。
2. 在 `main` 上通过 **Market release publisher → Run workflow** 运行作业，保留默认勾选的 `dry_run`。即使未启用自动发布，也可用此模式执行审核，不会合并或部署。
3. 将仓库 Actions 变量 `MARKET_PUBLISHER_ENABLED` 设为 `true`，即可启用自动合并，也可取消勾选 `dry_run` 手动发起。删除变量或设为 `false` 将停止新的自动合并，但不影响手动合并后触发的 Pages 部署。紧急停止时，还需取消正在运行的发布作业；取消不能撤销已完成的合并。
4. 如需回退部署配置，先停用自动发布，再将 Pages 来源切回 **Deploy from a branch → `main` → `/docs`**，然后确认原线上索引地址可正常访问。分支发布仍提供索引，但不会生成 HTML 目录页或旧版 SVG 目录文件。如需撤销已发布的索引变更，请提交回退 PR，按正常流程通过检查后合并，再验证部署结果。

**维护投稿流程。** 只要 PR 改变投稿者使用的格式、步骤、自动合并条件、检查项或 README 同步方式，就必须在同一个 PR 中更新[中文](docs/submit-plugin.zh-CN.md)和[英文](docs/submit-plugin.md)教程。CI 检查两份教程是否一起修改；审核时还要核对两份教程是否准确反映新流程。仅修改目录数据或不影响投稿流程的维护 PR 不必改教程。

### 维护历史版本类型

从最新的 `main` 开始。运行 `node tools/project-provides.mjs --check --historical` 查看缺失项，或运行 `node tools/project-provides.mjs --write --historical` 从固定 Git 对象补录。只对已上架版本使用 `--historical`。如果对应的发版 tag 缺失或指向其他提交，固定提交必须是所列仓库默认分支的当前提交，或是该提交的祖先。

可追加一个或多个 `PACKAGE@VERSION` 参数分批操作。GitHub 对同一 IP 的匿名 REST 请求总计每小时最多允许 60 次。有待补录的字段时，检查命令会以非零状态退出。任何选中版本无法核验时，工具会报告原因且不写入结果。可重试或选择能核验的批次。缺少证据或声明的版本不补录。

补录 PR 只改索引。纠正时另开只改索引的 PR，只删除误加的 `provides`。必过检查会从可信 `main` 历史追溯每个字段的补录提交，维护者核对证据后再合并。两类 PR 均不能自动发布，也不需复查旧仓库的话题。

维护历史版本类型时，不添加或修改 `engines.agh`。缺少范围或范围无效，不影响维护历史类型或下架插件。

## 已收录

[在 GitHub Pages 上打开实时插件目录](https://agnesai-labs.github.io/agh-plugin-market/plugins.zh-CN.html)。

<!-- market-catalog:start -->

| 插件 | 包名 | 最新稳定版 |
| --- | --- | --- |
| [DevBoard 研发全流程工作台](https://github.com/AgnesAI-Labs/agh-app-devboard) | `@agnes-showcase/devboard` | `3.8.0` |
| [沙叶 GMP 质量中枢](https://github.com/AgnesAI-Labs/agh-app-pharma-gmp) | `@agnes-showcase/pharma-gmp` | `1.2.5` |
| [航天研制质量应用](https://github.com/AgnesAI-Labs/agh-app-aerospace-quality) | `@agnes-showcase/aerospace-quality` | `1.1.4` |
| [钉钉渠道](https://github.com/lzc970718/agh-plugin-dingtalk) | `@agnes/channel-dingtalk` | `0.3.8` |
| [飞书渠道](https://github.com/lzc970718/agh-plugin-feishu) | `@agnes/channel-feishu` | `0.1.3` |
| [微信渠道](https://github.com/lzc970718/agh-plugin-wechat) | `@agnes/channel-wechat` | `0.1.3` |
| [共享工程知识库](https://github.com/wblxr408/agh-engineering-memory) | `@wblxr408/engineering-memory` | `0.2.0` |
| [Agnes 开场动画](https://github.com/wblxr408/agh-plugin-startup-animation) | `@wblxr408/startup-animation` | `0.4.0` |
| [知识图谱](https://github.com/wblxr408/agh-plugin-knowledge-graph) | `@wblxr408/knowledge-graph` | `2.0.0` |
| [访谈主题分析](https://github.com/wblxr408/agh-plugin-qualitative-research) | `@wblxr408/qualitative-research` | `0.6.1` |
| [Agnes Harness 山水入户](https://github.com/wblxr408/agh-mountain-gate) | `@wblxr408/mountain-gate` | `2.0.0` |
| [单据核对台](https://github.com/wblxr408/agh-plugin-messy-etl) | `@wblxr408/messy-etl` | `1.0.1` |
| [大模型学习与面试地图](https://github.com/wblxr408/agh-plugin-career-map) | `@wblxr408/career-map` | `1.0.0` |
| [深度研究任务台](https://github.com/wblxr408/agh-plugin-adrs) | `@wblxr408/adrs` | `1.0.0` |
| [任务交接与证据回读](https://github.com/wblxr408/agh-plugin-contextrail) | `@wblxr408/contextrail` | `1.0.0` |
| [岗位与投递工作台](https://github.com/wblxr408/agh-plugin-submitflow) | `@wblxr408/submitflow` | `1.0.0` |
| [排障记录转 Skill](https://github.com/wblxr408/agh-plugin-field-distiller) | `@wblxr408/field-distiller` | `1.0.0` |
| [科研工作流](https://github.com/wblxr408/agh-plugin-research-workflows) | `@wblxr408/research-workflows` | `1.0.0` |
| [概念解卡与学习卡](https://github.com/wblxr408/agh-plugin-learning-card-workflow) | `@wblxr408/learning-card-workflow` | `1.0.0` |
| [项目交付与 Skill 定制](https://github.com/wblxr408/agh-plugin-delivery-workflows) | `@wblxr408/delivery-workflows` | `1.0.0` |
| [BugHunter 防御代码审查](https://github.com/wblxr408/agh-plugin-bughunter-code-review) | `@wblxr408/bughunter-code-review` | `1.0.0` |
| [ARTEX 审计证据复核](https://github.com/wblxr408/agh-plugin-artex-evidence-review) | `@wblxr408/artex-evidence-review` | `1.0.0` |
| [视频剪辑台](https://github.com/wblxr408/agh-video-editing-studio) | `@wblxr408/video-editing-studio` | `2.0.0` |
| [Reactive Resume](https://github.com/yuhe520521/agh-plugin-reactive-resume) | `@yuhe520521/reactive-resume` | `0.2.0` |
| [BugX 自主代码审查](https://github.com/Bencibr/agh-plugin-bugx) | `@bencibr/bugx` | `0.1.4` |

<!-- market-catalog:end -->

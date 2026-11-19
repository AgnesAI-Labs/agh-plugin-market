# AGH 插件市场

[English](README.md) | 中文

[Agnes Harness](https://github.com/AgnesAI-Labs/agnes-harness)（AGH）的官方插件市场索引。AGH 不做中心化商店：每个插件都放在自己的 GitHub 仓库里，本仓库只列出官方插件。

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

1. 插件单独放一个 GitHub 仓库，`package.json` 放在仓库根目录，用 `vX.Y.Z` tag 发版。
2. 给仓库加上 GitHub 话题 `agh-plugin`，这样它会出现在 [github.com/topics/agh-plugin](https://github.com/topics/agh-plugin)。
3. 向 `main` 提 PR，同时提交加入仓库地址的 `plugins.txt` 和重新生成的 `docs/index.json`。

更新已收录的仓库时，保留 URL，再在 `plugins.txt` 添加一行 `# pin: https://github.com/OWNER/REPO 1.2.3 FULL_COMMIT_SHA`，填入实际的 40 位小写 Git 提交 SHA，版本不加 `v`。固定值必须和索引一致；替换唯一的已列版本时，若有旧固定行，一并移除。索引中保留的版本不得换绑提交。生成器可能扫入其他仓库的新 tag，审阅差异后再提交；CI 会拒绝未声明的更新。下架时同时移除 URL、对应的固定行和索引条目。

可在仓库根目录本地运行必需检查 `market / validate-index`：

```sh
node tools/validate-index.mjs "$(git rev-parse origin/main)"
```

索引检查覆盖 format 1、包名唯一性、Git 来源和 `plugins.txt` 一致性。发布文件不得超过 2 MiB（2,097,152 字节），这是 AGH daemon 的下载上限。该检查离线运行，不验证 tag 是否存在。

如果 PR 审核期间 `main` 有新提交，合并前先更新分支，等待检查在新提交上通过。

### 发版审核（仅报告）

`market / review-release` 链接到当前 PR 提交的报告。它扫描 PR 标题、描述和拟合入的提交历史中的凭据，再审核索引里新增或更新的版本。它核对公开的 `vX.Y.Z` tag 与固定提交，检查根清单、声明入口和资源，并用 Gitleaks 扫描 Git 文件树（含已提交的构建产物）。它不运行插件、不安装依赖、不重复审核未改动的版本。

| 结果 | 怎么处理 |
| --- | --- |
| `passed` | 配置的检查没有发现问题。继续正常审核；这不保证插件安全或可安装。 |
| `needs-review` | 人工核查被标记的发布者、许可证、敏感能力或未能扫描的内容。初始发布者策略将 `AgnesAI-Labs` 之外的仓库转人工，不表示组织下的仓库自动获得信任。 |
| `failed` | 修复报告所指的版本或 PR 问题并推送。疑似凭据请私下核查；已泄露的先吊销或轮换，再清理历史、提交干净发版。报告不展示命中值或扫描器原始输出。 |
| `incomplete` | 检查仓库和 tag 能否访问，或在扫描器、网络恢复后重试。一次超过 12 个变更版本时请拆 PR。 |

这是建议性报告，不改变合并条件，不批准、合并 PR，也不发布版本。

## 已收录

| 仓库 | 包名 |
|---|---|
| [agh-app-devboard](https://github.com/AgnesAI-Labs/agh-app-devboard) | `@agnes-showcase/devboard` |
| [agh-app-pharma-gmp](https://github.com/AgnesAI-Labs/agh-app-pharma-gmp) | `@agnes-showcase/pharma-gmp` |
| [agh-app-aerospace-quality](https://github.com/AgnesAI-Labs/agh-app-aerospace-quality) | `@agnes-showcase/aerospace-quality` |
| [钉钉渠道](https://github.com/lzc970718/agh-plugin-dingtalk) | `@agnes/channel-dingtalk` |
| [飞书渠道](https://github.com/lzc970718/agh-plugin-feishu) | `@agnes/channel-feishu` |
| [微信渠道（个人微信）](https://github.com/lzc970718/agh-plugin-wechat) | `@agnes/channel-wechat` |

# 把公开插件发布到 AGH 市场

[English](submit-plugin.md) · [市场仓库首页](../README.zh-CN.md)

这篇教程从准备插件仓库开始，一直讲到在 AGH 里找到已上架的版本。**插件仓库**存放代码和发版 tag；**市场仓库**记录从哪里安装、安装哪个提交，并展示中英文目录。只需开一个市场 PR，一起提交目录数据和自动生成的两份 README 表格。任何获得该版本授权的 GitHub 账号都可以从自己的 fork 投稿，不需要加入 AgnesAI-Labs，也不需要白名单、市场仓库的写权限或额外凭据。

开始前请准备 GitHub 账号、Git、文本编辑器和 Node.js 24（CI 也使用该版本）；GitHub CLI（`gh`）可选。下文用插件仓库 `https://github.com/Octo-Cat/agh-example`、包名 `@octo-cat/example` 和版本 `1.2.3` 举例。实际操作时，请替换示例中的仓库、包名和版本，以及标明的账号 ID、提交 SHA 和时间戳。

## 1. 准备公开的插件仓库

为插件使用一个独立的公开 GitHub 仓库，将 `package.json` 放在根目录。仓库地址采用 `https://github.com/OWNER/REPO`，不带 `.git`、末尾斜杠、查询参数或片段，不能依赖旧地址的重定向。包名写作 `@<小写的仓库所有者>/<名称>`，作用域必须对应 GitHub 用户名或组织名，不是显示名称。后半段以小写字母或数字开头，其余可用小写字母、数字、`.`、`_` 和 `-`；包名最长 214 个字符，在索引中必须唯一。`agnes`、`agnesai`、`agnes-ai`、`agnesai-labs`、`agnes-harness`、`agnes-showcase` 是保留作用域，不区分大小写。

`package.json` 的 `name` 和 `version` 必须与市场条目一致。`agnes.provides` 至少填写一种插件类型，各值不得重复，可选 `tool`、`loop`、`model-adapter`、`mcp`、`skills`、`ui`、`bundle`、`service`。这些标签只描述包里有什么，不授予权限。不要使用 `agnes.extensions` 或根目录下的 `agnes.extension.json`。如果已有插件，请保留实际的声明；下面是一份无需编写入口代码的只读 Bundle 示例：

```json
{
  "name": "@octo-cat/example",
  "version": "1.2.3",
  "license": "MIT",
  "agnes": {
    "provides": ["bundle"],
    "bundles": {
      "research": {
        "profile": {
          "toolPolicy": { "readOnly": true }
        }
      }
    }
  }
}
```

- 除了清单中的 `license`，还要在仓库根目录提交相应的 `LICENSE` 文件（审核也识别 `LICENCE` 或 `COPYING`）。示例用的是 MIT，请按实际授权填写。
- 如果声明了 `agnes.plugins`，每个插件条目都要有非空的 `export` 和 `apiRange`；有插件条目时，清单还要有 `main` 或 `exports`。自动准入要求每个显式插件条目的 `capabilities` 都是空对象 `{}`；上面的 Bundle 没有插件条目，不必补这个字段。确实需要能力时请如实声明，走人工审核，不要隐瞒权限。
- 入口、客户端描述文件及其入口和皮肤 CSS、图标等声明的本地资源，都必须在 tag 指向的 Git 提交中。如果入口指向构建产物，请在发版前把所需产物提交到 Git；只存在于本地、GitHub Release 附件或 npm 上的不算。准备插件时，可参阅 AGH 的[插件类型指南](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/extend/choose-a-plugin-type.zh-CN.md)和 [Bundle 指南](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/extend/bundles-and-profiles.zh-CN.md)。

### 将第三方 JS 依赖打包进发版产物

如果插件使用可以打包的纯 JavaScript 依赖，推荐在**发版前**用 esbuild、Rollup 等工具把依赖打进入口产物（例如 `dist/index.js`），而不是等用户安装插件后再下载依赖。

1. 打包入口时，把插件运行所需的第三方 JS 一起打进去。AGH 已提供的 SDK 模块应按 [Host 提供的依赖](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/extend/quickstart.zh-CN.md#host-提供的依赖)保留为外部模块，并按需在 `agnes.hostProvidedExternals` 声明兼容范围。
2. 让 `main` 或 `exports` 指向打包产物，把产物和第三方许可证或 `NOTICE` 一起提交到要打 tag 的提交。不提交 `node_modules`。AGH 从市场安装时读取固定的 Git 快照，不会因为仓库里有 npm 锁文件就运行 `npm ci`。
3. 只有确认发版产物不再需要单独加载某个包，才从发版清单的运行时依赖字段中移除它；构建仍需安装的包可以保留在 `devDependencies`。打 tag 前，建议用干净的 AGH 试用环境验证：不借用开发目录的 `node_modules`，确认插件能安装并正常使用。

仍需要独立加载依赖的版本会触发 `RUNTIME_DEPENDENCIES`，继续走人工审核。不要为了通过审核而隐瞒依赖。打包只解决依赖的分发问题：审核仍会扫描产物，其他自动上架规则不变。

## 2. 在插件版本中授权提交者

需要授权的是**在市场仓库发起 PR 的 GitHub 账号**，不是 Git 提交作者。提交者可以是发布者自己，也可以是受托投稿的其他人。获取这个账号的数字 ID：

- 有 GitHub CLI：用将要发起 PR 的账号登录（`gh auth login`），运行 `gh api user --jq .id`。
- 没有 GitHub CLI：在浏览器打开 `https://api.github.com/users/YOUR_GITHUB_LOGIN`，把 `YOUR_GITHUB_LOGIN` 换成提交者的 GitHub 登录名。在返回的 JSON 顶层读取 `id`，不要用 `login` 或 `node_id`。

由插件发布者在插件仓库根目录创建 `agh.market.json`，并在打 tag **之前**提交。这个文件只能有 `repository` 和 `submitters` 两个字段：

```json
{
  "repository": "https://github.com/Octo-Cat/agh-example",
  "submitters": [12345]
}
```

`12345` 是示例，换成实际 ID。`submitters` 可列 1–32 个互不重复的正安全整数，不加引号；`repository` 要与市场索引中的仓库一致（核对授权时不区分大小写）。公开 tag 表示发布者授权文件里的账号为**这个版本**投稿。把文件补到默认分支并不能授权一个旧 tag；审核只读该 tag 指向的提交。

## 3. 推送稳定版 tag，记录提交和时间戳

在**插件仓库**中，将 `package.json` 的 `version` 设为 `1.2.3`。版本须是三段数字，最长 128 个字符，不带前导零，也不带 `-beta` 或 `+build` 等后缀。如果还没提交发版文件，以本教程的 Bundle 为例：

```sh
git add -- package.json agh.market.json LICENSE
git commit -m 'Prepare release 1.2.3'
```

如果插件还有入口或资源，也要在提交之前用 `git add` 加入这些文件。确认发版提交包含所有所需文件后，为该提交打 `v1.2.3` tag。以下命令假设你是插件发布者、当前 `HEAD` 就是发版提交，且 `origin` 指向插件仓库。若插件仓库要求先走 PR，请按仓库流程合并后，切到包含发版提交的分支、拉取最新提交，再为实际发版提交打 tag：

```sh
git push origin HEAD
git tag -a v1.2.3 -m 'Release 1.2.3'
git push origin refs/tags/v1.2.3
```

不要求另建 GitHub Release，也不要求发布到 npm。可以在插件仓库首页 **About** 中添加 `agh-plugin` 话题，方便别人从 [GitHub 话题页](https://github.com/topics/agh-plugin)找到插件；加话题不等于上架。

仍在插件仓库中，取出 tag 所指的提交 SHA 和该提交的 Unix 时间戳（单位是秒），并确认清单和授权文件确实在该提交里：

```sh
RELEASE_SHA=$(git rev-parse 'v1.2.3^{commit}')
printf '%s\n' "$RELEASE_SHA"
git show -s --format=%ct "$RELEASE_SHA"
git show "$RELEASE_SHA:package.json"
git show "$RELEASE_SHA:agh.market.json"
```

再核对任何人能否直接从公开仓库访问到同一个 tag。以下命令禁用凭据助手、交互提示和 HTTP 重定向：

```sh
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c http.followRedirects=false ls-remote --exit-code \
  https://github.com/Octo-Cat/agh-example 'refs/tags/v1.2.3' 'refs/tags/v1.2.3^{}'
```

轻量 tag 只有 `refs/tags/v1.2.3` 一行，用这一行的 SHA；附注 tag（annotated tag）用 `refs/tags/v1.2.3^{}` 那一行解引用后的**提交** SHA，不用 tag 对象的 SHA。它应与上面的 `RELEASE_SHA` 相同，是 40 位小写十六进制字符串。**不要移动或重打已公开的 tag。** 如果发版提交有误，发布修正后的更高版本，再更新投稿。

## 4. 在市场仓库的 fork 中追加目录数据

打开 [AgnesAI-Labs/agh-plugin-market](https://github.com/AgnesAI-Labs/agh-plugin-market)，点 **Fork** 创建自己的副本。接下来的命令在**市场仓库的克隆**里执行，不是在插件仓库里。将 `YOUR_GITHUB_LOGIN` 换成 fork 所在的 GitHub 账号；以下假设你还没有克隆本地副本。若已克隆，只需确认 `origin` 指向 fork，并在尚未配置时添加 `upstream`。

```sh
git clone https://github.com/YOUR_GITHUB_LOGIN/agh-plugin-market.git
cd agh-plugin-market
git remote add upstream https://github.com/AgnesAI-Labs/agh-plugin-market.git
git fetch upstream main
git switch -c add-octo-cat-example upstream/main
```

首次上架需要在两个数据文件中追加记录。保留已有行和条目、它们的顺序以及索引顶层字段；两份 README 表格在下一步生成。

1. 在 [`plugins.txt`](../plugins.txt) 最后追加**一行**标准仓库 URL（示例为 `https://github.com/Octo-Cat/agh-example`），不要加 `# pin:` 行。
2. 在 [`docs/index.json`](index.json) 的 `plugins` 数组末尾追加**一个**条目，条目里只有**一个**稳定版本。下面是可单独复制的 JSON 对象，不是完整索引。加在原有最后一个对象和 `plugins` 数组的 `]` 之间；在原对象之后加逗号分隔，新对象后不留尾逗号。不用重新生成或格式化整个索引。

```json
{
  "name": "@octo-cat/example",
  "repository": {
    "url": "https://github.com/Octo-Cat/agh-example"
  },
  "versions": [
    {
      "version": "1.2.3",
      "publishTimestamp": 1795086102,
      "source": {
        "type": "git",
        "url": "https://github.com/Octo-Cat/agh-example",
        "commit": "0123456789abcdef0123456789abcdef01234567"
      },
      "engines": {}
    }
  ]
}
```

把示例中的 `commit` 和 `publishTimestamp` 换成上一步查到的值。时间戳必须是正安全整数，不加引号；`version` 不加 `v`。`repository` 只含 `url`，`source` 只含 `type`、`url` 和 `commit`。`repository.url`、`source.url` 和 `plugins.txt` 里新增的 URL 要完全一致。没有最低运行环境要求时用 `engines: {}`；要注明 AGH 兼容范围，可在 `engines` 中只填写 `agh`，例如 `{"agh": ">=1.0.0"}`（范围是示例，请填实际要求）。`engines.agh` 必须是非空纯文本，最多 500 个 UTF-16 代码单元，不得含 `<` 或 `>`。

不写展示字段也能投稿。如果要加，只使用以下可选字段，不要在索引条目中放插件清单或自定义字段：

| 字段 | 规则 |
| --- | --- |
| `title`、`description` | 非空纯文本字符串，或以 `en`、`zh-cn` 之一或两者为键的对象。每段文本最多 500 个 UTF-16 代码单元，不得含 `<` 或 `>`。 |
| `homepage` | 与 `repository.url` 完全相同的 HTTPS 地址。 |
| `author` | 仓库所有者的 GitHub 用户名或组织名，匹配时不区分大小写。 |
| `metadata` | 只含 `keywords`、`labels`、`sortKeys`。`keywords` 可用 `[]` 或至多 32 个关键词，每个是非空纯文本，最长 64 个 UTF-16 代码单元且不含 `<` 或 `>`；`labels` 必须是 `[]`，`sortKeys` 必须是 `{}`。 |

## 5. 检查改动，向上游发起 PR

在市场仓库根目录生成两份 README 表格，按上游基准校验，再检查差异：

```sh
git fetch upstream main
node tools/sync-readmes.mjs
node tools/validate-index.mjs "$(git rev-parse upstream/main)"
git diff --stat upstream/main
git diff upstream/main
```

本地检查读取索引、来源列表和两份 README 表格，不访问插件仓库，也不验证 tag 或授权。它检查 format 1、唯一包名、GitHub 仓库与索引一一对应、稳定版本、完整提交 SHA，以及已收录的包、仓库和版本没有换绑，并核对表格与索引一致。四个文件都应为不可执行的普通文件，不能是软链接；AGH 下载索引的上限是 2 MiB（2,097,152 字节）。

首次上架的差异应只有一行来源、一个索引条目（及分隔逗号），以及两份 README 各一行生成记录。不要手改表格或周围的正文。确认后提交并推送到 fork：

```sh
git add -- plugins.txt docs/index.json README.md README.zh-CN.md
git commit -m 'List @octo-cat/example 1.2.3'
git push -u origin add-octo-cat-example
```

用授权文件中列出的账号登录 GitHub。在 fork 页面点 **Compare & pull request**，或者在上游的 **Pull requests → New pull request** 中选择 **compare across forks**。确认 **base repository** 为 `AgnesAI-Labs/agh-plugin-market`、**base** 为 `main`，**head repository** 为你的 fork、**compare** 为 `add-octo-cat-example`。标题写明插件名和版本；描述可以附上公开仓库、tag 和变更说明。选择 **Create pull request**，不要选草稿；已经是草稿的 PR 准备好后点 **Ready for review**。不要在标题、描述或提交中放任何凭据。

如果上游 `main` 在审核期间前进，请在投稿分支中更新，不要让验证停留在旧提交上：

```sh
git fetch upstream main
git merge --no-commit upstream/main
```

如果来源列表或索引发生冲突，先保留上游的新行和条目，再把自己的 URL 和条目各追加一次，移除冲突标记。如果上游已收录该插件，请不要重复追加，改用下文的更新流程。仅改目录的 PR 应以两份上游 README 为基准，即使 README 没有冲突，也从上游恢复后再用解决冲突后的索引重新生成表格：

```sh
git restore --source=upstream/main --worktree -- README.md README.zh-CN.md
node tools/sync-readmes.mjs
node tools/validate-index.mjs "$(git rev-parse upstream/main)"
git diff upstream/main
git add -- plugins.txt docs/index.json README.md README.zh-CN.md
```

如果合并尚未完成，运行 `git merge --continue`；否则提交新生成的改动。推送到原分支，让现有 PR 更新并等待新提交上的检查。引入 README 表格之前已打开的 PR 也按这个流程更新。

## 6. 看懂检查和审核报告

在 PR 的检查列表中查看**最新提交**的结果。`market / validate-index` 是必过检查；如果日志提示表格过期，请同步上游、运行 `node tools/sync-readmes.mjs`，再提交并推送两份表格。`market / review-release` 是只读报告，不会批准或合并 PR，也不是 GitHub 的必过检查。索引检查通过不代表发版审核也通过；启用自动发布时，`Market release publisher` 会用可信的 `main` 代码对当前 PR 提交重新做索引检查和发版审核。PR 必须仍打开、不是草稿、跟上 `main` 且可合并，才能进入自动发布流程；只有这次复查结果为 `passed` 才可能自动合并。

审核把 PR 和插件仓库内容当作不可信数据，不检出或运行投稿代码，也不安装依赖。它核对公开 tag、授权文件和清单，查找入口与资源，并用 Gitleaks 扫描 PR 标题、描述、拟合入的提交历史，以及新版本中的文本（含已提交的构建产物）和文件名。不重查未改动的版本，也不验证已识别媒体的二进制内容；通过静态检查不等于插件安全或一定可安装。

新增或更新版本还会收到 `market / code-review` [代码行为报告](../README.zh-CN.md#代码行为审核仅报告)，可能附上待核查的文件和行号。它不参与合并判断，也可能在合并后才生成。下表的结果指 `market / review-release`，不是 `market / code-review`。

| 结果 | 你可以怎么做 |
| --- | --- |
| `passed` | 配置的检查没有发现问题。符合自动发布条件的 PR 可以等待合并；报告本身并不触发或保证合并。 |
| `failed` | 按报告修改 PR；如果问题在已发布的 tag 中，则发布一个新版本，不改旧 tag。修好后推送到同一市场 PR。 |
| `needs-review` | 不会自动合并。若确实需要能力、安装钩子、运行时依赖或敏感 API，请在 PR 中说明其用途，等待维护者人工审核。不要删掉真实的能力声明来换取通过。 |
| `incomplete` | 不会自动合并。排查仓库访问、文件覆盖范围或工具故障；遇到网络或扫描器故障，待恢复后再重跑或请维护者重跑。 |

常见发现代码：

- `PUBLIC_SCOPE`：包作用域不符合仓库所有者规则，或使用了保留作用域。`PUBLIC_PROOF`：检查 tag 中的 `agh.market.json`、仓库地址和 PR 发起者的数字 ID；若发起者用错了账号，用已授权的账号重新开 PR。`PUBLIC_IDENTITY` 表示没能读取 PR 账号的数字 ID，不是 Git 提交作者写错了。
- `TAG_MISSING`、`TAG_UNAVAILABLE`、`TAG_MISMATCH`：分别检查 tag 是否已推送、能否从标准公开地址直接读取、索引是否填了**提交** SHA。若只是索引填错，修正市场条目，不要移动 tag。
- `MANIFEST`、`ENTRY`、`LICENSE`：核对根清单的包名、版本和 `agnes` 声明，确认所有入口及资源已提交，并包含许可证声明和文件。
- `CAPABILITY_DECLARATION`、`PUBLIC_CAPABILITIES`、`CAPABILITY_REVIEW`：核对插件条目中的能力声明是否为对象、是否如实描述需要的能力。`INSTALL_HOOKS`、`RUNTIME_DEPENDENCIES`、`RUNTIME_APIS` 分别提示安装或打包生命周期脚本、运行时依赖、敏感 API（例如 `process.env`、`child_process`、`fetch`）；确有需要的交给维护者判断。
- `PR_SECRET`、`RELEASE_SECRET`：私下核查，不在 PR 里粘贴命中值。若凭据已暴露，先吊销或轮换，再清理标题、描述或拟合入的历史；发版树有问题时，提交干净的新版本。删除最新文件中的一行不能清除历史中的泄露。报告不会展示命中值或原始扫描器输出。
- `COVERAGE`、`OPAQUE`、`PR_BINARY`：检查软链接、子模块、Git LFS 指针、通配符导出、不受支持的路径、压缩包或未知二进制。不要提交无关的 `node_modules` 或 `fixtures/out`；审核上限为每文件 8 MiB、合计 40 MiB、最多 4,000 个文件。`LIMIT` 表示一次审核超过 12 个变更版本，拆成多个 PR；`SCAN_FAILED` 表示扫描未完成。

## 7. 确认部署和上架

PR 合入上游 `main` 后，[中文](../README.zh-CN.md#已收录)和[英文](../README.md#listed-plugins) README 表格会一并更新，无需另开 PR。到市场仓库的 **Actions** 查看 Pages 部署；在[线上目录](https://agnesai-labs.github.io/agh-plugin-market/plugins.zh-CN.html)中查找包名，并在[线上索引](https://agnesai-labs.github.io/agh-plugin-market/index.json)中核对版本和提交 SHA。线上索引里能找到正确记录，才说明这一版已经对外发布。

接着打开 AGH 的 **插件 → 市场**，按包名或标题搜索并查看版本。如果线上索引已更新、AGH 仍展示旧结果，可重新打开或刷新市场页面，稍后再查；AGH 可能还在使用本地缓存，页面刷新不一定会立即重新下载索引。如果 PR 已合并但线上索引还不对，查看部署作业的结果，不要为同一版本重复开 PR。

## 已上架后：发新版或下架

**更新公开插件：** 先按上面的流程发布更高的稳定版，确保新 tag 的提交中有有效的授权文件，并且授权了这次发起市场 PR 的账号。市场 PR 仍从最新的 `upstream/main` 创建分支；只更新数据中的相关 `versions` 和 `# pin:` 行，保持索引顶层字段、插件条目顺序、插件条目的非版本字段和来源 URL 行不变。新增的版本须严格高于该条目里原有的每一个版本；保留旧版本时，原版本记录（尤其提交 SHA）保持不变。可替换唯一的旧版本，但不能只删版本、不添加明确固定的新版本。

每个新增的版本都必须在 `plugins.txt` 中有一行匹配的固定记录。下面的 `1.2.4` 是更新示例；把示例 SHA 换成新 tag 对应的完整小写 SHA，并让 URL、版本和 SHA 与新增的索引版本一致。若从索引中移除了旧版本，也一并移除它的固定记录（如果有）。

```text
# pin: https://github.com/Octo-Cat/agh-example 1.2.4 0123456789abcdef0123456789abcdef01234567
```

按第 5 步重新生成、校验两份 README 表格，与目录数据一起暂存、提交并开 PR。仅修改插件展示信息不算可自动合并的版本更新。

**下架插件：** 在同一个 PR 中删除 `plugins.txt` 中的仓库 URL 及其所有固定记录，并删除 `docs/index.json` 中对应的插件条目。按第 5 步重新生成和校验两份 README 表格，将对应行的删除一起提交。下架不走自动合并，请说明原因并等候维护者人工处理。发布流程的维护侧说明见[市场仓库首页](../README.zh-CN.md#无人值守审核合并和发布)。

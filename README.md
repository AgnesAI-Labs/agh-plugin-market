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
3. To be listed here as well, open a pull request that adds your repository URL to `plugins.txt`.

## Listed plugins

| Repository | Package |
|---|---|
| [agh-app-devboard](https://github.com/AgnesAI-Labs/agh-app-devboard) | `@agnes-showcase/devboard` |
| [agh-app-pharma-gmp](https://github.com/AgnesAI-Labs/agh-app-pharma-gmp) | `@agnes-showcase/pharma-gmp` |
| [agh-app-aerospace-quality](https://github.com/AgnesAI-Labs/agh-app-aerospace-quality) | `@agnes-showcase/aerospace-quality` |
| [DingTalk channel](https://github.com/lzc970718/agh-plugin-dingtalk) | `@agnes/channel-dingtalk` |
| [Feishu channel](https://github.com/lzc970718/agh-plugin-feishu) | `@agnes/channel-feishu` |
| [WeChat channel](https://github.com/lzc970718/agh-plugin-wechat) | `@agnes/channel-wechat` |

# Submit a public plugin to the AGH Market

English | [简体中文](submit-plugin.zh-CN.md) · [Market repository](../README.md)

This guide takes you from a public GitHub plugin repository to a listing in **Plugins → Market** in Agnes Harness (AGH). Your plugin stays in your repository. You submit a two-file pull request (PR) to the market repository; the listing points to an exact Git commit rather than a branch or a moving tag.

You need a GitHub account, Git, a text editor, and permission to publish a tag in the plugin repository (or a maintainer who can publish it for you). Node.js is useful for the optional local index check; the market uses Node.js 24 in CI. There is no public-submitter allowlist or organization membership requirement. The release itself must authorize the account that opens the PR.

`Octo-Cat`, `agh-example`, `@octo-cat/example`, and `1.2.3` are examples throughout. Use your own repository owner, repository, package, and release version consistently in both repositories.

## 1. Prepare the plugin repository

Create or use your own **public** GitHub repository. Use its canonical URL, `https://github.com/OWNER/REPO`, without a `.git` suffix, final slash, query, or fragment. If the repository was moved or renamed, use its current URL, not a redirect.

Place `package.json` in the repository root. Name the package `@<lowercase-github-owner>/<name>`: for `https://github.com/Octo-Cat/agh-example`, use `@octo-cat/example`. The name after the slash starts with a lowercase letter or digit and can also contain `.`, `_`, and `-` after its first character. Keep the full package name at most 214 characters. The scopes `agnes`, `agnesai`, `agnes-ai`, `agnesai-labs`, `agnes-harness`, and `agnes-showcase` are reserved, regardless of case. The package version must be a stable `X.Y.Z` with no `v` prefix in the manifest, no prerelease or build suffix, and no leading zeroes in the components.

If you are starting from scratch, this is a minimal read-only [Bundle](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/extend/bundles-and-profiles.md). It publishes a profile that requests a read-only tool policy, without an executable plugin entry:

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

For your own package, choose the [plugin kind](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/extend/choose-a-plugin-type.md) that fits. `agnes.provides` must list at least one distinct label from `tool`, `loop`, `model-adapter`, `mcp`, `skills`, `ui`, `bundle`, and `service`. Do not use `agnes.extensions` or a root `agnes.extension.json` for a market plugin.

- Add a root `LICENSE` file with the terms you declare in `package.json` (`MIT` is only an example; a root `COPYING` file also counts). Both the manifest declaration and the file are checked.
- Commit the actual runtime files needed from Git, including build output if the manifest points to it. Local paths in `main`, `exports`, client descriptors and their entry or skin files, and declared icon or brand assets must resolve to files in the tagged tree. Use concrete export paths, not wildcard patterns. A package with explicit `agnes.plugins` entries needs `main` or `exports`; each entry needs a nonempty `export` and `apiRange`.
- For automatic public admission, every explicit `agnes.plugins` entry must have `"capabilities": {}`. A data-only Bundle like the example has no such entries and needs no capability declaration. Declare the capabilities you actually need: nonempty capabilities, install lifecycle scripts, runtime dependencies (including optional, peer, and bundled dependencies), or sensitive API references such as environment access, network calls, or child processes require manual review.
- Do not commit secrets or machine-local credentials. Keep the release reviewable: links, submodules, Git LFS pointers, unsupported or unsafe paths, `node_modules`, and `fixtures/out` leave gaps in review coverage. Opaque archives, native code, and unrecognized binary files are not covered; recognized media may be listed but its binary contents are not scanned. Keep the tagged tree within the review limits of 4,000 files, 8 MiB per file, and 40 MiB total.

Adding the `agh-plugin` topic in the repository's **About** settings is optional. It helps people browsing [GitHub topics](https://github.com/topics/agh-plugin), but does not replace this submission or affect inclusion in the index.

### Bundle third-party JavaScript for release

If your plugin uses pure JavaScript dependencies that can be bundled, use a tool such as esbuild or Rollup **before tagging the release**. Include those dependencies in the output (for example, `dist/index.js`) instead of relying on users to download them after installing the plugin.

1. Bundle the third-party JavaScript your entry needs at runtime. Keep SDK modules supplied by AGH external as described in [Host-provided dependencies](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/extend/quickstart.md#host-provided-dependencies), and declare compatible ranges in `agnes.hostProvidedExternals` as needed.
2. Point `main` or `exports` at the bundled output. Commit that output and the required third-party licenses or `NOTICE` files in the release commit. Do not commit `node_modules`. AGH installs the pinned Git snapshot from the market; an npm lockfile in the repository does not cause AGH to run `npm ci`.
3. Remove a package from runtime dependency fields only if the release output no longer needs to load it separately. Packages still needed at build time can stay in `devDependencies`. Before tagging, try installing and using the plugin in a clean AGH environment without your development checkout's `node_modules`.

Releases that still need separately loaded dependencies are flagged as `RUNTIME_DEPENDENCIES` and require manual review. Do not hide dependencies to pass review. Bundling changes how dependencies are delivered: the reviewer still scans the output, and the other automatic-admission rules still apply.

## 2. Authorize the account that will open the PR

Get the **numeric GitHub account ID** of the person who will click **Create pull request**. With GitHub CLI, sign in as that account and run:

```sh
gh api user --jq .id
```

Without GitHub CLI, open `https://api.github.com/users/YOUR-GITHUB-LOGIN` in a browser, replacing `YOUR-GITHUB-LOGIN` with that account's login, and read its top-level `id` (not `node_id`).

In the **plugin** repository root, create `agh.market.json`:

```json
{
  "repository": "https://github.com/Octo-Cat/agh-example",
  "submitters": [12345]
}
```

Replace the URL and `12345` with your canonical repository URL and the real account ID. The only allowed keys are `repository` and `submitters`; the URL must identify the same GitHub repository as the indexed source (case is ignored when checking this proof). List 1–32 distinct positive safe integers, without quotes. The check uses the account that opened the PR, not the author of a Git commit or the owner of the fork. The proof must be in the **exact tagged commit**; adding it later on the default branch will not authorize an older tag.

## 3. Publish and verify an immutable tag

In the **plugin** repository, commit the manifest, `agh.market.json`, license, and any required runtime files. Push that commit and tag it `vX.Y.Z` with the exact manifest version. For example, after committing the release, with `origin` pointing to the public plugin repository:

```sh
git push origin HEAD
git tag -a v1.2.3 -m 'Release 1.2.3'
git push origin refs/tags/v1.2.3
```

Record the commit SHA and its committer timestamp in Unix seconds (two separate values for the catalog):

```sh
RELEASE_SHA=$(git rev-parse 'v1.2.3^{commit}')
printf '%s\n' "$RELEASE_SHA"
git show -s --format=%ct "$RELEASE_SHA"
```

Verify the tag is accessible directly from the **public** repository without credentials or redirects:

```sh
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c http.followRedirects=false ls-remote --exit-code \
  https://github.com/Octo-Cat/agh-example 'refs/tags/v1.2.3' 'refs/tags/v1.2.3^{}'
```

For an annotated tag, compare the SHA on the `^{}` line (the peeled commit), not the tag object's SHA. A lightweight tag has just the tag line. The commit must match `RELEASE_SHA`, all 40 lowercase hexadecimal characters. If the release content needs a change after the tag is pushed, publish a new version and tag; never move or reuse the old tag.

## 4. Fork the market and add one listing

On [AgnesAI-Labs/agh-plugin-market](https://github.com/AgnesAI-Labs/agh-plugin-market), choose **Fork** if you do not already have a fork. Clone the **market fork** (not the plugin repository) and create a topic branch from the latest upstream `main`. Replace `YOUR-FORK-OWNER` with the account or organization that owns your fork:

```sh
git clone https://github.com/YOUR-FORK-OWNER/agh-plugin-market.git
cd agh-plugin-market
git remote add upstream https://github.com/AgnesAI-Labs/agh-plugin-market.git
git fetch upstream main
git switch -c submit-example upstream/main
```

If you already cloned your fork, use that checkout and add the `upstream` remote only if it does not exist. If you work directly in the market repository, `origin` can serve as `upstream` in these commands; still use a separate branch.

Edit only these two files:

1. In [`plugins.txt`](../plugins.txt), append one line at the end, `https://github.com/Octo-Cat/agh-example` (replace it with your URL). Do not add a `# pin:` line for the first listing.
2. In [`docs/index.json`](index.json), paste the following **single object** after the last entry in the `plugins` array, separated from that entry by a comma. Do not add a trailing comma after the new entry or replace the whole file. Leave every existing entry, source-list line, top-level field, and other file unchanged.

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

Replace the sample name, both URLs, version, timestamp, and commit. Use one stable version (no `v`, at most 128 characters), a positive safe integer timestamp from step 3 (no quotes), and the actual full commit SHA. Use exactly the same URL spelling in both fields and in `plugins.txt`. `repository` has only `url`; `source` has only `type`, `url`, and `commit`. Use `engines: {}` if no AGH compatibility is declared; otherwise copy the real `agh` requirement, for example `"engines": {"agh": ">=1.2.0"}`. `agh` is the only allowed engine key and its value uses the same plain-text rule as below. Each package name and repository must be unique in the catalog.

The sample omits optional display fields. If you add them to the new row:

| Field | Allowed value |
| --- | --- |
| `title`, `description` | A nonempty plain string of at most 500 characters without `<` or `>`, or a nonempty map using `en` and/or `zh-cn` with the same limits per value. |
| `author` | The repository owner's GitHub login (user or organization; case-insensitive), with the same plain-text limits. |
| `homepage` | Exactly the same URL as `repository.url`. |
| `metadata` | Only `keywords`, `labels`, and `sortKeys`. Use `keywords` from the manifest or `[]`, up to 32 nonempty plain strings of at most 64 characters each and no `<` or `>`; use exactly `[]` for `labels` and `{}` for `sortKeys`. |

The row above is otherwise complete; you do not need to clone everyone else's plugins or regenerate the catalog. Use ordinary, non-executable files for both market files and keep the index within 2 MiB (2,097,152 bytes).

## 5. Check the diff and open the pull request

From the **market** checkout, review the diff. If Node.js is installed, run the same offline index validator used in CI against the upstream base:

```sh
git status --short
git diff upstream/main
node tools/validate-index.mjs "$(git rev-parse upstream/main)"
```

The validator checks the format-1 index, unique names and repositories, Git sources and commits, and agreement between the two market files. It does not fetch the tag or review the release. The diff for a first listing should contain only your new URL and your new row (plus the JSON separator). Then commit and push the branch to your fork:

```sh
git add plugins.txt docs/index.json
git commit -m 'List @octo-cat/example 1.2.3'
git push -u origin submit-example
```

On GitHub, go to the [upstream Pull requests page](https://github.com/AgnesAI-Labs/agh-plugin-market/pulls) and choose **New pull request → compare across forks**. Set the **base repository** to `AgnesAI-Labs/agh-plugin-market`, **base** to `main`, **head repository** to your fork, and **compare** to `submit-example`. Review **Files changed**, give the PR a title and description identifying the plugin and tag, and choose **Create pull request** using the authorized account. Do not include credentials in the PR or its commits. A draft will not auto-merge; mark it **Ready for review** when it is ready.

If upstream `main` advances, update your branch and rerun the index check. For a branch you own, run `git fetch upstream main` and `git rebase upstream/main`. If both submissions appended entries, resolve conflicts by keeping upstream's entries intact and appending yours last. Stage the resolved files with `git add plugins.txt docs/index.json` and continue with `git rebase --continue`. Review the diff again and use `git push --force-with-lease origin submit-example` to update your rebased branch. If the plugin is already listed upstream, do not append a duplicate; use the update procedure below instead.

## 6. Follow review and confirm publication

Open the PR's `market / validate-index` check and the `market / review-release` report for its **latest commit**. The reviewer treats the PR and release as untrusted data: it scans the PR title, description, and commit history and the changed releases' text and filenames with Gitleaks, including committed build output. It also verifies the tag, pinned commit, proof, manifest, and declared paths. It does not execute plugins, install dependencies, recheck unchanged releases, or prove a plugin or its binary media is safe.

| Outcome or finding | What to do |
| --- | --- |
| `passed` | No findings from the configured checks. An eligible, up-to-date PR can be merged by the publisher when enabled; this is not a safety or installation guarantee. |
| `PUBLIC_SCOPE`, `PUBLIC_PROOF`, `PUBLIC_IDENTITY` | Check the package's owner scope, the authorized numeric ID, and the two-key proof in the exact tagged commit. If the PR opener is wrong, an authorized account must open the PR. If the proof or manifest needs changing, publish a new release. If only GitHub's account ID was unavailable to the reviewer, retry or ask a maintainer to investigate. |
| `TAG_MISSING`, `TAG_UNAVAILABLE`, `TAG_MISMATCH` | Check the public URL and the exact tag with step 3. Publish an absent tag for the intended release, or fix an incorrect index SHA to match the existing tag's commit. Do not retag. |
| `MANIFEST`, `ENTRY`, `LICENSE` | Check the indexed name and version, AGH declaration, tagged runtime files, and both license items. For release changes, publish a new version. |
| `CAPABILITY_DECLARATION`, `PUBLIC_CAPABILITIES`, `CAPABILITY_REVIEW`, `INSTALL_HOOKS`, `RUNTIME_DEPENDENCIES`, `RUNTIME_APIS` | Fix an inaccurate declaration or ask for manual review of what the plugin actually needs. Do not omit a real capability to pass the check. |
| `PR_SECRET`, `RELEASE_SECRET` | Investigate privately. Revoke or rotate anything exposed before removing it from the proposed PR history and, for a release leak, submitting a clean new release. Deleting it in a later commit does not clean the old commit; the report does not show matched values. |
| `INVALID_INDEX`, `PR_UNAVAILABLE`, `PR_BINARY`, `COVERAGE`, `OPAQUE`, `SCAN_FAILED`, `LIMIT`, `INTERNAL` | Address the index error, unreadable PR data, or missing scan coverage in the report. Retry transient scanner or network failures, and split a batch with more than 12 changed releases. |

`needs-review`, `failed`, and `incomplete` never qualify for automatic merge. Handle the reported issue or seek maintainer review. The report is advisory; the [publisher](../README.md#unattended-review-merge-and-publish) runs a fresh review and GitHub still requires the index check on an up-to-date PR.

Once merged, follow the GitHub Actions Pages deployment and look for your new name and version in the [published index](https://agnesai-labs.github.io/agh-plugin-market/index.json). Then open **Plugins → Market** in AGH, select **Community** or **All sources**, and search for your package. If the Pages index has the new version but AGH does not show it yet, the daemon may still be using its local cache. Try refreshing the view after the daemon has synchronized; the UI refresh rereads local state, not the remote index. Market listing enables discovery, not automatic installation or trust.

## Publish an update or remove a listing

For an update, repeat the release and account-authorization steps with a new stable version **strictly higher than every version currently listed for that package**. Change only its `versions` array and the matching pins in `plugins.txt`; keep the source URL line, row order, other fields, and other listings intact. Add a pin for the new version, with no `v` prefix and the full commit SHA. For example (replace the version and SHA with the real new values):

```text
# pin: https://github.com/Octo-Cat/agh-example 1.2.4 FULL_COMMIT_SHA
```

If you replace an older entry, remove its old pin if present. If you keep an entry, preserve it unchanged: an indexed version cannot be pointed at a new commit. Make the new version and its pin agree, then open the PR and follow the same checks. Display-only edits to a plugin row do not qualify as automatic version updates.

To remove a listing, open a PR that removes its source URL, all its pins, and its index entry together. Removals require manual review and merge.

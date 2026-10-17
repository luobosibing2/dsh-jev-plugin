## 直接答案

`pnpm run test:compatibility` 从当前源码重新构建正式根安装包，准备精确版本的官方 DSH CLI，再在新的临时 profile 中检查官方安装、九个 Jev Host 组件和真实 Web 客户端。默认版本取根 `package.json` 的 DSH 开发依赖，目前为 `0.2.1-alpha.2`。它不要求预先准备 CLI 路径表或安装包，不放宽正式 peer 声明。

`pnpm run test:compatibility` builds and packs the root GitHub-install entry, prepares an exact published DSH CLI, and checks official installation, all nine Jev Host components and the real Web client in a new disposable profile. The default comes from the root DSH development dependency, currently `0.2.1-alpha.2`. No pre-existing runtime map or tarball is needed, and the package keeps its declared peer versions.

## 准备与运行

使用仓库规定的 Node 24 和 pnpm `11.7.0`。首次检查前安装依赖与 Playwright Chromium；CLI 准备和后续 profile 安装需要访问 npm registry。

Use Node 24 and pnpm `11.7.0`. Install the repository dependencies and Playwright Chromium before the first run. CLI preparation and profile installation need access to the npm registry.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run test:compatibility
```

Linux 环境缺少浏览器系统依赖时，使用 `pnpm exec playwright install --with-deps chromium`。CI 使用这一准备命令。

On Linux, use `pnpm exec playwright install --with-deps chromium` when Chromium system dependencies are missing. CI uses this preparation command.

包管理器启动支持 Windows 的 `.cmd` shim。`pnpm exec vitest run scripts/validation/compatibility-smoke.test.mjs` 使用临时 npm/pnpm shim 检查命令启动、参数及失败记录；不安装 DSH、不运行构建，也不启动 profile。该回归检查在 Linux 和 Windows CI 中运行；它不代表完整的 Windows Host/Web 验证通过。

Package-manager launches support Windows `.cmd` shims. `pnpm exec vitest run scripts/validation/compatibility-smoke.test.mjs` checks command launches, arguments and failure records with temporary npm/pnpm shims, without installing DSH, running a build or starting a profile. This regression check runs in Linux and Windows CI; it does not establish a full Windows Host/Web pass.

可以指定另一个已声明支持的精确版本，例如旧宿主 `0.2.0-rc.2`：

Select another explicitly supported version, for example the legacy host `0.2.0-rc.2`:

```sh
pnpm run test:compatibility --version 0.2.0-rc.2
```

当前支持范围与五个已验证发布版本以[安装说明](../../../README.md#install-through-the-web-ui-recommended)为准。每次运行使用新的实验目录；需要保留的产物位于忽略的 `.artifacts/` 中。

The [installation guide](../../../README.md#install-through-the-web-ui-recommended) owns the current support range and five released targets. Each run uses a new directory under ignored `.artifacts/`.

## 成功与失败的判定

检查从本次构建产生的正式 tarball 验证 manifest、Host 与 Client runtime 和 Cordis patch，再交给官方 `dsh plugin add` 安装。Host 检查复用[兼容矩阵](../../../scripts/validation/compatibility-matrix.mjs)与[本地 profile 夹具](../../../packages/jev/tests/fixtures/compatibility-profile.mjs)，使用本地固定主模型和回环 Jev HTTP 回复。

The check validates the newly built tarball's manifest, Host and Client runtime, and Cordis patch before invoking the official installer. It reuses the [compatibility matrix](../../../scripts/validation/compatibility-matrix.mjs) and [profile fixture](../../../packages/jev/tests/fixtures/compatibility-profile.mjs), with a local deterministic main model and loopback Jev HTTP replies.

浏览器在 Host 仍运行时打开官方认证地址，通过插件卡进入 Jev 页面，等待设置与功能数据，并检查判断记录页。只启动 Web profile 或只看到 Host 激活不足以得到客户端通过结果。浏览器导入、页面错误、安装拒绝、Host 失败和超时均使命令以非零状态退出。结束或失败时关闭本轮浏览器、Host 和回环服务。

While the Host is running, the browser opens its authenticated Web address, enters the Jev page through the plugin card, waits for settings and feature data, and checks decision records. Web profile startup and Host activation alone do not establish Client success. Import or page errors, installer rejection, Host failure and timeouts produce a nonzero exit. The run closes its browser, Host and loopback server on success or failure.

## 更新支持版本

DSH 升级时，先更新根包与 workspace 包中实际使用的精确开发依赖，按已验证兼容性维护两份 peer 声明和[安装说明](../../../README.md#install-through-the-web-ui-recommended)。将新目标加入[验证版本列表](../../../scripts/validation/compatibility-versions.mjs)，再运行默认命令与需要保留支持的各个精确旧版本；新版本和旧版本都通过后再提交声明与生成 runtime。

For a DSH upgrade, update the exact development dependencies in the root and workspace packages. Maintain both peer declarations and the [installation guide](../../../README.md#install-through-the-web-ui-recommended) from observed compatibility. Add the new target to the [verification version list](../../../scripts/validation/compatibility-versions.mjs), then run the default command and each older version retained in the support declaration. Commit the declarations and generated runtime after those checks pass.

## 边界与验证

检查使用本轮临时 DSH home、Agent home 与假凭据，不读取或修改真实用户 profile，不调用真实主模型或判断服务。原始实验产物留在本地忽略目录；公开前仍需确认日志和报告没有认证 token、凭据或本机路径。通过结果验证所选发布版本的安装与接线，不证明自然任务效果、判断准确率或未运行的平台。

The check uses disposable DSH and Agent homes with fixture credentials. It does not use a real user profile or call live model services. Raw artifacts remain local and ignored; review logs and reports for tokens, credentials and machine paths before publishing them. A pass establishes installation and integration on the selected release and tested platform, not natural-task benefit, judgment accuracy or untested-platform support.

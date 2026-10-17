# deepseek-harness-jev

The English guide for the `main` integration, including Jev and both Luna Decisions APIs, is on the repository home page: [Read the English README](README.md).

[Plugin CI](.github/workflows/ci.yml) checks pull requests and pushes to `main` with the frozen lockfile, type check, tests, build, and committed runtime comparison. See [Development](README.md#development) for the commands and runtime update requirements.

The [compatibility smoke guide](docs/testing/compatibility-smoke/README.md) describes `pnpm run test:compatibility`: a fresh official package, disposable DSH installation, Host checks and an actual Jev Web page check, using local deterministic replies.

The Chinese [principles and all features explainer](https://luobosibing2.github.io/dsh-jev-plugin/explainers/dsh-jev-plugin.html) covers all 12 features with a complete skill-selection input/output example. The [Markdown source](docs/explainers/dsh-jev-plugin.md) is maintained in this repository.

The [quick review directory](https://luobosibing2.github.io/dsh-jev-plugin/#quick-review) includes the Chinese [log-admission interview guide](https://luobosibing2.github.io/dsh-jev-plugin/explainers/log-admission-interview.html), covering generic and test logs, design choices, live-model results and their limits. Its [Markdown source](docs/explainers/log-admission-interview.md) is maintained in this repository.

The [2026-10-09–10 Harness compatibility report](docs/testing/2026-10-09-harness-compatibility/README.md) records official DSH 0.2.1-alpha.2 installation, Web smoke checks, and real DeepSeek Flash / Jev experiments, including retained failures and untested channels.

The [2026-10-11 version compatibility report](docs/testing/2026-10-11-harness-version-compatibility/README.md) records five released DSH runtimes, official installation and local deterministic feature checks. The current [installation guide](README.md#install-through-the-web-ui-recommended) lists the supported range, which includes 0.2.1-alpha.3; the exact development baseline remains 0.2.1-alpha.2.

The [2026-10-07 Luna results](docs/testing/2026-10-07-luna-decisions/public-results.md) separate protocol/installation checks, controlled samples, and real main-model tasks. They retain the OpenRouter HTTP 403, two controlled approval misses, one later native approval success, log reduction, and ranking limits.

[简体中文](README.zh-CN.md)

# Jev planning and decision records

This directory is the public maintenance entry for Jev feature planning and delivery records. Each feature keeps three files together:

- `alignment.md` records the agreed objective, scope, and user decisions.
- `delta-spec.md` preserves the complete requirements and acceptance criteria for that change.
- `decision.md` records the chosen approach, alternatives, actual delivery, verification, and limits.

These records belong to the independent Jev plugin. They do not authorize changes to DeepSeek Harness. Each historical Delta is the final specification for its own change, not a cumulative specification of the current product. Read it against its named commit, host version, model, and experiment conditions. Preserve its original thresholds and conditions rather than replacing them with today's defaults; an old test result does not establish current behavior or general model quality.

## Source and public evidence

The initial import contains ten Jev groups previously maintained as local planning records in the DSH checkout, Jev's merged native Spill budget group, and this publication process group. The DSH ChatGPT OAuth helper is outside Jev and is excluded. Original local source files are retained for history; this repository is the maintenance entry for the public records.

Importing the documents does not rerun historical experiments. Public reports link to repository files. Historical Jev code references use exact public commits; DSH references use the read-only source snapshot `d743267388641bc76f17c45ce8b4c231aed1d32c`, which is separate from each experiment's recorded host version. Private Session captures, resource manifests, personal paths, profiles, screenshots, and raw experiment outputs are not imported. When an original reference is unavailable publicly, the text identifies that limit instead of linking to a private location.

The imported records previously excluded planning files from Git. That was the rule for their original delivery. The present publication explicitly changes the treatment of the planning documents; it does not make their private experimental inputs or raw results public.

## Lifecycle and maintenance

`proposed` contains work whose stated delivery has not been confirmed as merged. `implemented` contains the delivered decision and its final specification after an actual merge has been confirmed. An experiment can have completed local runs while its delivery remains proposed. A merged diagnostic does not imply that optional product changes or later experiments were delivered. Rejected and archived records, when present, retain their own lifecycle rather than being rewritten as current requirements.

The root agent maintains the authoritative three files in the primary checkout and puts the same content into the task branch before a feature or documentation commit. After confirmed delivery, the root updates the decision and moves the complete group together; those changes also enter Git. Hooks do not stage, commit, push, merge, or choose lifecycle transitions. An explicit request to keep specific future material private overrides the default tracking rule. Local session/worktree association metadata remains outside these public documents.

| Lifecycle | Category | Group | Recorded delivery |
| --- | --- | --- | --- |
| implemented | bug-fix | [allow-zero-skill-recommendations](implemented/bug-fix/allow-zero-skill-recommendations/decision.md) | [PR #37](https://github.com/luobosibing2/dsh-jev-plugin/pull/37) |
| implemented | bug-fix | [count-eligible-admission-candidates](implemented/bug-fix/count-eligible-admission-candidates/decision.md) | [PR #33](https://github.com/luobosibing2/dsh-jev-plugin/pull/33) |
| implemented | bug-fix | [issue-nineteen-install-diagnosis](implemented/bug-fix/issue-nineteen-install-diagnosis/decision.md) | [PR #20](https://github.com/luobosibing2/dsh-jev-plugin/pull/20) |
| implemented | feature | [jev-lightweight-completion-check](implemented/feature/jev-lightweight-completion-check/decision.md) | [PR #26](https://github.com/luobosibing2/dsh-jev-plugin/pull/26), [PR #27](https://github.com/luobosibing2/dsh-jev-plugin/pull/27) |
| implemented | feature | [jev-luna-decision-backend](implemented/feature/jev-luna-decision-backend/decision.md) | [PR #11](https://github.com/luobosibing2/dsh-jev-plugin/pull/11) |
| implemented | feature | [jev-native-spill-budget](implemented/feature/jev-native-spill-budget/decision.md) | [PR #48](https://github.com/luobosibing2/dsh-jev-plugin/pull/48) |
| implemented | feature | [jev-whole-step-stage-navigation](implemented/feature/jev-whole-step-stage-navigation/decision.md) | [PR #3](https://github.com/luobosibing2/dsh-jev-plugin/pull/3) |
| implemented | testing | [jev-completion-evidence-rerun](implemented/testing/jev-completion-evidence-rerun/decision.md) | [PR #10](https://github.com/luobosibing2/dsh-jev-plugin/pull/10); optional long-trajectory product changes excluded |
| implemented | testing | [jev-completion-skill-evaluation](implemented/testing/jev-completion-skill-evaluation/decision.md) | [PR #6](https://github.com/luobosibing2/dsh-jev-plugin/pull/6), [PR #7](https://github.com/luobosibing2/dsh-jev-plugin/pull/7) |
| implemented | testing | [jev-deepswe-paired-evaluation](implemented/testing/jev-deepswe-paired-evaluation/decision.md) | [PR #4](https://github.com/luobosibing2/dsh-jev-plugin/pull/4) |
| proposed | testing | [jev-log-admission-case-evaluation](proposed/testing/jev-log-admission-case-evaluation/decision.md) | Local experiment and documentation commit; no confirmed PR merge |
| proposed | process | [publish-jev-planning-records](proposed/process/publish-jev-planning-records/decision.md) | Publication branch pending merge; planning default installed locally |

## Git and installation packages

Notes are tracked in Git by default. Repository ignore rules must not hide the lifecycle directories; only the exact helper-generated exclusions for an explicitly authorized feature may be removed from local Git exclusions. Keep unrelated private exclusions intact and diagnose remaining conflicts rather than forcing files into the index.

The package's explicit `files` list excludes `.agents/notes`. Publishing these records in Git does not add them to the installed plugin, generated runtime, or model context. Product behavior is unchanged by this documentation import.

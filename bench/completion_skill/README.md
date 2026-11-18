# Jev completion and skill experiments

This package maintains four named, frozen evaluation scenarios. Preparing a scenario creates a **new** batch; it never resumes or edits an earlier run. The plugin under evaluation is supplied as a tarball. The package does not change Jev or DSH product code.

| Scenario ID | Trials | Main model | Variable |
| --- | ---: | --- | --- |
| `initial-26` | 26 | Scripted for six completion pairs; DeepSeek Flash for six skill pairs and one coding pair | Completion check or skill selection, one feature per pair |
| `coding-followup-4` | 4 | DeepSeek Flash | Completion check, two AB/BA pairs on the original Vitest task |
| `skill-repository-8` | 8 | DeepSeek Flash | Skill selection, two fixed 24-skill repository tasks with two AB/BA pairs each |
| `completion-recovery-16` | 16 | Scripted initial tool use and claim; DeepSeek Flash only after a native Jev supplement | Four fixed completion cases, each with AB/BA twice |

The checked-in [resource example](resources.example.json) lists every external input. Copy it outside the repository, replace the relative `paths` with your own resource locations, and keep the version, task, model route, endpoint, and credential reference fields accurate. Relative paths resolve from the resource JSON file. DeepSWE and Pier must be checked out at the declared commits; the Node archive and plugin tarball must match their SHA-256 values. The Docker image is pinned by digest. The optional `dsh_install` directory contains `package.json`, `package-lock.json`, and `identity.json` for the declared DSH version; without it, preparation creates a new npm lock in the new batch. Neither path depends on a historical batch.

The scenario fixes the task, DSH version, main/Jev routes, feature flags, tools, ordering, timeouts, and stop rules. A resource file may declare a different `versions.plugin_commit`, matching `versions.plugin_tar_sha256`, or price snapshot; these become a visibly different batch identity. The existing DeepSWE validator checks the actual tarball bytes, Node archive, source commits, and price fields. The batch records its scenario ID, Git HEAD, dirty state, exact maintained-source hashes, resource file hash, artifact hash, image, manifests, jobs, and input locks. A Git HEAD alone does not identify uncommitted evaluation code. A floating `deepseek-flash` alias, live service state, and credentials can change between runs, so a new batch is not a promise of identical output.

From the repository root, with Python `uv`, Node/pnpm, Docker, the checked-out resources, and Pier dependencies available:

```sh
pnpm install --frozen-lockfile
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli list
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli prepare initial-26 --resources /path/to/resources.json --batch /path/to/new-batch
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli check --batch /path/to/new-batch
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli preflight --batch /path/to/new-batch
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli report --batch /path/to/new-batch
```

Replace `initial-26` with `coding-followup-4`, `skill-repository-8`, or `completion-recovery-16` to prepare another scenario. `check` validates frozen source, resource-derived manifests, profiles, tasks, runtime locks, and Pier jobs. `preflight` runs keyless published-DSH native probes for completion and skill plumbing where local services can exercise them; the coding follow-up retains the real task and verifier but has no keyless substitute for a real coding model. Probe output is separate from paid trial output and never establishes real-provider accuracy.

Skill analysis and preflight use the catalog's recorded `source.selection` probability threshold and count limit to check publication. Catalogs without this metadata retain the historical top-five rule. Raw-ranking `recall@5` is separate from actual selected names and missing required skills. An empty selection is valid only after a complete successful judgment and an observed `skill-catalog-no-relevant` receipt; failed, cancelled, incomplete, or unadopted judgments leave the selected names undefined.

`completion-recovery-16` fixes a missing deliverable, a failed test misreported as passing, a Python unittest cache side effect misreported as absent, and an accurately reported cache control. The Python test deliberately writes `.cache/result.json` with bytecode cache generation disabled; it is a fixed side-effect probe, not a replay of an older natural `__pycache__` run. Its listener scripts only the first native tool call and initial claim. It delegates to the ordinary DeepSeek adapter only when the current request contains a native `jev-supervision` `supplement` message. The keyless preflight uses local Jev and a loopback DeepSeek Messages server through the same published DSH/Pier path; it checks native delivery, no dispatch for baseline/control/unknown evidence, the complete 22-tool schema and hash in both arms, file inventory, and model usage separation. The report retains every slot, raw request and Session evidence, host file hashes, unknown costs, and a blank field for manual semantic review. The DeepSeek request alias and dispatch time are recorded; the server response model ID is `null` because DSH does not export it in its stream. Initial scripted usage is never billed as DeepSeek usage. This fixed error-injection diagnostic does not measure natural initial error rates or general coding benefit.

For formal execution, configure the declared `DEEPSEEK_API_KEY` and `JEV_API_KEY` references in DSH local credentials, or provide Jev through a protected non-TTY pipe with `--jev-key-stdin`. The launcher reads the references without saving values and supplies them only to the serial runner. `initial-26` completion trials use a local scripted main and need only Jev when invoking `next`; its skill and coding trials, and both follow-ups, require both providers. Run one slot at a time and inspect the report before continuing:

```sh
node bench/completion_skill/credential_launcher.mjs next --batch /path/to/new-batch --execute
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli report --batch /path/to/new-batch
```

`run` in place of `next` advances serially until every slot is complete or a stop condition occurs. A running or halted slot, incomplete evidence, unknown usage cost, or advisory spending threshold stops further calls. There is no automatic retry or implicit reset. To repeat an experiment, choose its scenario ID and a new batch path. Historical outcomes are documented separately in the repository's testing report; they were produced by the original frozen drivers, not by a paid rerun of this maintained entry.

Focused keyless tests:

```sh
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m unittest bench.completion_skill.tests.test_skill_selection bench.completion_skill.tests.test_portable -v
```

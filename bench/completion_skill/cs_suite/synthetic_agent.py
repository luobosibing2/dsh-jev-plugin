"""Published DSH setup and evidence collection for Pier synthetic tasks."""

from __future__ import annotations

import json
from pathlib import Path

from bench.deepswe.agent import DshAgent, GUARD, PROFILE, REMOTE
from bench.deepswe.config import DSH_VERSION, digest
from bench.deepswe.profile import write_patch


class SyntheticDshAgent(DshAgent):
    """Run DSH in Pier without the Git checkout expected by DeepSWE tasks."""

    async def setup(self, environment) -> None:
        if str(environment.task_os) not in ("TaskOS.LINUX", "linux"):
            raise RuntimeError("Synthetic Pier tasks require Linux")
        await self._checked(environment, f"mkdir -p {REMOTE} /logs/agent", timeout=30)
        node_archive = self.plan["paths"].get("node_tarball")
        if node_archive:
            await environment.upload_file(node_archive, f"{REMOTE}/node.tar.xz")
            await self._checked(environment,
                f"mkdir -p {REMOTE}/node && tar -xJf {REMOTE}/node.tar.xz -C {REMOTE}/node --strip-components=1",
                timeout=120)
            self.node_bin = f"{REMOTE}/node/bin:"
        env = self._env()
        version = await self._checked(environment, "node --version", env=env, timeout=30)
        if version != "v" + self.plan["versions"]["node"]:
            raise RuntimeError(f"Node {version} differs from the frozen version")
        await self._checked(environment, "npm --version", env=env, timeout=30)
        await self._checked(environment, "timeout --help >/dev/null && command -v pgrep", env=env, timeout=30)
        await self._checked(environment, f"mkdir -p {REMOTE}/cli", env=env, timeout=30)
        await environment.upload_file(self.install_files / "package.json", f"{REMOTE}/cli/package.json")
        await environment.upload_file(self.install_files / "package-lock.json", f"{REMOTE}/cli/package-lock.json")
        await self._checked(environment, f"npm ci --prefix {REMOTE}/cli --no-audit --no-fund", env=env, timeout=600)
        bootstrap_pnpm = await self._checked(environment, "pnpm --version", cwd=f"{REMOTE}/cli", env=env, timeout=30)
        if bootstrap_pnpm != self.plan["versions"]["pnpm"]:
            raise RuntimeError("DSH bootstrap pnpm differs from the frozen version")
        dsh = f"node {REMOTE}/cli/node_modules/@deepseek-ai/dsh/lib/bin.js"
        if await self._checked(environment, dsh + " --version", env=env, timeout=30) != DSH_VERSION:
            raise RuntimeError("Container DSH differs from frozen version")
        artifact = Path(self.plan["paths"]["plugin_tarball"])
        if digest(artifact) != self.plan["versions"]["plugin_tar_sha256"]:
            raise RuntimeError("Plugin artifact changed after plan check")
        await environment.upload_file(artifact, f"{REMOTE}/plugin.tgz")
        await environment.upload_file(Path(__file__).parents[3] / "bench/deepswe/interaction_guard.mjs", GUARD)
        await environment.upload_file(Path(__file__).parents[3] / "bench/deepswe/evidence_export.mjs",
                                      f"{REMOTE}/evidence_export.mjs")
        await environment.upload_file(Path(__file__).parents[3] / "bench/deepswe/sandbox_precheck.mjs",
                                      f"{REMOTE}/sandbox_precheck.mjs")
        await self._checked(environment,
            f"{dsh} --profile {PROFILE} --from-default-profile headless --dump-default-config > /logs/agent/default-config.yml",
            env=env, timeout=60)
        await self._checked(environment, f"{dsh} plugin --profile {PROFILE} add {REMOTE}/plugin.tgz",
                            env=env, timeout=180)
        patch = self.logs_dir / "arm.patch.json"
        write_patch(patch, self.plan, self.arm, guard_path=GUARD)
        await environment.upload_file(patch, f"{REMOTE}/arm.patch.json")
        self.workdir = await self._checked(environment, "pwd", timeout=30)
        if not self.workdir.startswith("/"):
            raise RuntimeError("Pier did not provide an absolute task workdir")
        (self.logs_dir / "identity.json").write_text(json.dumps({
            "arm": self.arm, "dsh": DSH_VERSION, "model": self.plan["model"],
            "plugin_tar_sha256": self.plan["versions"]["plugin_tar_sha256"],
            "bootstrap_pnpm": bootstrap_pnpm, "workdir": self.workdir,
            "sandbox_mode": self.plan["conditions"]["sandbox"],
        }, sort_keys=True) + "\n", encoding="utf-8")
        await self._checked(environment, f"node {REMOTE}/sandbox_precheck.mjs", cwd=self.workdir,
            env={**env, "JEV_EVAL_SANDBOX_WORKDIR": self.workdir,
                 "JEV_EVAL_SANDBOX_MODE": self.plan["conditions"]["sandbox"],
                 "JEV_EVAL_SANDBOX_PRECHECK_MARKER": "/logs/agent/sandbox-precheck.json"}, timeout=20)

    async def _finish(self, environment, context) -> None:
        if self.workdir is None:
            context.metadata = {**(context.metadata or {}), "evidence_export": "missing_workdir"}
            return
        try:
            active = await environment.exec("pgrep -f '[d]sh/lib/bin.js'", timeout_sec=10)
            if active.return_code == 0:
                await environment.exec("pkill -TERM -f '[d]sh/lib/bin.js' || true", timeout_sec=15)
                settled = await environment.exec(
                    "timeout 10 sh -c 'while pgrep -f \"[d]sh/lib/bin.js\" >/dev/null; do sleep 0.05; done'",
                    timeout_sec=15)
                active = await environment.exec("pgrep -f '[d]sh/lib/bin.js'", timeout_sec=10)
                if active.return_code == 0:
                    context.metadata = {**(context.metadata or {}), "evidence_export": "process_active"}
                    return
        except Exception as exc:
            context.metadata = {**(context.metadata or {}), "evidence_export": "quiescence_unknown",
                                "evidence_export_error": str(exc)[-500:]}
            return
        try:
            export = await environment.exec(f"node {REMOTE}/evidence_export.mjs", env=self._env(), timeout_sec=30)
            context.metadata = {**(context.metadata or {}),
                                "evidence_export": "complete" if export.return_code == 0 else "failed",
                                "evidence_export_error": None if export.return_code == 0 else (export.stderr or export.stdout or "")[-500:]}
        except Exception as exc:
            context.metadata = {**(context.metadata or {}), "evidence_export": "failed",
                                "evidence_export_error": str(exc)[-500:]}
        try:
            question = await environment.exec("test -s /logs/agent/interactions.jsonl", timeout_sec=10)
            if question.return_code == 0:
                context.metadata = {**(context.metadata or {}), "termination": "needs-human"}
        except Exception:
            context.metadata = {**(context.metadata or {}), "interaction_evidence": "unavailable"}

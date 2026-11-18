"""Run one scripted-main completion record through the published DSH lifecycle."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from bench.deepswe.agent import PROFILE, REMOTE
from bench.deepswe.config import digest

from .completion_cases import CASE_ORDER
from .synthetic_agent import SyntheticDshAgent


SCRIPT_REMOTE = f"{REMOTE}/scripted_provider.mjs"
FIXTURE_REMOTE = f"{REMOTE}/completion-fixture.tar"


class CompletionCaseAgent(SyntheticDshAgent):
    """Install frozen files and a local LLM adapter; Jev remains the real service."""

    def __init__(self, *args, family: str, condition: str, case_id: str,
                 profile_patch_path: str, case_root: str, fixture_tar_sha256: str,
                 manifest_path: str, mock_jev_spec: str | None = None, **kwargs):
        if family != "completion" or case_id not in CASE_ORDER \
                or condition not in ("baseline", "completion_check"):
            raise ValueError("Unknown fixed completion case or condition")
        arm = kwargs.pop("arm")
        if arm != condition:
            raise ValueError("Completion condition differs from its Pier arm")
        inherited = dict(kwargs.pop("extra_env", {}) or {})
        inherited.update(JEV_CS_CASE=case_id, JEV_CS_SCRIPT_EVENTS="/logs/agent/scripted-main-events.jsonl",
                         JEV_CS_TOOLS_LOG="/logs/agent/scripted-main-tools.json")
        super().__init__(*args, manifest_path=manifest_path, arm=arm, extra_env=inherited, **kwargs)
        self.case_id = case_id
        self.condition = condition
        self.profile_patch = Path(profile_patch_path).resolve()
        self.case_root = Path(case_root).resolve()
        self.fixture_tar_sha256 = fixture_tar_sha256
        self.batch = Path(manifest_path).resolve().parent.parent
        self.mock_jev_spec = Path(mock_jev_spec).resolve() if mock_jev_spec else None
        self._close_mock_jev = None

    @staticmethod
    def name() -> str:
        return "jev-cs-scripted-completion"

    async def setup(self, environment) -> None:
        await super().setup(environment)
        if self.plan["model"]["provider"] != "eval-scripted" or self.plan["main_execution"] != "local-scripted-main-real-jev":
            raise RuntimeError("Scripted completion cannot use a real main provider")
        if digest(self.case_root / "fixture.tar") != self.fixture_tar_sha256:
            raise RuntimeError("Completion profile or fixture differs from frozen lock")
        if self.mock_jev_spec is None:
            lock = json.loads((self.batch / "suite-lock.json").read_text(encoding="utf-8"))
            relative = self.profile_patch.relative_to(self.batch).as_posix()
            if digest(self.profile_patch) != lock["inputs_sha256"].get(relative):
                raise RuntimeError("Completion profile differs from frozen lock")
        patch = self.profile_patch
        if self.mock_jev_spec is not None:
            from .probe_support import start_mock_jev
            base_url, self._close_mock_jev = await start_mock_jev(
                environment, self.mock_jev_spec, f"/logs/agent/mock-jev-{self.condition}")
            rows = json.loads(patch.read_text(encoding="utf-8"))
            jev = [row for row in rows if row.get("id") == "jev"]
            if len(jev) != 1:
                raise RuntimeError("Probe profile lacks one Jev row")
            jev[0]["config"]["baseUrl"] = base_url
            patch = self.logs_dir / "probe.patch.json"
            patch.write_text(json.dumps(rows, sort_keys=True) + "\n", encoding="utf-8")
        shutil.copyfile(patch, self.logs_dir / "arm.patch.json")
        await environment.upload_file(patch, f"{REMOTE}/arm.patch.json")
        await environment.upload_file(Path(__file__).with_name("scripted_provider.mjs"), SCRIPT_REMOTE)
        dsh = f"node {REMOTE}/cli/node_modules/@deepseek-ai/dsh/lib/bin.js"
        await self._checked(environment,
                            f"{dsh} --profile {PROFILE} --patch {REMOTE}/arm.patch.json --dump-config > /logs/agent/profile-config.yml",
                            env=self._env(), timeout=60)
        await environment.upload_file(self.case_root / "fixture.tar", FIXTURE_REMOTE)
        await self._checked(environment,
            f"tar -xf {FIXTURE_REMOTE} -C {self.workdir} && test -d {self.workdir}/jev-cs/work",
            env=self._env(), timeout=30)
        (self.logs_dir / "scenario-identity.json").write_text(json.dumps({
            "family": "completion", "condition": self.condition,
            "main_execution": "local-scripted-main-real-jev",
            "scripted_provider": "eval-scripted/fixed-script", "real_main_provider_calls_expected": 0,
            "jev_provider": self.plan["jev"]["model"],
            "fixture_tar_sha256": self.fixture_tar_sha256,
        }, sort_keys=True) + "\n", encoding="utf-8")

    async def _finish(self, environment, context) -> None:
        root = f"{self.workdir}/jev-cs/work"
        try:
            observed = await environment.exec(f"find {root} -type f -print0 | sort -z | xargs -0 -r sha256sum",
                                              cwd=self.workdir, timeout_sec=20)
            files = {}
            if observed.return_code == 0:
                for line in (observed.stdout or "").splitlines():
                    checksum, path = line.split("  ", 1)
                    files[str(Path(path).relative_to(self.workdir))] = checksum
            status = "captured" if observed.return_code == 0 else "unknown"
        except Exception:
            status, files = "unknown", {}
        (self.logs_dir / "workspace-outcome.json").write_text(json.dumps({
            "status": status, "file_sha256": files,
        }, sort_keys=True) + "\n", encoding="utf-8")
        context.metadata = {**(context.metadata or {}), "scenario_family": "completion",
                            "scenario_condition": self.condition, "workspace_outcome": status}
        try:
            await super()._finish(environment, context)
        finally:
            if self._close_mock_jev is not None:
                await self._close_mock_jev()
                self._close_mock_jev = None

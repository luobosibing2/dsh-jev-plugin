"""Pier adapter for a fixed native filesystem-skill trial."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from bench.deepswe.agent import PROFILE, REMOTE
from bench.deepswe.config import digest
from bench.completion_skill.cs_suite.synthetic_agent import SyntheticDshAgent

from .cases import CASE_ORDER, CONTAINER_SKILL_ROOT


class SkillCaseAgent(SyntheticDshAgent):
    """Mount a frozen case root after ordinary DSH/Pier setup."""

    def __init__(self, *args, family: str, condition: str, case_id: str,
                 fixture_tar_sha256: str, manifest_path: str,
                 profile_patch_path: str, case_root: str,
                 mock_jev_spec: str | None = None, **kwargs):
        super().__init__(*args, manifest_path=manifest_path, **kwargs)
        if family != "skills" or case_id not in CASE_ORDER or condition not in ("baseline", "skill_selection"):
            raise ValueError("unknown skill case")
        if self.arm != ("baseline" if condition == "baseline" else "completion_check"):
            raise ValueError("Pier arm differs from skill condition mapping")
        self.condition = condition
        self.case_id = case_id
        self.fixture_tar_sha256 = fixture_tar_sha256
        self.batch = Path(manifest_path).resolve().parent.parent
        self.profile_patch_path = Path(profile_patch_path).resolve()
        self.case_root = Path(case_root).resolve()
        self.mock_jev_spec = Path(mock_jev_spec).resolve() if mock_jev_spec else None
        self._close_mock_jev = None

    def _env(self, *, credentials: bool = False) -> dict[str, str]:
        env = super()._env(credentials=credentials)
        if self.mock_jev_spec is not None:
            env.update({"JEV_EVAL_SKILL_CASE": self.case_id,
                        "JEV_EVAL_MOCK_TOOLS_LOG": "/logs/agent/mock-model-tools.json",
                        "NO_PROXY": "127.0.0.1,localhost"})
        return env

    async def setup(self, environment):
        condition = self.condition
        fixture = self.case_root / "fixture.tar"
        patch = self.profile_patch_path
        if digest(fixture) != self.fixture_tar_sha256:
            raise RuntimeError("frozen skill profile or fixture changed")
        if self.mock_jev_spec is None:
            lock = json.loads((self.batch / "suite-lock.json").read_text(encoding="utf-8"))
            relative = patch.relative_to(self.batch).as_posix()
            if digest(patch) != lock["inputs_sha256"][relative]:
                raise RuntimeError("frozen skill profile changed")
        await super().setup(environment)
        if self.mock_jev_spec is not None:
            from bench.completion_skill.cs_suite.probe_support import start_mock_jev
            base_url, self._close_mock_jev = await start_mock_jev(
                environment, response_spec_path=self.mock_jev_spec,
                evidence_prefix=f"/logs/agent/mock-jev-{self.case_id}-{condition}",
            )
        try:
            if self.mock_jev_spec is not None:
                configured = json.loads(patch.read_text(encoding="utf-8"))
                jev = [row for row in configured if row.get("id") == "jev"]
                if len(jev) != 1:
                    raise RuntimeError("probe patch lacks exactly one Jev row")
                jev[0]["config"]["baseUrl"] = base_url
                model_module = Path(__file__).with_name("mock_provider.mjs")
                await environment.upload_file(model_module, f"{REMOTE}/mock-skill-provider.mjs")
                configured.append({"insert": [{"id": "eval-skill-model", "name": f"{REMOTE}/mock-skill-provider.mjs"}]})
                patch = self.logs_dir / "probe.patch.json"
                patch.write_text(json.dumps(configured, sort_keys=True) + "\n", encoding="utf-8")
            shutil.copyfile(patch, self.logs_dir / "arm.patch.json")
            await environment.upload_file(patch, f"{REMOTE}/arm.patch.json")
            dsh = f"node {REMOTE}/cli/node_modules/@deepseek-ai/dsh/lib/bin.js"
            await self._checked(
                environment,
                f"{dsh} --profile {PROFILE} --patch {REMOTE}/arm.patch.json --dump-config > /logs/agent/profile-config.yml",
                env=self._env(), timeout=60,
            )
            await environment.upload_file(fixture, f"{REMOTE}/skill-fixture.tar")
            await self._checked(environment, f"mkdir -p {CONTAINER_SKILL_ROOT}", env=self._env(), timeout=30)
            await self._checked(environment,
                                f"tar -xf {REMOTE}/skill-fixture.tar -C {CONTAINER_SKILL_ROOT}",
                                env=self._env(), timeout=30)
            (self.logs_dir / "skill-condition.json").write_text(json.dumps({
                "case": self.case_id, "condition": condition, "internal_pier_arm": self.arm,
                "patch_sha256": digest(patch), "fixture_tar_sha256": self.fixture_tar_sha256,
                "skill_root": CONTAINER_SKILL_ROOT,
            }, sort_keys=True) + "\n", encoding="utf-8")
        except BaseException:
            if self._close_mock_jev is not None:
                await self._close_mock_jev()
                self._close_mock_jev = None
            raise

    async def _finish(self, environment, context):
        expected = json.loads((self.case_root / "fixture-expected.json").read_text(encoding="utf-8"))
        status = "unknown"
        detail = {"expected_count": len(expected)}
        try:
            result = await environment.exec(
                f"find {CONTAINER_SKILL_ROOT} -type f -print0 | sort -z | xargs -0 -r sha256sum",
                timeout_sec=20,
            )
            observed = {}
            if result.return_code == 0:
                for line in (result.stdout or "").splitlines():
                    checksum, path = line.split("  ", 1)
                    observed[str(Path(path).relative_to(CONTAINER_SKILL_ROOT))] = checksum
            status = "unchanged" if result.return_code == 0 and observed == expected else "changed"
            detail.update({"observed_count": len(observed),
                           "different_paths": sorted({*observed, *expected} -
                                                     {name for name in expected if observed.get(name) == expected[name]})})
        except Exception as exc:
            detail["error"] = str(exc)[-500:]
        detail["status"] = status
        (self.logs_dir / "fixture-integrity.json").write_text(
            json.dumps(detail, sort_keys=True) + "\n", encoding="utf-8")
        context.metadata = {**(context.metadata or {}), "fixture_integrity": status}
        try:
            await super()._finish(environment, context)
        finally:
            if self._close_mock_jev is not None:
                await self._close_mock_jev()
                self._close_mock_jev = None

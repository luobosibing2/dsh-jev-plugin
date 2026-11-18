"""Run fixed first steps through published DSH and preserve native evidence."""

from __future__ import annotations

import json
import shlex
from pathlib import Path

from bench.deepswe.agent import PROFILE, REMOTE
from bench.deepswe.config import digest
from bench.completion_skill.cs_suite.synthetic_agent import SyntheticDshAgent

from .cases import CASE_ORDER, PROMPTS
from .profile import CONDITIONS


class RecoveryAgent(SyntheticDshAgent):
    """Keep the scripted first answer and actual follow-up in one DSH Session."""

    def __init__(self, *args, case_id: str, condition: str, manifest_path: str,
                 case_root: str, profile_patch_path: str, fixture_tar_sha256: str,
                 mock_jev_spec: str | None = None, mock_main_spec: str | None = None,
                 probe_pad: bool = False, probe_spoof: bool = False, **kwargs):
        inherited = dict(kwargs.pop("extra_env", {}) or {})
        inherited.update(JEV_REC_CASE=case_id, JEV_REC_REQUEST_LOG="/logs/agent/recovery-requests.jsonl",
                         JEV_REC_REQUIREMENT=PROMPTS[case_id])
        if probe_pad:
            inherited["JEV_REC_PROBE_PAD"] = "30000"
        if probe_spoof:
            inherited["JEV_REC_PROBE_SPOOF"] = "1"
        super().__init__(*args, manifest_path=manifest_path, extra_env=inherited, **kwargs)
        if case_id not in CASE_ORDER or condition not in CONDITIONS or self.arm != condition:
            raise ValueError("unknown recovery case or condition")
        self.case_id = case_id
        self.condition = condition
        self.batch = Path(manifest_path).resolve().parent
        self.case_root = Path(case_root).resolve()
        self.profile_patch_path = Path(profile_patch_path).resolve()
        self.fixture_tar_sha256 = fixture_tar_sha256
        self.mock_jev_spec = Path(mock_jev_spec).resolve() if mock_jev_spec else None
        self.mock_main_spec = Path(mock_main_spec).resolve() if mock_main_spec else None
        self._close_mock_jev = None
        self._close_mock_main = None

    @staticmethod
    def name() -> str:
        return "jev-completion-recovery"

    def _env(self, *, credentials: bool = False) -> dict[str, str]:
        env = super()._env(credentials=credentials)
        if self.mock_jev_spec or self.mock_main_spec:
            env["NO_PROXY"] = "127.0.0.1,localhost"
        return env

    async def setup(self, environment) -> None:
        await super().setup(environment)
        if self.plan["model"]["provider"] != "deepseek-official" or self.plan["main_execution"] != "scripted-initial-real-followup":
            raise RuntimeError("recovery plan must use the official DeepSeek route after scripted initial steps")
        if digest(self.case_root / "fixture.tar") != self.fixture_tar_sha256:
            raise RuntimeError("recovery fixture differs from the frozen hash")
        patch = self.profile_patch_path
        if self.mock_jev_spec is None and self.mock_main_spec is None:
            lock = json.loads((self.batch / "suite-lock.json").read_text(encoding="utf-8"))
            if digest(patch) != lock["inputs_sha256"][patch.relative_to(self.batch).as_posix()]:
                raise RuntimeError("recovery profile differs from frozen input")
        try:
            rows = json.loads(patch.read_text(encoding="utf-8"))
            if self.mock_jev_spec:
                from bench.completion_skill.cs_suite.probe_support import start_mock_jev
                endpoint, self._close_mock_jev = await start_mock_jev(
                    environment, self.mock_jev_spec, f"/logs/agent/mock-jev-{self.condition}")
                next(row for row in rows if row.get("id") == "jev")["config"]["baseUrl"] = endpoint
            if self.mock_main_spec:
                from .probe_support import start_mock_main
                endpoint, self._close_mock_main = await start_mock_main(
                    environment, self.mock_main_spec, f"/logs/agent/mock-main-{self.condition}")
                next(row for row in rows if row.get("id") == "llm-deepseek")["config"]["baseURL"] = endpoint
            actual = self.logs_dir / "arm.patch.json"
            actual.write_text(json.dumps(rows, sort_keys=True, indent=2) + "\n", encoding="utf-8")
            await environment.upload_file(actual, f"{REMOTE}/arm.patch.json")
            await environment.upload_file(Path(__file__).with_name("initial_listener.mjs"),
                                          f"{REMOTE}/recovery-initial-listener.mjs")
            dsh = f"node {REMOTE}/cli/node_modules/@deepseek-ai/dsh/lib/bin.js"
            await self._checked(environment,
                f"{dsh} --profile {PROFILE} --patch {REMOTE}/arm.patch.json --dump-config > /logs/agent/profile-config.yml",
                env=self._env(), timeout=60)
            await environment.upload_file(self.case_root / "fixture.tar", f"{REMOTE}/recovery-fixture.tar")
            root = f"{self.workdir}/jev-rec/work"
            await self._checked(environment,
                f"tar -xf {REMOTE}/recovery-fixture.tar -C {shlex.quote(self.workdir)} && test -d {shlex.quote(root)}",
                env=self._env(), timeout=30)
            expected = json.loads((self.case_root / "fixture-expected.json").read_text(encoding="utf-8"))
            observed = await self._files(environment)
            if observed != expected:
                raise RuntimeError("container seed fixture differs from frozen file hashes")
            (self.logs_dir / "scenario-identity.json").write_text(json.dumps({
                "case": self.case_id, "condition": self.condition, "main_execution": self.plan["main_execution"],
                "scripted_initial": True, "followup_provider": self.plan["model"]["route"],
                "fixture_tar_sha256": self.fixture_tar_sha256,
                "profile_sha256": digest(actual), "seed_sha256": expected,
            }, sort_keys=True) + "\n", encoding="utf-8")
        except BaseException:
            await self._close_services()
            raise

    async def _files(self, environment) -> dict[str, str] | None:
        root = f"{self.workdir}/jev-rec/work"
        result = await environment.exec(f"find {shlex.quote(root)} -type f -print0 | sort -z | xargs -0 -r sha256sum",
                                        timeout_sec=20)
        if result.return_code != 0:
            return None
        files = {}
        for line in (result.stdout or "").splitlines():
            checksum, path = line.split("  ", 1)
            files[str(Path(path).relative_to(self.workdir))] = checksum
        return files

    async def _close_services(self) -> None:
        for closer in (self._close_mock_main, self._close_mock_jev):
            if closer is not None:
                await closer()
        self._close_mock_main = self._close_mock_jev = None

    async def _finish(self, environment, context) -> None:
        try:
            observed = await self._files(environment)
            status = "captured" if observed is not None else "unknown"
        except Exception:
            observed, status = None, "unknown"
        selected = {}
        for name in ("summary.txt", "checksum.txt") if self.case_id == "missing-deliverable" else ():
            source = f"{self.workdir}/jev-rec/work/{name}"
            script = ("import json,pathlib; p=pathlib.Path(" + repr(source) + "); "
                      "data=p.read_bytes() if p.is_file() else None; "
                      "print(json.dumps({'status':'absent'} if data is None else "
                      "{'status':'too-large'} if len(data)>4096 else "
                      "{'status':'captured','text':data.decode('utf-8','replace')}))")
            try:
                result = await environment.exec("python3 -c " + shlex.quote(script), timeout_sec=15)
                selected[name] = json.loads(result.stdout) if result.return_code == 0 else {"status": "unknown"}
            except Exception:
                selected[name] = {"status": "unknown"}
        (self.logs_dir / "workspace-outcome.json").write_text(json.dumps({
            "status": status, "file_sha256": observed, "selected_text": selected,
        }, sort_keys=True) + "\n", encoding="utf-8")
        context.metadata = {**(context.metadata or {}), "workspace_outcome": status,
                            "scenario": "completion-recovery-16"}
        try:
            await super()._finish(environment, context)
        finally:
            await self._close_services()

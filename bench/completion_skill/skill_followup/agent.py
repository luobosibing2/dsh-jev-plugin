"""Pier adapter for one frozen read-only repository and skill directory."""

from __future__ import annotations

import json
import shlex
import shutil
from pathlib import Path

from bench.deepswe.agent import PROFILE, REMOTE
from bench.deepswe.config import digest
from bench.completion_skill.cs_suite.synthetic_agent import SyntheticDshAgent

from .cases import CASE_ORDER, REPO_DIR, SKILL_ROOT
from .profile import CONDITIONS, internal_arm


class FollowupSkillAgent(SyntheticDshAgent):
    """Run ordinary DSH while preserving skill and source fixture identities."""

    def __init__(self, *args, case_id: str, condition: str, manifest_path: str,
                 case_root: str, profile_patch_path: str, fixture_hashes: dict[str, str],
                 mock_jev_spec: str | None = None, **kwargs):
        super().__init__(*args, manifest_path=manifest_path, **kwargs)
        if case_id not in CASE_ORDER or condition not in CONDITIONS or self.arm != internal_arm(condition):
            raise ValueError("unknown follow-up case or arm")
        if set(fixture_hashes) != {"repo", "skills"}:
            raise ValueError("both frozen fixture hashes are required")
        self.case_id = case_id
        self.condition = condition
        self.batch = Path(manifest_path).resolve().parent
        self.case_root = Path(case_root).resolve()
        self.profile_patch_path = Path(profile_patch_path).resolve()
        self.fixture_hashes = fixture_hashes
        self.mock_jev_spec = Path(mock_jev_spec).resolve() if mock_jev_spec else None
        self._close_mock_jev = None

    def _env(self, *, credentials: bool = False) -> dict[str, str]:
        env = super()._env(credentials=credentials)
        if self.mock_jev_spec is not None:
            env.update({"JEV_EVAL_SKILL_CASE": self.case_id,
                        "JEV_EVAL_MOCK_TOOLS_LOG": "/logs/agent/mock-model-tools.json",
                        "NO_PROXY": "127.0.0.1,localhost"})
        return env

    async def setup(self, environment) -> None:
        skill_tar = self.case_root / "skill-fixture.tar"
        repo_tar = self.case_root / "repo-fixture.tar"
        if digest(skill_tar) != self.fixture_hashes["skills"] or digest(repo_tar) != self.fixture_hashes["repo"]:
            raise RuntimeError("follow-up source or skill fixture changed")
        patch = self.profile_patch_path
        if self.mock_jev_spec is None:
            lock = json.loads((self.batch / "suite-lock.json").read_text(encoding="utf-8"))
            relative = patch.relative_to(self.batch).as_posix()
            if digest(patch) != lock["inputs_sha256"][relative]:
                raise RuntimeError("frozen follow-up profile changed")
        await super().setup(environment)
        if self.mock_jev_spec is not None:
            from bench.completion_skill.cs_suite.probe_support import start_mock_jev
            base_url, self._close_mock_jev = await start_mock_jev(
                environment, response_spec_path=self.mock_jev_spec,
                evidence_prefix=f"/logs/agent/mock-jev-{self.case_id}-{self.condition}",
            )
        try:
            if self.mock_jev_spec is not None:
                rows = json.loads(patch.read_text(encoding="utf-8"))
                jev = [row for row in rows if row.get("id") == "jev"]
                if len(jev) != 1:
                    raise RuntimeError("mock profile has no unique Jev row")
                jev[0]["config"]["baseUrl"] = base_url
                await environment.upload_file(Path(__file__).with_name("mock_provider.mjs"),
                                              f"{REMOTE}/followup-mock-model.mjs")
                rows.append({"insert": [{"id": "followup-mock-model",
                                           "name": f"{REMOTE}/followup-mock-model.mjs"}]})
                patch = self.logs_dir / "probe.patch.json"
                patch.write_text(json.dumps(rows, sort_keys=True) + "\n", encoding="utf-8")
            shutil.copyfile(patch, self.logs_dir / "arm.patch.json")
            await environment.upload_file(patch, f"{REMOTE}/arm.patch.json")
            dsh = f"node {REMOTE}/cli/node_modules/@deepseek-ai/dsh/lib/bin.js"
            await self._checked(environment,
                f"{dsh} --profile {PROFILE} --patch {REMOTE}/arm.patch.json --dump-config > /logs/agent/profile-config.yml",
                env=self._env(), timeout=60)
            await environment.upload_file(skill_tar, f"{REMOTE}/followup-skills.tar")
            await environment.upload_file(repo_tar, f"{REMOTE}/followup-repo.tar")
            repo_root = f"{self.workdir}/{REPO_DIR}"
            await self._checked(environment, f"test ! -e {shlex.quote(repo_root)}", env=self._env(), timeout=15)
            await self._checked(environment, f"mkdir -p {SKILL_ROOT}", env=self._env(), timeout=20)
            await self._checked(environment, f"tar -xf {REMOTE}/followup-skills.tar -C {SKILL_ROOT}",
                                env=self._env(), timeout=30)
            await self._checked(environment,
                                f"tar -xf {REMOTE}/followup-repo.tar -C {shlex.quote(self.workdir)}",
                                env=self._env(), timeout=30)
            expected = json.loads((self.case_root / "fixture-expected.json").read_text(encoding="utf-8"))
            for kind, root in (("skills", SKILL_ROOT), ("repo", repo_root)):
                prefix = REPO_DIR + "/" if kind == "repo" else ""
                if await self._observed_files(environment, root, prefix=prefix) != expected[kind]:
                    raise RuntimeError(f"initial {kind} fixture differs from frozen files")
            (self.logs_dir / "followup-condition.json").write_text(json.dumps({
                "case": self.case_id, "condition": self.condition, "arm": self.arm,
                "profile_sha256": digest(patch), "repo_sha256": self.fixture_hashes["repo"],
                "skills_sha256": self.fixture_hashes["skills"], "repo_root": repo_root,
                "skill_root": SKILL_ROOT,
            }, sort_keys=True) + "\n", encoding="utf-8")
        except BaseException:
            if self._close_mock_jev is not None:
                await self._close_mock_jev()
                self._close_mock_jev = None
            raise

    async def _observed_files(self, environment, root: str, *, prefix: str = "") -> dict[str, str] | None:
        result = await environment.exec(
            f"find {shlex.quote(root)} -type f -print0 | sort -z | xargs -0 -r sha256sum",
            timeout_sec=25,
        )
        if result.return_code != 0:
            return None
        files = {}
        for line in (result.stdout or "").splitlines():
            checksum, path = line.split("  ", 1)
            files[prefix + str(Path(path).relative_to(root))] = checksum
        return files

    async def _finish(self, environment, context) -> None:
        expected = json.loads((self.case_root / "fixture-expected.json").read_text(encoding="utf-8"))
        details = {}
        for kind, root in (("skills", SKILL_ROOT), ("repo", f"{self.workdir}/{REPO_DIR}")):
            target = expected[kind]
            try:
                observed = await self._observed_files(
                    environment, root, prefix=REPO_DIR + "/" if kind == "repo" else "")
                status = "unchanged" if observed == target else "unknown" if observed is None else "changed"
                details[kind] = {"status": status, "expected_count": len(target),
                                 "observed_count": None if observed is None else len(observed),
                                 "different_paths": None if observed is None else sorted(
                                     {*target, *observed} - {name for name in target if observed.get(name) == target[name]}),
                                 }
            except Exception as exc:
                details[kind] = {"status": "unknown", "expected_count": len(target),
                                 "error": str(exc)[-500:]}
        (self.logs_dir / "fixture-integrity.json").write_text(
            json.dumps(details, sort_keys=True) + "\n", encoding="utf-8")
        context.metadata = {**(context.metadata or {}),
                            "fixture_integrity": "unchanged" if all(
                                value["status"] == "unchanged" for value in details.values()) else "changed-or-unknown"}
        try:
            await super()._finish(environment, context)
        finally:
            if self._close_mock_jev is not None:
                await self._close_mock_jev()
                self._close_mock_jev = None

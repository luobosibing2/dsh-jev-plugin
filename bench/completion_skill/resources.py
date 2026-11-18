"""Resolve explicit local resources into one pinned evaluation manifest."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from bench.deepswe.config import digest, load


PACKAGE = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE.parents[1]
SCENARIOS = ("initial-26", "coding-followup-4", "skill-repository-8", "completion-recovery-16")
TEMPLATES = {
    "initial-26": ("initial-completion.json", "initial-skills.json", "initial-coding.json"),
    "coding-followup-4": ("coding-followup-4.json",),
    "skill-repository-8": ("skill-repository-8.json",),
    "completion-recovery-16": ("completion-recovery-16.json",),
}


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def _resource_path(config: Path, raw: Any, name: str) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"Missing resource path: {name}")
    path = Path(raw).expanduser()
    return (path if path.is_absolute() else config.parent / path).resolve()


def load_resources(path: Path) -> dict[str, Any]:
    """Resolve paths relative to the passed resource file, without fallback paths."""
    path = Path(path).resolve()
    raw = read_json(path)
    if raw.get("schema") != 1 or not isinstance(raw.get("paths"), dict):
        raise ValueError("Resource manifest requires schema 1 and paths")
    paths = {name: _resource_path(path, raw["paths"].get(name), name)
             for name in ("deep_swe", "pier", "node_tarball", "plugin_tarball")}
    if raw["paths"].get("dsh_install"):
        paths["dsh_install"] = _resource_path(path, raw["paths"]["dsh_install"], "dsh_install")
    for name, target in paths.items():
        if not target.exists():
            raise FileNotFoundError(f"Resource {name} is missing: {target}")
    return {**raw, "resolved_paths": paths, "resource_manifest_path": str(path),
            "resource_manifest_sha256": digest(path)}


def template(name: str) -> dict[str, Any]:
    return read_json(PACKAGE / "templates" / name)


def same_scenario_identity(plan: dict[str, Any], name: str) -> bool:
    """Compare frozen task and settings while allowing declared artifact and price revisions."""
    expected = template(name)
    observed = json.loads(json.dumps(plan))
    observed.pop("paths", None)
    for field in ("plugin_commit", "plugin_tar_sha256"):
        observed["versions"][field] = expected["versions"][field]
    observed["prices"] = expected["prices"]
    return observed == expected


def materialize(name: str, resources: dict[str, Any]) -> dict[str, Any]:
    """Fill only resource-owned identities while preserving scenario conditions."""
    plan = template(name)
    official = template("initial-skills.json")
    versions = resources.get("versions")
    if not isinstance(versions, dict) or any(
        versions.get(field) != expected for field, expected in official["versions"].items()
        if field not in ("plugin_commit", "plugin_tar_sha256")
    ) or set(versions) != set(official["versions"]):
        raise ValueError("Resource versions differ beyond the explicit plugin artifact")
    if not isinstance(versions["plugin_commit"], str) or not re.fullmatch(r"[0-9a-f]{40}", versions["plugin_commit"]):
        raise ValueError("Resource plugin_commit must be a full Git commit")
    for field, expected in (("task", official["tasks"][0]),
                            ("model", official["model"]), ("jev", official["jev"]),
                            ("credential_names", {"main": official["conditions"]["main_credential_env"],
                                                  "jev": official["jev"]["credential_env"]})):
        if resources.get(field) != expected:
            raise ValueError(f"Resource {field} differs from the pinned evaluation identity")
    if resources.get("image_base") != "public.ecr.aws/d3j8x8q7/swe-bench-202605":
        raise ValueError("Resource Docker image base differs from the pinned original task")
    plan["versions"] = versions
    plan["tasks"] = [resources["task"]]
    plan["jev"] = resources["jev"]
    plan["prices"] = resources["prices"]
    if plan["model"]["provider"] == "deepseek-official":
        plan["model"] = resources["model"]
    plan["paths"] = {name: str(resources["resolved_paths"][name])
                     for name in ("deep_swe", "pier", "node_tarball", "plugin_tarball")}
    plan = load_from_value(plan)
    return plan


def load_from_value(value: dict[str, Any]) -> dict[str, Any]:
    """Apply the existing DeepSWE manifest validator without persisting a temp file."""
    from bench.deepswe.config import validate
    return validate(value)


def source_snapshot() -> dict[str, Any]:
    """Record HEAD, dirty status, and exact source bytes as separate identities."""
    files = sorted(file for file in PACKAGE.rglob("*") if file.is_file()
                   and "__pycache__" not in file.parts and file.suffix != ".pyc")
    hashes = {file.relative_to(REPO_ROOT).as_posix(): digest(file) for file in files}
    encoded = json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode("utf-8")
    head = subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
                          capture_output=True, text=True, check=True).stdout.strip()
    status = subprocess.run(["git", "-C", str(REPO_ROOT), "status", "--porcelain"],
                            capture_output=True, text=True, check=True).stdout
    return {"git_head": head, "worktree_dirty": bool(status.strip()),
            "source_sha256": hashlib.sha256(encoded).hexdigest(), "source_files_sha256": hashes}

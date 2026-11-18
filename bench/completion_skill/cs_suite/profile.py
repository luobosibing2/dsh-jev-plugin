"""Compose one-feature experimental profiles from the published DSH overlay rows."""

from __future__ import annotations

from typing import Any

from bench.deepswe.config import FEATURES
from bench.deepswe.profile import patch_rows

REMOTE = "/tmp/jev-deepswe"
GUARD = f"{REMOTE}/interaction_guard.mjs"


FAMILIES = ("completion", "skills", "coding")
CONDITIONS = {"completion": ("baseline", "completion_check"),
              "skills": ("baseline", "skill_selection"),
              "coding": ("baseline", "completion_check")}


def internal_arm(family: str, condition: str) -> str:
    if family not in FAMILIES or condition not in CONDITIONS[family]:
        raise ValueError("Unknown scenario family or condition")
    return "baseline" if condition == "baseline" else "completion_check"


def expected_features(family: str, condition: str) -> dict[str, bool]:
    """Name every current plugin switch; only the target feature changes."""
    target = {"completion": "completion-check", "skills": "skill-selection",
              "coding": "completion-check"}[family]
    return {name: condition != "baseline" and name == target for name in FEATURES}


def profile_rows(plan: dict[str, Any], family: str, condition: str, case_id: str | None = None) -> list[dict[str, Any]]:
    """Return a complete native profile overlay for one fixed slot."""
    arm = internal_arm(family, condition)
    rows = patch_rows(plan, arm, guard_path=GUARD)
    if family == "completion":
        rows.append({"insert": [{"id": "eval-scripted-main", "name": f"{REMOTE}/scripted_provider.mjs"}]})
    if family == "skills":
        if case_id is None:
            raise ValueError("Skill case id is required for isolated skill roots")
        from bench.completion_skill.skills.cases import patch_skill_rows
        rows = patch_skill_rows(rows, case_id, condition, plan)
    next(row for row in rows if row.get("id") == "jev")["config"]["features"] = expected_features(family, condition)
    if len(next(row for row in rows if row.get("id") == "jev")["config"]["features"]) != len(FEATURES):
        raise ValueError("Profile did not name every current Jev switch")
    if family != "skills" and next(row for row in rows if row.get("id") == "jev-selection").get("disabled") is not True:
        raise ValueError("Unrelated selection Loader must stay off")
    if next(row for row in rows if row.get("id") == "jev-stage-navigation").get("disabled") is not True:
        raise ValueError("Unrelated stage Loader must stay off")
    if next(row for row in rows if row.get("id") == "tool-web").get("disabled") is not True:
        raise ValueError("Agent web tools must stay disabled")
    return rows

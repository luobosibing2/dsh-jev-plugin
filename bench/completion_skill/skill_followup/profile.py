"""Equal published-DSH profiles differing only in skill selection enablement."""

from __future__ import annotations

from copy import deepcopy

from bench.deepswe.config import FEATURES, NO_WEB_TOOLSET
from bench.deepswe.profile import patch_rows

from .cases import SKILL_ROOT


CONDITIONS = ("baseline", "skill_selection")
REMOTE = "/tmp/jev-deepswe"


def internal_arm(condition: str) -> str:
    if condition not in CONDITIONS:
        raise ValueError("unknown skill condition")
    return "baseline" if condition == "baseline" else "completion_check"


def expected_features(condition: str) -> dict[str, bool]:
    if condition not in CONDITIONS:
        raise ValueError("unknown skill condition")
    return {name: condition == "skill_selection" and name == "skill-selection" for name in FEATURES}


def profile_rows(plan: dict, condition: str) -> list[dict]:
    """Keep both native skill tools and the selection Loader in both arms."""
    if plan["conditions"]["toolset"] != NO_WEB_TOOLSET:
        raise ValueError("follow-up skill profile requires the no-web toolset")
    rows = patch_rows(plan, internal_arm(condition), guard_path=f"{REMOTE}/interaction_guard.mjs")
    jev = [row for row in rows if row.get("id") == "jev"]
    selection = [row for row in rows if row.get("id") == "jev-selection"]
    if len(jev) != 1 or len(selection) != 1:
        raise ValueError("published Jev selection rows missing")
    jev[0]["config"]["features"] = expected_features(condition)
    selection[0].pop("disabled", None)
    rows.append({"id": "skill-filesystem", "config": {
        "includeDefaultRoots": False, "customSkillDirs": [SKILL_ROOT], "watch": False,
    }})
    if next(row for row in rows if row.get("id") == "tool-web").get("disabled") is not True:
        raise ValueError("web tools were not disabled")
    return rows


def profiles_match_except_feature(baseline: list[dict], selected: list[dict]) -> bool:
    normalized = deepcopy(selected)
    jev = [row for row in normalized if row.get("id") == "jev"]
    if len(jev) != 1:
        return False
    jev[0]["config"]["features"]["skill-selection"] = False
    return normalized == baseline

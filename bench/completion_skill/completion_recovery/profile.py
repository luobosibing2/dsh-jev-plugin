"""Matched published DSH profile overlays for the completion diagnostic."""

from __future__ import annotations

from copy import deepcopy

from bench.deepswe.config import FEATURES, NO_WEB_TOOLSET
from bench.deepswe.profile import patch_rows


REMOTE = "/tmp/jev-deepswe"
CONDITIONS = ("baseline", "completion_check")


def expected_features(condition: str) -> dict[str, bool]:
    if condition not in CONDITIONS:
        raise ValueError("unknown recovery condition")
    return {name: condition == "completion_check" and name == "completion-check" for name in FEATURES}


def profile_rows(plan: dict, condition: str) -> list[dict]:
    """Change only the completion switch between paired arms."""
    if plan["conditions"]["toolset"] != NO_WEB_TOOLSET:
        raise ValueError("recovery requires the no-web toolset")
    rows = patch_rows(plan, condition, guard_path=f"{REMOTE}/interaction_guard.mjs")
    next(row for row in rows if row.get("id") == "jev")["config"]["features"] = expected_features(condition)
    rows.append({"id": "jev-supervision", "config": {"evidenceChars": 24000}})
    rows.append({"insert": [{"id": "jev-recovery-initial-listener",
                              "name": f"{REMOTE}/recovery-initial-listener.mjs"}]})
    return rows


def profiles_match_except_feature(left: list[dict], right: list[dict]) -> bool:
    normalized = deepcopy(right)
    next(row for row in normalized if row.get("id") == "jev")["config"]["features"]["completion-check"] = False
    return normalized == left

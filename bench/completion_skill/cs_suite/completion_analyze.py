"""Score first-stop completion judgments and separately record post-supplement behavior."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .collector import inspect_basic, read_json
from .completion_cases import CASE_ORDER, LABELS, SEEDS


VERDICTS = ("complete", "omission", "needs-user", "unknown")


def _message_text(event: dict[str, Any]) -> str:
    message = (event.get("data") or {}).get("message") or {}
    return "\n".join(block.get("text", "") for block in message.get("content") or []
                     if isinstance(block, dict) and block.get("type") == "text")


def _first_verdict(operations: list[dict[str, Any]]) -> tuple[str | None, str | None, list[dict[str, Any]]]:
    attempts = [(attempt.get("startedAt", ""), op, attempt)
                for op in operations for attempt in op.get("attemptRecords") or []
                if isinstance(attempt, dict)]
    attempts.sort(key=lambda item: item[0])
    if not attempts:
        return None, None, []
    _, op, first = attempts[0]
    answer = next((item for item in ((first.get("response") or {}).get("answers") or [])
                   if item.get("id") == "assessment"), None)
    option = answer.get("optionId") if isinstance(answer, dict) else None
    timeline = [{"operation_id": operation.get("id"), "started_at": attempt.get("startedAt"),
      "assessment": next((item.get("optionId") for item in
                          ((attempt.get("response") or {}).get("answers") or [])
                          if item.get("id") == "assessment"), None),
      "status": attempt.get("status")}
     for _, operation, attempt in attempts]
    return option if option in VERDICTS else None, op.get("id"), timeline


def _phase(events: list[dict[str, Any]]) -> tuple[list[dict], list[dict], int]:
    pauses = [index for index, event in enumerate(events)
              if event.get("type") == "user/message" and
              ((event.get("data") or {}).get("source") or {}).get("kind") == "jev-supervision" and
              ((event.get("data") or {}).get("source") or {}).get("action") == "supplement"]
    return events[:pauses[0]] if pauses else events, events[pauses[0]:] if pauses else [], len(pauses)


def _file_truth(case_id: str, files: dict[str, str]) -> dict[str, Any]:
    root = "jev-cs/work/"
    seeded = {root + name: hashlib.sha256(content.encode()).hexdigest()
              for name, content in SEEDS[case_id].items()}
    changed = sorted(name for name in {*files, *seeded} if files.get(name) != seeded.get(name))
    output: dict[str, Any] = {"changed_files": changed, "seed_files_intact": all(
        files.get(name) == value for name, value in seeded.items())}
    if case_id == "complete-deliverable":
        output["requested_file_present"] = files.get(root + "deliverable.txt") == hashlib.sha256(b"READY\n").hexdigest()
    elif case_id == "missing-deliverable":
        summary = hashlib.sha256(b"ready\n").hexdigest()
        checksum_content = (summary + "\n").encode()
        output["requested_files_present"] = (files.get(root + "summary.txt") == summary and
                                             files.get(root + "checksum.txt") == hashlib.sha256(checksum_content).hexdigest())
    elif case_id == "stale-test-after-edit":
        output["requested_edit_present"] = files.get(root + "mode.txt") == hashlib.sha256(b"new\n").hexdigest()
    elif case_id == "needs-user-choice":
        output["blocked_file_absent"] = root + "region.txt" not in files
    else:
        output["no_unrequested_file_changes"] = not changed
    return output


def inspect_completion_slot(batch: Path, case_id: str, condition: str) -> dict[str, Any]:
    """Read one Pier result and preserve initial judgment separately from any repair."""
    if case_id not in CASE_ORDER or condition not in ("baseline", "completion_check"):
        raise ValueError("Unknown completion slot")
    batch = Path(batch).resolve()
    basic, events, operations = inspect_basic(batch, "completion", case_id, condition,
        batch / "jobs" / "completion" / case_id / condition,
        batch / "completion" / "manifest.json")
    basic["initial_gold"] = LABELS[case_id]
    if not events:
        return basic
    initial, post, supplement_count = _phase(events)
    first, first_id, timeline = _first_verdict(operations)
    initial_final = [_message_text(event) for event in initial if event.get("type") == "assistant/message"
                     and _message_text(event)]
    post_final = [_message_text(event) for event in post if event.get("type") == "assistant/message"
                  and _message_text(event)]
    initial_tools = [_message_text(event) for event in initial if event.get("type") == "tool/result"]
    post_tools = [_message_text(event) for event in post if event.get("type") == "tool/result"]
    workspace = read_json(Path(basic["agent_dir"]) / "workspace-outcome.json") or {}
    files = workspace.get("file_sha256") or {}
    truth = read_json(batch / "completion" / "cases" / case_id / "truth.json") or {}
    basic.update(initial_gold=LABELS[case_id], gold_source=str(batch / "completion" /
                                                                  "cases" / case_id / "truth.json"),
                 first_verdict=first, first_verdict_operation_id=first_id,
                 first_verdict_correct=(first == LABELS[case_id]) if first is not None else None,
                 verdict_timeline=timeline, supplement_request_count=supplement_count,
                 initial_final_text=initial_final[-1] if initial_final else None,
                 post_final_text=post_final[-1] if post_final else None,
                 initial_tool_results=initial_tools, post_tool_results=post_tools,
                 workspace_truth=_file_truth(case_id, files) if workspace.get("status") == "captured" else None,
                 predeclared_initial_truth=truth.get("initial"),
                 predeclared_supplement_truth=truth.get("supplement"))
    if condition == "baseline" and (operations or supplement_count):
        basic["blocking_errors"].append("Baseline ran completion judgment or supplement")
    if condition == "completion_check":
        if first is None or first_id is None:
            basic["blocking_errors"].append("Enabled arm has no first completion judgment")
        if supplement_count > 1:
            basic["blocking_errors"].append("Enabled arm requested more than one supplement")
    basic["structural_ok"] = not basic["blocking_errors"]
    return basic


def confusion(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Use only the six predeclared on-arm cases as the classification denominator."""
    matrix = {gold: {predicted: 0 for predicted in VERDICTS} for gold in ("complete", "omission", "needs-user")}
    missing = []
    for row in rows:
        if row.get("family") != "completion" or row.get("condition") != "completion_check":
            continue
        gold, predicted = row.get("initial_gold"), row.get("first_verdict")
        if gold in matrix and predicted in VERDICTS:
            matrix[gold][predicted] += 1
        else:
            missing.append(row.get("case"))
    per_class = {}
    for gold, predictions in matrix.items():
        denominator = sum(predictions.values())
        per_class[gold] = {"correct": predictions[gold], "denominator": denominator,
                           "recall": predictions[gold] / denominator if denominator else None}
    defined = [item["recall"] for item in per_class.values() if item["recall"] is not None]
    positive = [row for row in rows if row.get("family") == "completion"
                and row.get("condition") == "completion_check"
                and row.get("initial_gold") == "omission"]
    negative = [row for row in rows if row.get("family") == "completion"
                and row.get("condition") == "completion_check"
                and row.get("initial_gold") in ("complete", "needs-user")]
    return {"matrix": matrix, "per_class": per_class,
            "macro_recall": sum(defined) / len(defined) if len(defined) == len(per_class) else None,
            "macro_recall_denominator_classes": len(defined), "missing_first_verdict_cases": missing,
            "omission_detected": sum(row.get("first_verdict") == "omission" for row in positive),
            "omission_planned": 3,
            "omission_observed_denominator": sum(row.get("status") == "completed" for row in positive),
            "false_supplement_count": sum((row.get("supplement_request_count") or 0) > 0 for row in negative),
            "false_supplement_observed_denominator": sum(row.get("status") == "completed" for row in negative),
            "scope": "fixed six synthetic records; not general accuracy"}

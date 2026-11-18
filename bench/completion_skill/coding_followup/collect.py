"""Read Pier, Session, Jev, and independent verifier evidence without inference."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from bench.deepswe.report import _ledger, _model_usage, _search_usage, _session


def read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _duration(value: dict | None) -> float | None:
    if not isinstance(value, dict):
        return None
    try:
        start = datetime.fromisoformat(value["started_at"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(value["finished_at"].replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    return max(0.0, (end - start).total_seconds())


def _step_key(event: dict) -> tuple[int, int] | None:
    data = event.get("data") or {}
    turn, step = data.get("turn"), data.get("step")
    return (turn, step) if type(turn) is int and type(step) is int else None


def model_turn_closure(events: list[dict]) -> dict:
    """Identify a started step without a response, attempt, or matching end."""
    starts = Counter(key for event in events if event.get("type") == "step/start"
                     if (key := _step_key(event)) is not None)
    ends = Counter(key for event in events if event.get("type") == "step/end"
                   if (key := _step_key(event)) is not None)
    answers = Counter(key for event in events if event.get("type") in ("assistant/message", "assistant/attempt")
                      if (key := _step_key(event)) is not None)
    open_steps = sorted((starts - ends).elements())
    missing_responses = sorted(key for key, count in starts.items() if answers[key] < count)
    turn_starts = Counter((event.get("data") or {}).get("turn") for event in events
                          if event.get("type") == "turn/start")
    turn_end_events = [(event.get("data") or {}) for event in events if event.get("type") == "turn/end"]
    turn_ends = [((event.get("reason") or {}).get("kind")) for event in turn_end_events]
    completed_turns = Counter(event.get("turn") for event in turn_end_events
                              if (event.get("reason") or {}).get("kind") == "completed")
    complete = (bool(starts) and starts == ends and not missing_responses
                and bool(turn_starts) and turn_starts == completed_turns
                and len(turn_end_events) == sum(turn_starts.values()))
    return {"complete": complete, "steps_started": sum(starts.values()),
            "steps_ended": sum(ends.values()), "model_response_or_attempt_steps": len(answers),
            "open_steps": [list(key) for key in open_steps],
            "missing_response_steps": [list(key) for key in missing_responses],
            "turns_started": sum(turn_starts.values()),
            "turns_completed": sum(completed_turns.values()),
            "turn_end_reasons": turn_ends}


def _jev_timeline(operations: list[dict]) -> list[dict]:
    timeline = []
    for operation in operations:
        for attempt in operation.get("attemptRecords") or []:
            answers = (attempt.get("response") or {}).get("answers") or []
            assessment = next((item for item in answers if item.get("id") == "assessment"), {})
            evidence = next((item for item in answers if item.get("id") == "evidence"), {})
            timeline.append({"operation_id": operation.get("id"),
                             "feature_id": operation.get("featureId"),
                             "operation_status": operation.get("status"),
                             "started_at": attempt.get("startedAt"),
                             "attempt_status": attempt.get("status"),
                             "model": (attempt.get("rawResponse") or {}).get("model"),
                             "assessment": assessment.get("optionId"),
                             "assessment_probabilities": assessment.get("probabilities"),
                             "assessment_confidence": assessment.get("confidence"),
                             "evidence_choice": evidence.get("optionId"),
                             "latency_ms": attempt.get("latencyMs"),
                             "usage": attempt.get("usage"),
                             "receipts": operation.get("receipts") or []})
    return sorted(timeline, key=lambda item: item["started_at"] or "")


def supplement_limit_errors(count: int, arm: str) -> list[str]:
    """Reject a second automatic supplement or any baseline supplement."""
    errors = []
    if count > 1:
        errors.append("More than one automatic supplement was delivered")
    if arm == "baseline" and count:
        errors.append("Baseline unexpectedly received a Jev supplement")
    return errors


def failed_model_attempt_errors(events: list[dict]) -> list[str]:
    """Stop after any failed or cancelled model attempt logged by DSH."""
    count = sum(event.get("type") == "assistant/attempt" for event in events)
    return [f"Main provider recorded {count} failed or cancelled attempt(s)"] if count else []


def inspect_slot(batch: Path, slot: dict) -> dict:
    """Return one slot's status and fail-closed cost/quality evidence."""
    batch = Path(batch).resolve()
    attempt = batch / "slots" / slot["slot_id"] / "attempt-001"
    jobs = attempt / "pier-jobs"
    result: dict[str, Any] = {"slot": slot, "status": "not-started", "blocking_errors": [],
                              "structural_ok": False, "usage_complete": False,
                              "known_estimated_usd": None, "recorded_estimated_usd": None}
    if not (attempt / "state.json").is_file() and not jobs.exists():
        return result
    result["status"] = "started"
    trials = list(jobs.glob("*/*/result.json"))
    if len(trials) != 1:
        result["blocking_errors"].append("Pier did not export exactly one trial result")
        return result
    trial = trials[0].parent
    agent = trial / "agent"
    pier = read_json(trials[0]) or {}
    job = read_json(trial.parent / "result.json") or {}
    metadata = ((pier.get("agent_result") or {}).get("metadata") or {})
    plan = read_json(batch / "manifest.json") or {}
    termination = metadata.get("termination")
    result.update(status="completed", trial_result_path=str(trials[0]), agent_dir=str(agent),
                  termination=termination, dsh_exit_code=metadata.get("dsh_exit_code"),
                  evidence_export=metadata.get("evidence_export"),
                  patch_status=metadata.get("patch_status"),
                  pier_exception=(pier.get("exception_info") or {}).get("exception_type"),
                  agent_execution_seconds=_duration(pier.get("agent_execution")),
                  verifier_dir=str(trial / "verifier"),
                  patch_diff_path=str(agent / "patch.diff") if (agent / "patch.diff").is_file() else None)
    for field, expected in (("termination", "normal"), ("dsh_exit_code", 0),
                            ("evidence_export", "complete"), ("patch_status", "collected")):
        if result[field] != expected:
            result["blocking_errors"].append(f"{field} differs from {expected!r}")
    if result["pier_exception"] is not None:
        result["blocking_errors"].append("Pier trial has an exception")
    stats = job.get("stats") or {}
    if stats.get("n_completed_trials") != 1 or stats.get("n_errored_trials") != 0:
        result["blocking_errors"].append("Pier job did not finish exactly one trial")
    reward = read_json(trial / "verifier" / "reward.json")
    metrics = {key: reward.get(key) if isinstance(reward, dict) else None for key in
               ("reward", "f2p_passed", "f2p_total", "p2p_passed", "p2p_total", "apply_failed")}
    result["verifier"] = metrics
    result["verifier_reward_path"] = str(trial / "verifier" / "reward.json") if reward is not None else None
    if metrics["reward"] not in (0, 1) or any(type(metrics[key]) is not int for key in
                                            ("f2p_passed", "f2p_total", "p2p_passed", "p2p_total")):
        result["blocking_errors"].append("Independent verifier reward or F2P/P2P is unavailable")
    session_id, events, error = _session(agent)
    if error:
        result["blocking_errors"].append(error)
        return result
    result["session_id"] = session_id
    closure = model_turn_closure(events)
    result["turn_closure"] = closure
    result["failed_model_attempts"] = sum(event.get("type") == "assistant/attempt" for event in events)
    result["blocking_errors"].extend(failed_model_attempt_errors(events))
    main = _model_usage(events, session_id, plan["prices"]["main"], plan["model"])
    main["recorded_estimated_usd"] = main.get("estimated_usd")
    main["settled_messages_usage_complete"] = main.get("complete")
    main["complete"] = bool(main.get("complete") and main.get("calls", 0) >= 1
                            and closure["complete"] and termination == "normal")
    if not main["complete"]:
        main["estimated_usd"] = None
        result["blocking_errors"].append("Main model turn or usage is incomplete")
    result["main"] = main
    search = _search_usage(events)
    result["search"] = search
    if search.get("recorded_requests") != 0:
        result["blocking_errors"].append("Agent used an auxiliary web search")
    jev, operations = _ledger(agent, session_id, plan["prices"]["jev"], slot["arm"], metadata, termination)
    jev["empty_export_proves_zero"] = bool(jev["storage_complete"] and jev["operations"] == 0
                                           and termination == "normal")
    result["jev"] = jev
    result["jev_timeline"] = _jev_timeline(operations)
    completion_judgments = [item for item in result["jev_timeline"] if item["feature_id"] == "completion-check"]
    result["completion_participation"] = {
        "judgment_observed": bool(completion_judgments),
        "judgment_count": len(completion_judgments),
        "first_assessment": completion_judgments[0]["assessment"] if completion_judgments else None,
        "terminal_assessment": completion_judgments[-1]["assessment"] if completion_judgments else None,
        "interpretation": ("observed" if completion_judgments else "no judgment observed; no completion effect inferred"),
    }
    if not jev["storage_complete"]:
        result["blocking_errors"].append("Native Jev ledger export is incomplete")
    if jev["failed_attempts"]:
        result["blocking_errors"].append("Native Jev provider had a failed attempt")
    if any(operation.get("status") != "succeeded" for operation in operations):
        result["blocking_errors"].append("Native Jev operation did not succeed")
    if any(item["assessment"] not in ("complete", "omission", "needs-user", "unknown")
           for item in completion_judgments):
        result["blocking_errors"].append("Native completion judgment has no supported assessment")
    result["native_interactions"] = ((agent / "interactions.jsonl").is_file() and
                                     (agent / "interactions.jsonl").stat().st_size > 0)
    if result["native_interactions"]:
        result["blocking_errors"].append("Native human input was requested")
    supplement = [index for index, event in enumerate(events) if event.get("type") == "user/message" and
                  ((event.get("data") or {}).get("source") or {}).get("kind") == "jev-supervision" and
                  ((event.get("data") or {}).get("source") or {}).get("action") == "supplement"]
    result["supplement_requests"] = len(supplement)
    result["blocking_errors"].extend(supplement_limit_errors(len(supplement), slot["arm"]))
    result["post_supplement_tool_calls"] = sum(event.get("type") == "tool/call" for event in events[supplement[0]:]) if supplement else 0
    finals = []
    for event in events:
        if event.get("type") != "assistant/message":
            continue
        message = ((event.get("data") or {}).get("message") or {})
        text = "\n".join(block.get("text", "") for block in message.get("content") or []
                         if isinstance(block, dict) and block.get("type") == "text")
        if text:
            finals.append(text)
    result["final_assistant_text"] = finals[-1] if finals else None
    known = [value for value in (main.get("recorded_estimated_usd"), jev.get("estimated_usd"),
                                  search.get("estimated_usd")) if value is not None]
    result["recorded_estimated_usd"] = sum(known) if known else None
    if main["complete"] and jev["complete"] and search["complete"]:
        result["usage_complete"] = True
        result["known_estimated_usd"] = main["estimated_usd"] + jev["estimated_usd"] + search["estimated_usd"]
    else:
        result["blocking_errors"].append("Total slot cost is unknown")
    result["structural_ok"] = not result["blocking_errors"]
    return result

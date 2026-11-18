"""Separate scripted usage, native adoption, real dispatch, and file truth."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from bench.deepswe.report import _search_usage, _session, _usage_cost
from bench.completion_skill.cs_suite.collector import ledger, read_json
from bench.completion_skill.coding_followup.collect import model_turn_closure

from .cases import CASE_ORDER, LABELS, PROMPTS


def _jsonl(path: Path) -> list[dict] | None:
    try:
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    except (OSError, ValueError):
        return None


def _text(message: dict) -> str:
    return "\n".join(block.get("text", "") for block in message.get("content") or [] if block.get("type") == "text")


def _expected_cache_sha() -> str:
    value = json.dumps({"sample": "sample=ready", "passed": True}, sort_keys=True) + "\n"
    return hashlib.sha256(value.encode()).hexdigest()


def request_hash_matches(row: dict) -> bool:
    """Recompute the full JSON-visible model input hash with original tool order."""
    model_input = row.get("modelInput")
    if not isinstance(model_input, dict) or any(key not in model_input for key in
            ("provider", "model", "messages", "tools")):
        return False
    encoded = json.dumps(model_input, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest() == row.get("requestSha256")


def tool_schema_hash_matches(row: dict) -> bool:
    """Check the complete name-sorted tool schemas saved with one request."""
    tools = row.get("tools")
    if not isinstance(tools, list) or not all(isinstance(tool, dict) for tool in tools):
        return False
    encoded = json.dumps(tools, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest() == row.get("toolSchemaSha256")


def dispatch_metadata(requests: list[dict], logs: list[dict]) -> dict:
    """Keep request route and dispatch time distinct from an unexported response model."""
    real = [item for item in requests if item.get("phase") == "real-followup"]
    dispatched = [item for item in logs if item.get("type") == "delegated"]
    return {"first_request_at": requests[0].get("at") if requests else None,
            "provider_request_route": {"provider": real[0].get("provider"), "model": real[0].get("model")}
                                      if real else None,
            "real_dispatches": [{"request_index": item.get("requestIndex"), "at": item.get("at")}
                                for item in dispatched],
            "provider_response_model": None,
            "provider_response_model_status": "not-exported-by-DSH-stream" if real else "not-applicable"}


def final_request_usage(logs: list[dict], request_index: int) -> dict:
    """Use the final cumulative usage snapshot of one model stream."""
    snapshots = [item.get("chunk", {}).get("usage") for item in logs
                 if item.get("type") == "chunk" and item.get("requestIndex") == request_index
                 and item.get("chunk", {}).get("type") == "usage"]
    return snapshots[-1] if snapshots and isinstance(snapshots[-1], dict) else {}


def failed_test_observation(tool_results: list[dict]) -> dict:
    """Keep the native first result's text and explicit exit status together."""
    blocks = (((tool_results[0].get("message") or {}).get("content") or []) if tool_results else [])
    text = "\n".join(block.get("text", "") for block in blocks if block.get("type") == "text")
    failed = "FAIL unit-smoke: expected green, observed red" in text and text.rstrip().endswith("[exit code: 1]")
    return {"stdout_and_native_exit": text, "exit_code": 1 if failed else None}


def initial_native_inventory(native_calls: list[dict], native_results: list[dict]) -> dict | None:
    """Read only the first fixed native bash call's model-visible result."""
    if not native_calls:
        return None
    first = native_calls[0].get("data") or {}
    if first.get("name") != "bash" or first.get("callId") != "jev-rec-initial-1":
        return None
    matches = [event for event in native_results
               if (((event.get("data") or {}).get("message") or {}).get("toolCallId")) == first["callId"]]
    if len(matches) != 1:
        return None
    for block in (((matches[0].get("data") or {}).get("message") or {}).get("content") or []):
        if block.get("type") != "text":
            continue
        try:
            value = json.loads(block.get("text", ""))
        except (TypeError, ValueError):
            continue
        if isinstance(value, dict) and all(key in value for key in
                ("before", "after", "created", "changed", "removed", "unittest")):
            return value
    return None


def step_request_alignment(events: list[dict], requests: list[dict]) -> dict:
    """Match each logged main request to a unique native turn/step settlement."""
    def key(event: dict) -> tuple[int, int] | None:
        data = event.get("data") or {}
        turn, step = data.get("turn"), data.get("step")
        return (turn, step) if type(turn) is int and type(step) is int else None

    starts = [key(event) for event in events if event.get("type") == "step/start"]
    ends = [key(event) for event in events if event.get("type") == "step/end"]
    settled = [(key(event), event) for event in events
               if event.get("type") in ("assistant/message", "assistant/attempt")]
    closure = model_turn_closure(events)
    matched = bool(closure["complete"] and len(starts) == len(requests) == len(ends) == len(settled)
                   and None not in starts and None not in ends and all(item[0] is not None for item in settled)
                   and len(set(starts)) == len(starts)
                   and Counter(starts) == Counter(ends) == Counter(item[0] for item in settled))
    by_key = {item[0]: item[1] for item in settled}
    return {"matched": matched, "turn_closure": closure,
            "request_steps": [list(value) if value is not None else None for value in starts],
            "settlements": [by_key.get(value) for value in starts] if matched else []}


def complete_slot_cost(*, termination: str | None, dsh_exit_code: int | None,
                       evidence_export: str | None, aligned: bool, errors: list[str],
                       usages: tuple[dict, ...], components: dict[str, float | None]) -> float | None:
    """Withhold a total cost until the native turn and every component close."""
    if termination != "normal" or dsh_exit_code != 0 or evidence_export != "complete" \
            or not aligned or errors or not all(item.get("complete") for item in usages) \
            or any(value is None for value in components.values()):
        return None
    return sum(value for value in components.values() if value is not None)


def checksum_matches_summary(summary_sha: str | None, checksum_text: str | None) -> bool:
    """Accept a bare digest or the usual sha256sum line for the final summary."""
    if not summary_sha or checksum_text is None:
        return False
    return bool(re.fullmatch(rf"{re.escape(summary_sha)}(?:[ \t]+\*?summary\.txt)?\s*", checksum_text))


def file_truth(case: str, actual: dict[str, str] | None, seed: dict[str, str],
               selected_text: dict | None = None) -> dict:
    """Use host-collected final hashes and predeclared seed bytes as machine facts."""
    if actual is None:
        return {"status": "unknown"}
    intact = all(actual.get(name) == digest for name, digest in seed.items())
    created = {name: digest for name, digest in actual.items() if name not in seed}
    if case == "missing-deliverable":
        selected_text = selected_text or {}
        summary = actual.get("jev-rec/work/summary.txt")
        summary_text = selected_text.get("summary.txt") or {}
        checksum_text = selected_text.get("checksum.txt") or {}
        result = {"summary_contains_ready": summary_text.get("status") == "captured"
                  and "ready" in summary_text.get("text", ""),
                  "checksum_matches_final_summary": checksum_text.get("status") == "captured"
                  and checksum_matches_summary(summary, checksum_text.get("text")),
                  "summary_sha256": summary, "checksum_sha256": actual.get("jev-rec/work/checksum.txt"),
                  "selected_text": selected_text}
    elif case == "failed-test-claim":
        result = {"verifier_unchanged": intact, "new_files": created}
    else:
        result = {"cache_correct": actual.get("jev-rec/work/.cache/result.json") == _expected_cache_sha(),
                  "new_files": created}
    return {"status": "captured", "seed_intact": intact, "created_files": created, **result}


def inspect_slot(batch: Path, slot: dict, *, job_dir: Path | None = None) -> dict:
    """Inspect one trial without treating a Jev answer or queued notice as success."""
    batch = Path(batch).resolve()
    case, condition = slot["case"], slot["condition"]
    out = {**slot, "status": "not-started", "blocking_errors": [], "structural_ok": False,
           "usage_complete": False, "known_estimated_usd": None, "semantic_review": None,
           "initial_gold": LABELS[case]}
    job_dir = job_dir or batch / "jobs" / f"{slot['slot']:02d}"
    if not job_dir.exists():
        return out
    out["status"] = "started"
    trials = list(job_dir.glob("*/*/result.json"))
    if len(trials) != 1:
        out["blocking_errors"].append("Pier exported no unique trial result")
        return out
    trial = trials[0].parent
    result = read_json(trials[0]) or {}
    job_result = read_json(trial.parent / "result.json") or {}
    metadata = ((result.get("agent_result") or {}).get("metadata") or {})
    agent = trial / "agent"
    out.update(status="completed", trial_result_path=str(trials[0]), agent_dir=str(agent),
               termination=metadata.get("termination"), dsh_exit_code=metadata.get("dsh_exit_code"),
               evidence_export=metadata.get("evidence_export"),
               pier_exception=(result.get("exception_info") or {}).get("exception_type"))
    if (out["termination"], out["dsh_exit_code"], out["evidence_export"], out["pier_exception"]) != ("normal", 0, "complete", None):
        out["blocking_errors"].append("normal DSH completion and evidence export not established")
    if (job_result.get("stats") or {}).get("n_completed_trials") != 1 or (job_result.get("stats") or {}).get("n_errored_trials") != 0:
        out["blocking_errors"].append("Pier trial statistics incomplete")
    sid, events, error = _session(agent)
    if error:
        out["blocking_errors"].append(error)
        return out
    out["session_id"] = sid
    plan = read_json(batch / "manifest.json") or {}
    logs = _jsonl(agent / "recovery-requests.jsonl")
    if logs is None:
        out["blocking_errors"].append("request phase log missing or malformed")
        return out
    requests = [item for item in logs if item.get("type") == "request"]
    if not requests or [item.get("requestIndex") for item in requests] != list(range(1, len(requests) + 1)):
        out["blocking_errors"].append("request sequence is missing or noncontiguous")
    alignment = step_request_alignment(events, requests)
    out["turn_closure"] = alignment["turn_closure"]
    out["request_steps"] = alignment["request_steps"]
    if not alignment["matched"]:
        out["blocking_errors"].append("model requests lack matching turn/step starts, settlements, ends, or completed turn")
    for request in requests:
        number = request["requestIndex"]
        chunks = [item["chunk"] for item in logs if item.get("type") == "chunk" and item.get("requestIndex") == number]
        if (not any(item.get("type") == "end" and item.get("requestIndex") == number for item in logs)
                or not any(chunk.get("type") == "finish" for chunk in chunks)):
            out["blocking_errors"].append(f"model request {number} has no completed stream")
        if request.get("phase") == "real-followup" and not any(
                item.get("type") == "delegated" and item.get("requestIndex") == number for item in logs):
            out["blocking_errors"].append(f"real follow-up request {number} was not delegated")
    if any(item.get("type") in ("error", "blocked") for item in logs):
        out["blocking_errors"].append("model listener recorded an error or blocked request")
    initial = [item for item in requests if item.get("phase") == "synthetic-initial"]
    real = [item for item in requests if item.get("phase") == "real-followup"]
    if len(initial) != 2 or any(item.get("notices") for item in initial):
        out["blocking_errors"].append("frozen initial tool and answer steps differ")
    native_calls = [event for event in events if event.get("type") == "tool/call"]
    native_results = [event for event in events if event.get("type") == "tool/result"]
    if not native_calls or not native_results or native_calls[0].get("data", {}).get("name") != "bash" \
            or native_calls[0].get("seq", 10**12) > native_results[0].get("seq", -1):
        out["blocking_errors"].append("frozen first native bash call/result missing")
    schema_hashes = {item.get("toolSchemaSha256") for item in requests}
    out["tool_schema_hashes"] = sorted(schema_hashes)
    if len(schema_hashes) != 1:
        out["blocking_errors"].append("tool schema changed within the trial")
    if any(not request_hash_matches(item) or not tool_schema_hash_matches(item) for item in requests):
        out["blocking_errors"].append("full model input or tool schema hash differs from captured request")
    original_id = initial[0].get("originalId") if initial else None
    if not original_id or any(item.get("originalId") != original_id or not item.get("originalRequirementPresent") for item in requests):
        out["blocking_errors"].append("request lost the original user requirement")
    notice_events = [event for event in events if event.get("type") == "user/message" and
                     ((event.get("data") or {}).get("source") or {}).get("kind") == "jev-supervision" and
                     ((event.get("data") or {}).get("source") or {}).get("action") == "supplement"]
    notices = [((event.get("data") or {}).get("source") or {}) for event in notice_events]
    if any(source.get("requestId") != original_id for source in notices):
        out["blocking_errors"].append("native supplement belongs to another request")
    received_ids = {item.get("id") for request in real for item in request.get("notices") or []}
    event_ids = {(event.get("data") or {}).get("id") for event in notice_events}
    if real and (not notices or not received_ids or not received_ids <= event_ids):
        out["blocking_errors"].append("delegated request lacks its native Session supplement")
    if notices and not real:
        out["blocking_errors"].append("native supplement reached Session without a delegated main request")
    if condition == "baseline" and (real or notices):
        out["blocking_errors"].append("baseline unexpectedly delegated or supplemented")
    if case == "side-effect-accurate-control" and real:
        # A false-positive Jev judgment is a semantic outcome, not an input-structure failure.
        out["control_unexpected_delegation"] = True
    out.update(requests=requests, native_supplement_events=notice_events,
               real_request_count=len(real), synthetic_request_count=len(initial),
               real_request_messages=[item.get("messages") for item in real],
               original_requirement=PROMPTS[case], **dispatch_metadata(requests, logs))
    synthetic_usage = _usage_cost([final_request_usage(logs, request["requestIndex"]) for request in initial],
        {"source": "fixed local script", "input_per_million": 0, "output_per_million": 0,
         "cache_read_per_million": 0, "cache_write_per_million": 0})
    real_usage = _usage_cost([final_request_usage(logs, request["requestIndex"]) for request in real],
                             plan["prices"]["main"])
    for request, settlement in zip(requests, alignment["settlements"]):
        usage = final_request_usage(logs, request["requestIndex"])
        recorded = (settlement.get("data") or {}).get("usage")
        if settlement.get("type") != "assistant/message" or not isinstance(recorded, dict) or any(
                recorded.get(field) != usage.get(field) for field in ("inputTokens", "outputTokens")
                if field in recorded or field in usage):
            out["blocking_errors"].append(f"request {request['requestIndex']} usage differs from settled Session event")
            if request.get("phase") == "real-followup":
                real_usage["complete"] = False
                real_usage["estimated_usd"] = None
    for request in real:
        number = request["requestIndex"]
        if not any(item.get("type") == "end" and item.get("requestIndex") == number for item in logs) or not any(
                item.get("type") == "chunk" and item.get("requestIndex") == number
                and item.get("chunk", {}).get("type") == "finish" for item in logs):
            real_usage["complete"] = False
            real_usage["estimated_usd"] = None
    jev, operations = ledger(agent, sid, plan, "completion", condition, metadata)
    search = _search_usage(events)
    out.update(synthetic_main=synthetic_usage, real_main=real_usage, jev=jev, search=search,
               jev_operations=operations, jev_operation_count=len(operations),
               service_ready=jev.get("service_ready"), empty_export_proves_zero=jev.get("empty_export_proves_zero"))
    if not synthetic_usage["complete"] or not real_usage["complete"] or not jev["complete"] or not search["complete"]:
        out["blocking_errors"].append("synthetic, real, Jev, or search usage is incomplete")
    if not jev["storage_complete"]:
        out["blocking_errors"].append("Jev storage/index/service evidence incomplete")
    if jev.get("failed_attempts"):
        out["blocking_errors"].append("Jev has a failed provider attempt")
    if condition == "baseline" and (operations or not jev.get("empty_export_proves_zero")):
        out["blocking_errors"].append("baseline zero Jev calls not proven")
    if condition == "completion_check" and not operations:
        out["blocking_errors"].append("enabled arm has no Jev operation")
    if search.get("recorded_requests") != 0 or (agent / "interactions.jsonl").is_file() and (agent / "interactions.jsonl").stat().st_size:
        out["blocking_errors"].append("web search or human interaction occurred")
    ordered_operations = sorted(operations, key=lambda item: (min(
        (attempt.get("startedAt") or "" for attempt in item.get("attemptRecords") or []), default=item.get("startedAt") or ""),
        item.get("id") or ""))
    attempt_rows = sorted((attempt for operation in ordered_operations for attempt in operation.get("attemptRecords") or []),
                          key=lambda item: (item.get("startedAt") or "", item.get("id") or ""))
    out["judgments"] = [{"operation_id": operation.get("id"), "operation_status": operation.get("status"),
        "action_status": operation.get("actionStatus"), "receipts": operation.get("receipts"),
        "attempts": [{"id": attempt.get("id"), "status": attempt.get("status"),
                      "request": attempt.get("request"), "raw_response": attempt.get("rawResponse"),
                      "response": attempt.get("response"), "interpretation": attempt.get("interpretation"),
                      "usage": attempt.get("usage"), "failure": attempt.get("failure")}
                     for attempt in operation.get("attemptRecords") or []]}
        for operation in ordered_operations]
    out["first_assessment"] = next((answer.get("optionId") for attempt in attempt_rows
        for answer in ((attempt.get("response") or {}).get("answers") or []) if answer.get("id") == "assessment"), None)
    out["first_assessment_matches_gold"] = (out["first_assessment"] == LABELS[case]
                                             if out["first_assessment"] is not None else None)
    out["complete_evidence"] = [((attempt.get("request") or {}).get("state") or {}).get("completeEvidence")
                                for attempt in attempt_rows]
    out["omitted_messages"] = [((attempt.get("request") or {}).get("state") or {}).get("omittedMessages")
                               for attempt in attempt_rows]
    out["requirement_in_jev_request"] = [PROMPTS[case] in json.dumps(attempt.get("request") or {}, ensure_ascii=False)
                                         for attempt in attempt_rows]
    messages = [event for event in events if event.get("type") == "assistant/message"]
    out["initial_final_text"] = next((_text((event.get("data") or {}).get("message") or {}) for event in messages
        if "I created and verified" in _text((event.get("data") or {}).get("message") or {})
        or "unit-smoke test passed" in _text((event.get("data") or {}).get("message") or {})
        or "Python unittest passed" in _text((event.get("data") or {}).get("message") or {})), None)
    out["terminal_text"] = next((_text((event.get("data") or {}).get("message") or {}) for event in reversed(messages)
        if _text((event.get("data") or {}).get("message") or {})), None)
    out["all_tool_results"] = [(event.get("data") or {}) for event in events if event.get("type") == "tool/result"]
    inventory = initial_native_inventory(native_calls, native_results)
    first_notice_index = next((index for index, event in enumerate(events) if event in notice_events), None)
    out["followup_tool_events"] = [(event.get("data") or {}) for event in
        (events[first_notice_index + 1:] if first_notice_index is not None else [])
        if event.get("type") in ("tool/call", "tool/result")]
    workspace = read_json(agent / "workspace-outcome.json") or {}
    truth = read_json(batch / "cases" / case / "truth.json") or {}
    identity = read_json(agent / "scenario-identity.json") or {}
    if identity.get("case") != case or identity.get("condition") != condition \
            or identity.get("seed_sha256") != truth.get("seed_sha256"):
        out["blocking_errors"].append("initial container fixture identity missing or changed")
    out["initial_fixture_identity"] = identity
    out["file_truth"] = file_truth(case, workspace.get("file_sha256") if workspace.get("status") == "captured" else None,
                                   truth.get("seed_sha256") or {}, workspace.get("selected_text"))
    out["initial_file_inventory"] = inventory
    if out["file_truth"]["status"] != "captured":
        out["blocking_errors"].append("host file truth unavailable")
    if case.startswith("side-effect"):
        expected_before = {key.removeprefix("jev-rec/work/"): value for key, value in truth.get("seed_sha256", {}).items()}
        expected_after = {**expected_before, ".cache/result.json": _expected_cache_sha()}
        if not inventory or inventory.get("before") != expected_before or inventory.get("after") != expected_after \
                or inventory.get("created") != {".cache/result.json": _expected_cache_sha()} \
                or inventory.get("changed") != {} or inventory.get("removed") != [] \
                or (inventory.get("unittest") or {}).get("exit_code") != 0:
            out["blocking_errors"].append("model-visible Python before/after inventory differs from independent host hashes")
    if case == "failed-test-claim":
        out["initial_test_observation"] = failed_test_observation(out["all_tool_results"])
        if out["initial_test_observation"]["exit_code"] != 1:
            out["blocking_errors"].append("native failed-test stdout or exit 1 missing")
    known_components = {"real_main": real_usage.get("estimated_usd"),
                        "jev": jev.get("estimated_usd"), "search": search.get("estimated_usd")}
    out["recorded_known_components"] = {**known_components,
        "partial_sum_usd": sum(value for value in known_components.values() if value is not None)}
    out["known_estimated_usd"] = complete_slot_cost(
        termination=out["termination"], dsh_exit_code=out["dsh_exit_code"],
        evidence_export=out["evidence_export"], aligned=alignment["matched"],
        errors=out["blocking_errors"], usages=(synthetic_usage, real_usage, jev, search),
        components=known_components)
    out["usage_complete"] = out["known_estimated_usd"] is not None
    if not out["usage_complete"]:
        out["blocking_errors"].append("total slot cost remains unknown until normal matched turn closure")
    out["structural_ok"] = not out["blocking_errors"]
    return out

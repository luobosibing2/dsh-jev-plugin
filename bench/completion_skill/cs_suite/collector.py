"""Common read-only Pier, Session, and Jev accounting for fixed trial slots."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from bench.deepswe.report import _model_usage, _search_usage, _session, _usage_cost

from .profile import expected_features


def read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _duration(value: dict[str, Any] | None) -> float | None:
    if not value or not value.get("started_at") or not value.get("finished_at"):
        return None
    try:
        start = datetime.fromisoformat(value["started_at"].replace("Z", "+00:00"))
        finish = datetime.fromisoformat(value["finished_at"].replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0.0, (finish - start).total_seconds())


def ledger(agent: Path, session_id: str | None, plan: dict[str, Any],
           family: str, condition: str, metadata: dict[str, Any]) -> tuple[dict[str, Any], list[dict]]:
    """Treat an empty enabled ledger as zero only with a complete native export."""
    storage = agent / "dsh-home" / "storages"
    domains = list(storage.glob("jev_*/operations"))
    files = [file for domain in domains for file in domain.glob("*.json")]
    operations = []
    invalid = 0
    for file in files:
        stored = read_json(file)
        record = stored.get("record") if isinstance(stored, dict) else None
        if not isinstance(record, dict):
            invalid += 1
        elif (record.get("sessionId") or (record.get("link") or {}).get("sessionId")) == session_id:
            operations.append(record)
    attempts = [attempt for op in operations for attempt in op.get("attemptRecords") or [] if isinstance(attempt, dict)]
    usage = _usage_cost([attempt.get("usage") if isinstance(attempt.get("usage"), dict) else {}
                         for attempt in attempts], plan["prices"]["jev"], jev=True)
    index = read_json(agent / "original-logs" / "index.json")
    ready = read_json(agent / "jev-service-ready.json")
    features_match = isinstance(ready, dict) and ready.get("features") == expected_features(family, condition)
    empty = metadata.get("termination") == "normal" and not domains and not files and index == []
    storage_complete = (session_id is not None and metadata.get("evidence_export") == "complete"
                        and storage.is_dir() and isinstance(index, list) and invalid == 0
                        and features_match and ((len(domains) == 1 and bool(files)) or empty))
    if not storage_complete:
        usage["complete"] = False
        usage["estimated_usd"] = None
    usage.update(operations=len(operations), failed_attempts=sum(a.get("status") != "succeeded" for a in attempts),
                 invalid_record_files=invalid, storage_complete=storage_complete,
                 empty_export_proves_zero=empty and storage_complete,
                 service_ready=features_match)
    return usage, operations


def inspect_basic(batch: Path, family: str, case_id: str, condition: str,
                  job_dir: Path, manifest: Path) -> tuple[dict[str, Any], list[dict], list[dict]]:
    """Return one slot's shared evidence, raw Session events, and linked Jev records."""
    out: dict[str, Any] = {"family": family, "case": case_id, "condition": condition,
                           "status": "not-started", "blocking_errors": [],
                           "usage_complete": False, "known_estimated_usd": None, "structural_ok": False}
    if not job_dir.exists():
        return out, [], []
    out["status"] = "started"
    trials = list(job_dir.glob("*/*/result.json"))
    if len(trials) != 1:
        out["blocking_errors"].append("Pier did not export exactly one trial result")
        return out, [], []
    trial = trials[0].parent
    result = read_json(trials[0]) or {}
    job_result = read_json(trial.parent / "result.json") or {}
    metadata = ((result.get("agent_result") or {}).get("metadata") or {})
    plan = read_json(manifest) or {}
    agent = trial / "agent"
    out.update(status="completed", termination=metadata.get("termination"),
               dsh_exit_code=metadata.get("dsh_exit_code"),
               evidence_export=metadata.get("evidence_export"),
               pier_exception=(result.get("exception_info") or {}).get("exception_type"),
               agent_execution_seconds=_duration(result.get("agent_execution")),
               verifier_result=result.get("verifier_result") if family == "coding" else None,
               agent_dir=str(agent), trial_result_path=str(trials[0]))
    for field, wanted in (("termination", "normal"), ("dsh_exit_code", 0), ("evidence_export", "complete")):
        if out[field] != wanted:
            out["blocking_errors"].append(f"{field} differs from {wanted!r}")
    if out["pier_exception"] is not None:
        out["blocking_errors"].append("Pier trial has an exception")
    stats = job_result.get("stats") or {}
    if stats.get("n_completed_trials") != 1 or stats.get("n_errored_trials") != 0:
        out["blocking_errors"].append("Pier job did not finish one trial without error")
    session_id, events, error = _session(agent)
    if error:
        out["blocking_errors"].append(error)
        return out, [], []
    out["session_id"] = session_id
    # The local adapter's synthetic messages are counted, never billed as DeepSeek.
    if plan.get("main_execution") == "local-scripted-main-real-jev":
        zero = {"source": "Local scripted adapter: no external main provider request",
                "input_per_million": 0, "cache_read_per_million": 0,
                "cache_write_per_million": 0, "output_per_million": 0}
        main = _model_usage(events, session_id, zero, plan["model"])
        main["real_provider_calls"] = 0
        main["synthetic_usage"] = True
        if any(event.get("type") == "assistant/message" and
               ((event.get("data") or {}).get("message") or {}).get("source", {}).get("provider") == "deepseek-official"
               for event in events):
            out["blocking_errors"].append("Scripted slot unexpectedly used the DeepSeek provider")
    else:
        main = _model_usage(events, session_id, plan["prices"]["main"], plan["model"])
        main["real_provider_calls"] = main.get("calls")
        main["synthetic_usage"] = False
    search = _search_usage(events)
    jev, operations = ledger(agent, session_id, plan, family, condition, metadata)
    out.update(main=main, search=search, jev=jev,
               feature_flags=(read_json(agent / "jev-service-ready.json") or {}).get("features"),
               native_interactions=(agent / "interactions.jsonl").exists()
               and (agent / "interactions.jsonl").stat().st_size > 0)
    if not main.get("complete") or (main.get("calls") or 0) < 1:
        out["blocking_errors"].append("Main adapter usage is missing or incomplete")
    if search.get("recorded_requests") != 0:
        out["blocking_errors"].append("Agent used an auxiliary web search")
    if not jev["storage_complete"]:
        out["blocking_errors"].append("Native Jev ledger export is incomplete")
    if jev["failed_attempts"]:
        out["blocking_errors"].append("Native Jev provider has a failed attempt")
    if out["native_interactions"]:
        out["blocking_errors"].append("Native human interaction was requested")
    if main.get("complete") and jev.get("complete") and search.get("complete"):
        out["known_estimated_usd"] = main["estimated_usd"] + jev["estimated_usd"] + search["estimated_usd"]
        out["usage_complete"] = True
    else:
        out["blocking_errors"].append("Usage or estimated cost is incomplete")
    out["structural_ok"] = not out["blocking_errors"]
    return out, events, operations

"""Evidence-led analysis of one native skill-selection trial."""

from __future__ import annotations

import hashlib
import json
import math
import re
import tarfile
from pathlib import Path

from .cases import CASE_ORDER


def _json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _text(message: dict) -> str:
    return "\n".join(item.get("text", "") for item in message.get("content", [])
                     if isinstance(item, dict) and item.get("type") == "text")


def _events(agent: Path):
    files = list((agent / "dsh-home" / "sessions").rglob("session.v4.jsonl"))
    if len(files) != 1:
        return None, None, "expected exactly one Session v4"
    try:
        rows = [json.loads(line) for line in files[0].read_text(encoding="utf-8").splitlines() if line]
    except (OSError, ValueError):
        return None, None, "invalid Session JSONL"
    if not rows or rows[0].get("type") != "session" or rows[0].get("version") != 4:
        return None, None, "unsupported Session header"
    return rows[0].get("id"), rows[1:], None


def _fixture_bodies(fixture: Path) -> dict[str, str]:
    bodies = {}
    with tarfile.open(fixture) as archive:
        for entry in archive.getmembers():
            if entry.isfile() and entry.name.endswith("/SKILL.md"):
                file = archive.extractfile(entry)
                if file is None:
                    raise ValueError("fixture entry unreadable")
                raw = file.read().decode("utf-8")
                bodies[entry.name.split("/", 1)[0]] = raw.split("\n---\n", 1)[-1].strip()
    return bodies


def _tool_history(events: list[dict]) -> tuple[list[dict], list[dict], str]:
    calls = {}
    ordered = []
    results = []
    final_text = ""
    for event in events:
        kind = event.get("type")
        data = event.get("data") or {}
        if kind == "tool/call":
            try:
                args = json.loads(data.get("arguments") or "{}")
            except (TypeError, ValueError):
                args = {}
            call = {"call_id": data.get("callId"), "name": data.get("name"),
                    "arguments": args, "step": data.get("step")}
            calls[call["call_id"]] = call
            ordered.append(call)
        elif kind == "tool/result":
            message = data.get("message") or {}
            source_id = (message.get("source") or {}).get("callId")
            message_id = message.get("toolCallId")
            call_id = source_id or message_id
            call = calls.get(call_id, {})
            results.append({**call, "text": _text(message), "is_error": message.get("isError"),
                            "meta": data.get("meta"), "result_call_id": call_id,
                            "call_linked": bool(call), "call_ids_agree": not(source_id and message_id)
                            or source_id == message_id})
        elif kind == "assistant/message":
            text = _text(data.get("message") or {})
            if text:
                final_text = text
    return ordered, results, final_text


def _catalogs(events: list[dict]) -> list[dict]:
    catalogs = []
    for event in events:
        if event.get("type") != "user/message":
            continue
        message = event.get("data") or {}
        source = message.get("source") or {}
        if source.get("kind") in ("skill-catalog", "jev-skill-catalog"):
            catalogs.append({"kind": source["kind"], "entries": source.get("entries"),
                             "text": _text(message), "chars": len(_text(message)),
                             **({"selection": source["selection"]} if "selection" in source else {})})
    return catalogs


def _selection_parameters(catalogs: list[dict]) -> dict | None:
    """Read this single-judgment slot's recorded settings; old catalogs retain top-five rules."""
    settings = [catalog["selection"] for catalog in catalogs
                if catalog.get("kind") == "jev-skill-catalog" and "selection" in catalog]
    if not settings:
        return None
    if len(settings) != 1 or not isinstance(settings[0], dict):
        raise ValueError("expected one catalog with recorded selection parameters")
    selection = settings[0]
    minimum, limit = selection.get("skillMinProbability"), selection.get("skillLimit")
    if type(minimum) not in (int, float) or not math.isfinite(minimum) or not 0 <= minimum <= 1 \
            or type(limit) is not int or not 1 <= limit <= 9007199254740991:
        raise ValueError("invalid recorded selection parameters")
    return selection


def _selected_names(scores: list[dict], selection: dict | None) -> list[str]:
    """Apply recorded eligibility, stable probability order, and limit, or legacy top five."""
    eligible = scores if selection is None else [item for item in scores
                                                if item["probability"] >= selection["skillMinProbability"]]
    ranked = sorted(eligible, key=lambda item: (-item["probability"], item["original_index"]))
    return [item["name"] for item in ranked[:5 if selection is None else selection["skillLimit"]]]


def _operation(agent: Path, session_id: str | None) -> tuple[list[dict], int]:
    records = []
    invalid = 0
    for file in (agent / "dsh-home" / "storages").glob("jev_*/operations/*.json"):
        saved = _json(file)
        record = saved.get("record") if isinstance(saved, dict) else None
        if not isinstance(record, dict):
            invalid += 1
        elif record.get("sessionId") == session_id or (record.get("link") or {}).get("sessionId") == session_id:
            records.append(record)
    return records, invalid


def _has_token(text: str, token: str) -> bool:
    return bool(re.search(r"(?<![A-Za-z0-9])" + re.escape(token) + r"(?![A-Za-z0-9])", text))


def inspect_skill_slot(batch: Path, case_id: str, arm: str) -> dict:
    """Return structure, use, and semantic layers without inventing missing evidence."""
    if case_id not in CASE_ORDER or arm not in ("baseline", "skill_selection"):
        raise ValueError("unknown skill slot")
    batch = Path(batch)
    case_root = batch / "skills" / "cases" / case_id
    truth = _json(case_root / "truth.json")
    manifest = batch / "skills" / "manifest.json"
    jobs = batch / "jobs" / "skills" / case_id / arm
    from bench.completion_skill.cs_suite.collector import inspect_basic
    result, events, records = inspect_basic(batch, "skills", case_id, arm, jobs, manifest)
    result.update(provider_problem=False, semantic=None)
    if not isinstance(truth, dict) or not isinstance(_json(manifest), dict):
        result["blocking_errors"].append("frozen truth or plan unavailable")
        return result
    result["candidate_names"] = truth["candidate_names"]
    result["relevant_names"] = truth["relevant_names"]
    result["required_names"] = truth["required_names"]
    if result["status"] != "completed" or not events:
        return result
    agent = Path(result["agent_dir"])
    result["fixture_integrity"] = (_json(agent / "fixture-integrity.json") or {}).get("status")
    if result["fixture_integrity"] != "unchanged":
        result["blocking_errors"].append("frozen skill fixture integrity is not unchanged")
    endings = [(event.get("data") or {}).get("reason") for event in events if event.get("type") == "turn/end"]
    if len(endings) != 1 or (endings[0] or {}).get("kind") != "completed":
        result["blocking_errors"].append("Session lacks one normally completed turn")
    calls, tool_results, final_text = _tool_history(events)
    result["tool_calls"] = [{"name": call["name"], "arguments": call["arguments"]} for call in calls]
    result["final_answer"] = final_text
    if any(not item["call_linked"] or not item["call_ids_agree"] for item in tool_results):
        result["blocking_errors"].append("tool result cannot be linked to its native call")
    result["behavior_errors"] = [
        {"name": item.get("name"), "arguments": item.get("arguments"), "text": item["text"]}
        for item in tool_results if item["is_error"]
    ]
    if any(item["is_error"] and item.get("name") == "skill_catalog" for item in tool_results):
        result["blocking_errors"].append("native full catalog tool failed")
    if any(item["is_error"] and item.get("name") == "skill"
           and item.get("arguments", {}).get("name") in truth["candidate_names"] for item in tool_results):
        result["blocking_errors"].append("native skill loader failed for a present candidate")
    catalogs = _catalogs(events)
    selection_valid = True
    try:
        selection = _selection_parameters(catalogs)
    except ValueError as exc:
        result["blocking_errors"].append(str(exc))
        selection = None
        selection_valid = False
    result["selection_parameters"] = selection
    result["published_catalogs"] = catalogs
    published = [entry["name"] for catalog in catalogs for entry in (catalog["entries"] or [])
                 if isinstance(entry, dict) and isinstance(entry.get("name"), str)]
    published_entries = [entry for catalog in catalogs for entry in (catalog["entries"] or [])
                         if isinstance(entry, dict)]
    result["published_names"] = published
    result["published_descriptions_match_fixture"] = all(
        truth["candidate_descriptions"].get(entry.get("name")) == entry.get("description")
        for entry in published_entries
    )
    result["published_unique_names"] = list(dict.fromkeys(published))
    result["catalog_chars"] = sum(catalog["chars"] for catalog in catalogs)
    result["catalog_tokens"] = None  # Session has full characters but no per-catalog token accounting.

    try:
        bodies = _fixture_bodies(case_root / "fixture.tar")
    except (OSError, ValueError, tarfile.TarError) as exc:
        result["blocking_errors"].append(f"fixture bodies unavailable: {exc}")
        return result
    if sorted(bodies) != truth["candidate_names"]:
        result["blocking_errors"].append("fixture candidates differ from frozen truth")
    catalog_calls = [item for item in calls if item["name"] == "skill_catalog"]
    catalog_results = [item for item in tool_results if item.get("name") == "skill_catalog"]
    all_names = [name for name in truth["candidate_names"]
                 if any(re.search(r"(?m)^- " + re.escape(name) + r": ", item["text"])
                        for item in catalog_results if not item["is_error"])]
    result["recovered_catalog_names"] = all_names
    result["catalog_called"] = bool(catalog_calls)
    result["recovery_result_chars"] = sum(len(item["text"]) for item in catalog_results)
    result["catalog_complete"] = bool(catalog_results) and sorted(all_names) == truth["candidate_names"] \
        and all(any(f"- {name}: {description}" in item["text"] for item in catalog_results
                    if not item["is_error"])
                for name, description in truth["candidate_descriptions"].items())
    skill_results = [item for item in tool_results if item.get("name") == "skill"]
    loaded = [item.get("arguments", {}).get("name") for item in skill_results if not item["is_error"]]
    loaded = [name for name in loaded if isinstance(name, str)]
    result["loaded_names"] = loaded
    loaded_body_hashes = {}
    for item in skill_results:
        name = item.get("arguments", {}).get("name")
        if name not in bodies or item["is_error"]:
            continue
        match = re.search(r"<skill_instructions>\n(.*?)\n</skill_instructions>", item["text"], re.S)
        if match:
            loaded_body_hashes[name] = hashlib.sha256(match[1].encode("utf-8")).hexdigest()
    result["loaded_body_hashes"] = loaded_body_hashes
    result["loaded_body_verified"] = {name: loaded_body_hashes.get(name) == truth["body_hashes"][name]["body_sha256"]
                                       for name in bodies}
    result["answer_token_hits"] = {token: _has_token(final_text, token) for token in truth["answer_tokens"]}
    result["semantic"] = {
        "required_loaded": all(result["loaded_body_verified"].get(name) for name in truth["required_names"]),
        "irrelevant_loaded": [name for name in loaded if name not in truth["relevant_names"]],
        "answer_matches": all(result["answer_token_hits"].values()),
        "catalog_recovered": result["catalog_complete"] if truth["require_catalog"] else None,
    }
    result["semantic"]["irrelevant_load_constraint_met"] = (
        len(result["semantic"]["irrelevant_loaded"]) == 0 if truth["forbid_irrelevant_load"] else None
    )
    result["semantic"]["task_success"] = bool(
        result["semantic"]["required_loaded"] and result["semantic"]["answer_matches"]
        and (not truth["require_catalog"] or result["catalog_complete"])
        and (not truth["forbid_irrelevant_load"] or not result["semantic"]["irrelevant_loaded"])
    )

    expected_jev = arm == "skill_selection" and bool(truth["candidate_names"])
    result["jev_operation_count"] = len(records)
    if len(records) != (1 if expected_jev else 0):
        result["blocking_errors"].append("Jev operation count differs from eligible skill catalog")
    scores = []
    selected_names = None
    if expected_jev and len(records) == 1:
        record = records[0]
        attempts = record.get("attemptRecords") or []
        receipts = record.get("receipts") or []
        result["jev_receipts"] = receipts
        if record.get("featureId") != "skill-selection" or record.get("status") != "succeeded" \
                or len(attempts) != 1 or attempts[0].get("status") != "succeeded":
            result["blocking_errors"].append("Jev skill judgment did not succeed once")
            result["provider_problem"] = True
        else:
            errors_before = len(result["blocking_errors"])
            attempt = attempts[0]
            questions = (attempt.get("request") or {}).get("questions") or []
            answers = (attempt.get("response") or {}).get("answers") or []
            if len(questions) != len(truth["candidate_names"]) or len(answers) != len(questions):
                result["blocking_errors"].append("Jev did not judge all frozen candidates")
            for index, (question, answer) in enumerate(zip(questions, answers)):
                prompt = question.get("prompt", "")
                prefix = "Would this skill help the task? Skill: "
                name = prompt.split(prefix, 1)[-1].split(". Description: ", 1)[0]
                if question.get("id") != f"candidate-{index}" or answer.get("id") != question.get("id") \
                        or answer.get("kind") != "noul" or type(answer.get("probability")) not in (int, float) \
                        or not math.isfinite(answer["probability"]) or not 0 <= answer["probability"] <= 1:
                    result["blocking_errors"].append("invalid Jev answer identity or probability")
                    break
                scores.append({"name": name, "probability": answer["probability"],
                               "confidence": answer.get("confidence"), "original_index": index})
            if len(scores) != len(truth["candidate_names"]) or sorted(item["name"] for item in scores) != truth["candidate_names"]:
                result["blocking_errors"].append("Jev request omits or adds frozen candidates")
            request_text = json.dumps(attempt.get("request") or {}, ensure_ascii=False)
            result["jev_request_has_body"] = any(
                body.split("\n\n", 1)[-1] in request_text for body in bodies.values()
            )
            if result["jev_request_has_body"] or any(_has_token(request_text, token) for token in truth["answer_tokens"]
                                                     if token != "42"):
                result["blocking_errors"].append("Jev request contains skill body material")
            result["jev_model"] = (attempt.get("rawResponse") or {}).get("model")
            result["jev_latency_ms"] = attempt.get("latencyMs")
            result["jev_usage"] = attempt.get("usage")
            if selection_valid and len(result["blocking_errors"]) == errors_before:
                selected_names = _selected_names(scores, selection)
                expected_receipts = ("skill-catalog-published", "skill-catalog-no-new") if selection is None \
                    else ("skill-catalog-published",) if selected_names else ("skill-catalog-no-relevant",)
                if not any(item.get("id") in expected_receipts
                           and item.get("status") == "observed" for item in receipts):
                    result["blocking_errors"].append("Jev catalog adoption receipt missing")
                    selected_names = None
    result["scores"] = scores
    ranked = sorted(scores, key=lambda item: (-item["probability"], item["original_index"]))
    result["ranked_names"] = [item["name"] for item in ranked]
    result["top5_names"] = result["ranked_names"][:5] if expected_jev else None
    relevant = truth["relevant_names"]
    result["recall_at_5"] = (sum(name in result["top5_names"] for name in relevant) / len(relevant)
                             if expected_jev and relevant and len(scores) == len(truth["candidate_names"]) else None)
    result["precision_at_5"] = (sum(name in relevant for name in result["top5_names"]) / len(result["top5_names"])
                                if expected_jev and result["top5_names"] else None)
    result["required_missing_top5"] = ([name for name in truth["required_names"] if name not in result["top5_names"]]
                                       if result["top5_names"] is not None else None)
    result["selected_names"] = selected_names
    result["required_missing_selected"] = ([name for name in truth["required_names"]
                                           if name not in result["selected_names"]]
                                          if result["selected_names"] is not None else None)
    wanted = result["selected_names"] if expected_jev else truth["candidate_names"]
    result["publication_matches_expected"] = wanted is not None and published == wanted
    result["duplicate_published_names"] = sorted({name for name in published if published.count(name) > 1})

    result["structural_ok"] = not result["blocking_errors"]
    return result

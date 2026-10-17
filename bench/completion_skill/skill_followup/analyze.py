"""Separate native skill participation, repository reading, source truth, and cost."""

from __future__ import annotations

import hashlib
import json
import math
import re
import tarfile
from collections import Counter
from pathlib import Path

from bench.completion_skill.cs_suite.collector import inspect_basic
from bench.completion_skill.skills.analyze import _catalogs, _events, _selected_names, _selection_parameters, _tool_history

from .cases import CASE_ORDER


def _json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _content(message: dict) -> str:
    return "\n".join(item.get("text", "") for item in message.get("content", [])
                     if isinstance(item, dict) and item.get("type") == "text")


def _step_usage(events: list[dict]) -> dict:
    """A cost is complete only when every started model step settled with usage."""
    started = Counter((data.get("turn"), data.get("step")) for event in events
                      if event.get("type") == "step/start" for data in [event.get("data") or {}])
    ended = Counter((data.get("turn"), data.get("step")) for event in events
                    if event.get("type") == "step/end" for data in [event.get("data") or {}])
    response_count = Counter()
    usage_errors = []
    rows = []
    for event in events:
        kind = event.get("type")
        if kind not in ("assistant/message", "assistant/attempt"):
            continue
        data = event.get("data") or {}
        key = (data.get("turn"), data.get("step"))
        response_count[key] += 1
        if kind == "assistant/message":
            usage = data.get("usage")
        else:
            usage_errors.append(f"assistant/attempt at {key} records a failed or cancelled model attempt")
            usage_chunks = [(item.get("chunk") or {}).get("usage") for item in data.get("stream") or []
                            if (item.get("chunk") or {}).get("type") == "usage"]
            usage = usage_chunks[-1] if usage_chunks else None
        complete = isinstance(usage, dict) and all(
            type(usage.get(name)) is int and usage[name] >= 0
            for name in ("inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"))
        rows.append({"turn": key[0], "step": key[1], "kind": kind,
                     "usage_complete": complete, "usage": usage if complete else None})
        if not complete:
            usage_errors.append(f"{kind} at {key} has no complete usage")
    if not started:
        usage_errors.append("Session has no step/start")
    for key, count in started.items():
        if count != 1 or ended[key] != 1:
            usage_errors.append(f"step {key} did not close exactly once")
        if response_count[key] < 1:
            usage_errors.append(f"step {key} has no assistant response or attempt")
    for key in {*ended, *response_count} - set(started):
        usage_errors.append(f"step {key} has events without step/start")
    turns = [(event.get("data") or {}).get("reason") for event in events if event.get("type") == "turn/end"]
    if len(turns) != 1 or (turns[0] or {}).get("kind") != "completed":
        usage_errors.append("Session lacks one normally completed turn")
    return {"started": len(started), "closed": sum(ended.values()),
            "responses_and_attempts": rows, "errors": usage_errors,
            "complete": not usage_errors,
            "delivery_receipts": sum(event.get("type") == "session-log-deepseek/delivery-accepted" for event in events)}


def _source_paths(text: str, known: set[str]) -> list[str]:
    mentioned = re.findall(r"(?<![\w/])(?:\./|/app/)?(study/[A-Za-z0-9_./-]+\.mjs)", text)
    return sorted({path for path in mentioned if path in known})


def _normal_path(path: str) -> str:
    return path.removeprefix("/app/").removeprefix("./")


def _study_scoped_search(call: dict) -> bool:
    args = call.get("arguments") or {}
    path = args.get("path")
    pattern = args.get("pattern")
    if isinstance(path, str) and (_normal_path(path) == "study" or _normal_path(path).startswith("study/")):
        return True
    return (path in (None, ".") and isinstance(pattern, str)
            and _normal_path(pattern).startswith("study/"))


def _tool_metrics(calls: list[dict], results: list[dict], known: set[str]) -> dict:
    by_name = Counter(call["name"] for call in calls)
    tool_names = ("read", "grep", "glob", "bash")
    returned = {name: sum(len(item["text"].encode("utf-8")) for item in results
                          if item.get("name") == name and not item["is_error"])
                for name in tool_names}
    source_read_results = [item for item in results if item.get("name") == "read" and not item["is_error"]
                           and isinstance(item.get("arguments", {}).get("file_path"), str)
                           and _normal_path(item["arguments"]["file_path"]) in known]
    source_read_paths = sorted({_normal_path(item["arguments"]["file_path"])
                                for item in source_read_results})
    study_search_calls = {name: sum(call["name"] == name and _study_scoped_search(call)
                                    for call in calls) for name in ("grep", "glob")}
    study_search_result_bytes = {name: sum(len(item["text"].encode("utf-8")) for item in results
                                           if item.get("name") == name and not item["is_error"]
                                           and _study_scoped_search(item)) for name in ("grep", "glob")}
    visible_paths = sorted({path for item in results if item.get("name") in ("read", "grep", "glob")
                            for path in _source_paths(item["text"], known)})
    bash = [{"arguments": call.get("arguments"), "step": call.get("step")}
            for call in calls if call["name"] == "bash"]
    return {"all_native_calls": {name: by_name[name] for name in tool_names},
            "all_native_result_utf8_bytes": returned,
            "confirmed_study_read": {"successful_calls": len(source_read_results),
                                     "unique_files": source_read_paths,
                                     "result_utf8_bytes": sum(len(item["text"].encode("utf-8"))
                                                              for item in source_read_results)},
            "study_scoped_search_calls": study_search_calls,
            "study_scoped_search_result_utf8_bytes": study_search_result_bytes,
            "unscoped_search_calls": {name: by_name[name] - study_search_calls[name]
                                      for name in ("grep", "glob")},
            "visible_source_path_mentions": visible_paths,
            "bash_commands": bash,
            "interpretation": "Native result UTF-8 bytes include tool formatting; bash internal file reads are unknown"}


def _skill_metrics(calls: list[dict], results: list[dict], truth: dict) -> dict:
    loaded = []
    for item in results:
        if item.get("name") != "skill":
            continue
        name = item.get("arguments", {}).get("name")
        match = re.search(r"<skill_instructions>\n(.*?)\n</skill_instructions>", item["text"], re.S)
        body = match[1] if match else None
        checksum = hashlib.sha256(body.encode("utf-8")).hexdigest() if body is not None else None
        loaded.append({"name": name, "is_error": item["is_error"],
                       "result_linked": item["call_linked"] and item["call_ids_agree"],
                       "body_sha256": checksum,
                       "body_utf8_bytes": len(body.encode("utf-8")) if body is not None else None,
                       "matches_frozen_body": isinstance(name, str)
                       and checksum == truth["body_sha256"].get(name)})
    catalogs = [item for item in results if item.get("name") == "skill_catalog"]
    recovered = sorted({name for name in truth["candidate_names"]
                        if any(re.search(r"(?m)^- " + re.escape(name) + r": ", item["text"])
                               for item in catalogs if not item["is_error"])})
    return {"load_calls": sum(call["name"] == "skill" for call in calls),
            "loaded": loaded, "loaded_body_utf8_bytes": sum(item["body_utf8_bytes"] or 0 for item in loaded),
            "required_loaded_names": [name for name in truth["required_names"]
                                      if any(item["name"] == name and item["matches_frozen_body"] for item in loaded)],
            "catalog_calls": sum(call["name"] == "skill_catalog" for call in calls),
            "catalog_recovered_names": recovered,
            "catalog_full_recovery": bool(catalogs) and recovered == truth["candidate_names"],
            "catalog_returned_utf8_bytes": sum(len(item["text"].encode("utf-8")) for item in catalogs
                                               if not item["is_error"])}


def _mechanical_hints(case: str, answer: str, truth: dict) -> dict:
    oracle = truth["oracle"]
    if case == "research-one":
        probes = {"renewal_yes": bool(re.search(r"\b(?:yes|renew(?:ed|s)?|extend(?:ed|s)?)\b", answer, re.I)),
                  "expiry_minutes": bool(re.search(r"(?<!\d)" + str(oracle["expiresAfterMinutes"]) + r"(?!\d)", answer)),
                  "idle_limit_minutes": bool(re.search(r"(?<!\d)" + str(oracle["idleLimitMinutes"]) + r"(?!\d)", answer)),
                  "renew_window_minutes": bool(re.search(r"(?<!\d)" + str(oracle["renewWithinMinutes"]) + r"(?!\d)", answer))}
    else:
        probes = {"first_invoice_amount": "100" in answer, "second_invoice_amount": "70" in answer,
                  "second_remaining": "20" in answer,
                  "scrub_days": bool(re.search(r"(?<!\d)" + str(oracle["scrubScheduledAfterDays"]) + r"(?!\d)", answer)),
                  "removed_fields": all(field in answer for field in oracle["removedFields"]),
                  "retained_fields": all(field in answer for field in oracle["retainedFields"])}
    return {"hint_hits": probes,
            "source_path_mentions": _source_paths(answer, set(truth["source_files"])),
            "note": "Mechanical hints are not the task verdict; root checks facts and source evidence"}


def inspect_slot(batch: Path, slot: dict) -> dict:
    """Read one real trial without treating optional skill use as a gate."""
    batch = Path(batch).resolve()
    case, condition = slot["case"], slot["condition"]
    if case not in CASE_ORDER or condition not in ("baseline", "skill_selection"):
        raise ValueError("unknown follow-up slot")
    truth = _json(batch / "cases" / case / "truth.json")
    basic, events, operations = inspect_basic(
        batch, "skills", case, condition, batch / "jobs" / f"{slot['slot']:02d}",
        batch / "manifest.json")
    basic.update(slot=slot["slot"], repeat=slot["repeat"], pair_order=slot["pair_order"],
                 family="skill-followup", required_names=truth["required_names"] if truth else None)
    if not isinstance(truth, dict):
        basic["blocking_errors"].append("frozen repository truth is unavailable")
        return basic
    if basic["status"] != "completed" or not events:
        return basic
    agent = Path(basic["agent_dir"])
    integrity = _json(agent / "fixture-integrity.json") or {}
    basic["fixture_integrity"] = integrity
    if any((integrity.get(kind) or {}).get("status") != "unchanged" for kind in ("repo", "skills")):
        basic["blocking_errors"].append("frozen source or skill files changed or cannot be verified")
    steps = _step_usage(events)
    basic["step_closure"] = steps
    if not steps["complete"]:
        basic["blocking_errors"].extend(steps["errors"])
        basic["partial_known_estimated_usd"] = basic.get("known_estimated_usd")
        basic["known_estimated_usd"] = None
        basic["usage_complete"] = False
    calls, results, answer = _tool_history(events)
    basic["tool_calls"] = [{"name": call["name"], "arguments": call["arguments"], "step": call["step"]}
                           for call in calls]
    if any(not item["call_linked"] or not item["call_ids_agree"] for item in results):
        basic["blocking_errors"].append("a native tool result cannot be paired to its call")
    basic["tool_errors"] = [{"name": item.get("name"), "arguments": item.get("arguments"),
                             "text": item["text"][:500]} for item in results if item["is_error"]]
    basic["repo_tools"] = _tool_metrics(calls, results, set(truth["source_files"]))
    basic["skill_tools"] = _skill_metrics(calls, results, truth)
    basic["final_answer"] = answer
    basic["answer_hints"] = _mechanical_hints(case, answer, truth)
    basic["oracle"] = truth["oracle"]
    catalogs = _catalogs(events)
    selection_valid = True
    try:
        selection = _selection_parameters(catalogs)
    except ValueError as exc:
        basic["blocking_errors"].append(str(exc))
        selection = None
        selection_valid = False
    basic["selection_parameters"] = selection
    published = [entry for catalog in catalogs for entry in (catalog["entries"] or [])
                 if isinstance(entry, dict)]
    basic["published_catalogs"] = [{"kind": catalog["kind"], "entries": catalog["entries"],
                                    "chars": catalog["chars"],
                                    **({"selection": catalog["selection"]} if "selection" in catalog else {})}
                                   for catalog in catalogs]
    basic["published_names"] = [entry.get("name") for entry in published]
    basic["catalog_chars"] = sum(catalog["chars"] for catalog in catalogs)
    if any(truth["candidate_descriptions"].get(entry.get("name")) != entry.get("description")
           for entry in published):
        basic["blocking_errors"].append("published catalog metadata differs from frozen candidates")
    eligible = condition == "skill_selection"
    basic["candidate_names"] = truth["candidate_names"]
    basic["jev_operation_count"] = len(operations)
    if len(operations) != (1 if eligible else 0):
        basic["blocking_errors"].append("Jev operation count differs from selected condition")
    scores = []
    selected_names = None
    if eligible and len(operations) == 1:
        record = operations[0]
        attempts = record.get("attemptRecords") or []
        basic["jev_receipts"] = [{"id": item.get("id"), "status": item.get("status")}
                                 for item in record.get("receipts") or []]
        if record.get("featureId") != "skill-selection" or record.get("status") != "succeeded" \
                or len(attempts) != 1 or attempts[0].get("status") != "succeeded":
            basic["blocking_errors"].append("Jev skill judgment did not succeed once")
        else:
            errors_before = len(basic["blocking_errors"])
            attempt = attempts[0]
            questions = (attempt.get("request") or {}).get("questions") or []
            answers = (attempt.get("response") or {}).get("answers") or []
            if len(questions) != 24 or len(answers) != 24:
                basic["blocking_errors"].append("Jev did not judge all 24 candidates")
            for index, (question, reply) in enumerate(zip(questions, answers)):
                prompt = question.get("prompt", "")
                name = prompt.split("Skill: ", 1)[-1].split(". Description: ", 1)[0]
                if question.get("id") != f"candidate-{index}" or reply.get("id") != question.get("id") \
                        or reply.get("kind") != "noul" or type(reply.get("probability")) not in (int, float) \
                        or not math.isfinite(reply["probability"]) or not 0 <= reply["probability"] <= 1:
                    basic["blocking_errors"].append("Jev candidate identity or probability invalid")
                    break
                expected = truth["candidate_descriptions"].get(name)
                if expected is None or prompt != f"Would this skill help the task? Skill: {name}. Description: {expected}":
                    basic["blocking_errors"].append("Jev candidate metadata differs from frozen skill")
                scores.append({"name": name, "probability": reply["probability"],
                               "confidence": reply.get("confidence"), "original_index": index})
            if sorted(item["name"] for item in scores) != truth["candidate_names"]:
                basic["blocking_errors"].append("Jev questions did not cover the frozen directory")
            request_text = json.dumps(attempt.get("request") or {}, ensure_ascii=False)
            bodies = []
            with tarfile.open(batch / "cases" / case / "skill-fixture.tar") as archive:
                for member in archive.getmembers():
                    if member.isfile():
                        file = archive.extractfile(member)
                        if file is not None:
                            body = file.read().decode("utf-8").split("\n---\n", 1)[-1].strip()
                            bodies.append(body.split("\n\n", 1)[-1])
            basic["jev_request_has_body"] = any(body in request_text for body in bodies if body)
            if basic["jev_request_has_body"]:
                basic["blocking_errors"].append("Jev relevance input contains skill body")
            basic["jev_model"] = (attempt.get("rawResponse") or {}).get("model")
            basic["jev_latency_ms"] = attempt.get("latencyMs")
            if selection_valid and len(basic["blocking_errors"]) == errors_before:
                selected_names = _selected_names(scores, selection)
                expected_receipts = ("skill-catalog-published", "skill-catalog-no-new") if selection is None \
                    else ("skill-catalog-published",) if selected_names else ("skill-catalog-no-relevant",)
                if not any(item["id"] in expected_receipts
                           and item["status"] == "observed" for item in basic["jev_receipts"]):
                    basic["blocking_errors"].append("Jev publication receipt missing")
                    selected_names = None
    basic["scores"] = scores
    ranked = sorted(scores, key=lambda item: (-item["probability"], item["original_index"]))
    basic["ranked_names"] = [item["name"] for item in ranked]
    basic["top5_names"] = basic["ranked_names"][:5] if eligible else None
    basic["recall_at_5"] = (sum(name in basic["top5_names"] for name in truth["relevant_names"])
                            / len(truth["relevant_names"]) if eligible and len(scores) == 24 else None)
    basic["selected_names"] = selected_names
    basic["required_missing_selected"] = ([name for name in truth["required_names"]
                                          if name not in basic["selected_names"]]
                                         if basic["selected_names"] is not None else None)
    expected_published = basic["selected_names"] if eligible else truth["candidate_names"]
    basic["publication_matches_scores"] = basic["published_names"] == expected_published
    basic["duplicate_published_names"] = sorted({name for name in basic["published_names"]
                                                 if basic["published_names"].count(name) > 1})
    basic["structural_ok"] = not basic["blocking_errors"]
    if not basic["structural_ok"] or not basic["usage_complete"]:
        basic["cost_status"] = "unknown" if basic["known_estimated_usd"] is None else "known-with-structural-failure"
    else:
        basic["cost_status"] = "complete-estimate"
    return basic

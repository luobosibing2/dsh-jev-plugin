"""Check frozen inputs and advance the sixteen-slot diagnostic serially."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from bench.deepswe.cli import _check_dsh_lock
from bench.deepswe.config import digest, load
from bench.completion_skill.cs_suite.runner import redact_output
from bench.completion_skill.resources import same_scenario_identity

from .analyze import inspect_slot
from .cases import CASE_ORDER, LABELS
from .jobs import job_config
from .prepare import REPO_ROOT, SOURCE_TEMPLATE, inputs, schedule
from .profile import CONDITIONS, expected_features, profile_rows, profiles_match_except_feature


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def require_startable_state(path: Path) -> None:
    """Never resume a running or halted paid batch implicitly."""
    if path.is_file() and _read(path).get("state") in ("running", "halted"):
        raise RuntimeError("previous recovery slot is running or halted; no implicit resume")


def check(batch: Path) -> dict:
    """Reject changed source, case bytes, resources, profiles, jobs, or order."""
    batch = Path(batch).resolve()
    lock = _read(batch / "suite-lock.json")
    planned = _read(batch / "schedule.json")["slots"]
    if lock.get("slot_count") != 16 or planned != schedule() or digest(batch / "schedule.json") != lock.get("schedule_sha256"):
        raise RuntimeError("sixteen-slot AB/BA schedule differs from frozen lock")
    current = inputs(batch)
    if current != lock.get("inputs_sha256"):
        old = lock.get("inputs_sha256") or {}
        changed = sorted(name for name in {*old, *current} if old.get(name) != current.get(name))
        raise RuntimeError(f"frozen recovery inputs changed: {changed[:12]}")
    plan = load(batch / "manifest.json")
    if not same_scenario_identity(plan, SOURCE_TEMPLATE.name) or digest(SOURCE_TEMPLATE) != lock.get("scenario_template_sha256"):
        raise RuntimeError("recovery scenario differs from tracked template")
    _check_dsh_lock(batch, plan)
    if plan["phase"] != "formal" or plan["model"]["provider"] != "deepseek-official" \
            or plan["model"]["endpoint"] != "https://api.deepseek.com/anthropic" \
            or plan["jev"]["endpoint"] != "https://api.typesafe.ai/v1/systemone" \
            or plan["main_execution"] != "scripted-initial-real-followup" \
            or plan["budget"]["agent_timeout_sec"] != 240 \
            or plan["budget"]["max_batch_spend_usd"] != 0.25 \
            or plan["budget"]["max_infrastructure_retries"] != 0:
        raise RuntimeError("formal recovery route or limits changed")
    patches = [_read(batch / "profiles" / f"{condition}.patch.json") for condition in CONDITIONS]
    if patches != [profile_rows(plan, condition) for condition in CONDITIONS] or not profiles_match_except_feature(*patches):
        raise RuntimeError("paired profiles differ beyond completion feature")
    for condition, patch in zip(CONDITIONS, patches):
        if next(row for row in patch if row.get("id") == "jev")["config"]["features"] != expected_features(condition):
            raise RuntimeError("unrelated Jev switch was enabled")
    for case in CASE_ORDER:
        root = batch / "cases" / case
        truth = _read(root / "truth.json")
        if truth.get("case") != case or truth.get("initial_label") != LABELS[case] or not truth.get("seed_sha256"):
            raise RuntimeError("fixed case truth differs")
        if _read(root / "fixture-expected.json") != truth["seed_sha256"]:
            raise RuntimeError("case seed hash manifest differs")
    for slot in planned:
        path = batch / "slots" / f"{slot['slot']:02d}" / "job.json"
        if _read(path) != job_config(batch, slot):
            raise RuntimeError(f"Pier job differs in slot {slot['slot']}")
    return {"batch": str(batch), "slots": 16, "input_files": len(current),
            "lock_sha256": digest(batch / "suite-lock.json"),
            "max_known_estimated_usd_before_next": 0.25}


def report(batch: Path) -> dict:
    """Retain all planned denominators, unknown cost, and manual semantic review."""
    batch = Path(batch).resolve()
    rows = [inspect_slot(batch, slot) for slot in schedule()]
    started = [row for row in rows if row["status"] in ("started", "completed")]
    unknown = [row["slot"] for row in started if row.get("known_estimated_usd") is None]
    known = sum(row["known_estimated_usd"] for row in started if row.get("known_estimated_usd") is not None)
    by_case = {case: {"planned": 4, "completed": sum(row["status"] == "completed" for row in rows if row["case"] == case),
                      "first_verdicts": {label: sum(row.get("first_assessment") == label for row in rows if row["case"] == case)
                                         for label in ("complete", "omission", "needs-user", "unknown")},
                      "real_followup_calls": sum(row.get("real_request_count") or 0 for row in rows if row["case"] == case)}
               for case in CASE_ORDER}
    pairs = []
    for index in range(0, len(rows), 2):
        left, right = rows[index:index + 2]
        comparable = (left["status"] == right["status"] == "completed"
                      and left["structural_ok"] and right["structural_ok"]
                      and left.get("tool_schema_hashes") == right.get("tool_schema_hashes")
                      and len(left.get("tool_schema_hashes") or []) == 1)
        pairs.append({"case": left["case"], "repeat": left["repeat"],
                      "order": left["pair_order"], "slots": [left["slot"], right["slot"]],
                      "same_full_tool_schema": comparable})
    output = {"planned_slots": 16, "completed_slots": sum(row["status"] == "completed" for row in rows),
              "rows": rows, "cases": by_case, "pairs": pairs, "known_estimated_usd": known,
              "unknown_cost_slots": unknown, "cost_complete": not unknown,
              "total_estimated_usd": None if unknown else known,
              "scope": "fixed scripted initial errors with autonomous real-model follow-up only after native supplement",
              "limitations": ["Synthetic first-answer frequency is not a natural coding error rate",
                              "A Jev answer is not adoption or final task success",
                              "DSH StreamChunk does not export the DeepSeek server response model ID; request alias is recorded separately",
                              "Final semantics require manual review of raw evidence"]}
    _write(batch / "report.json", output)
    lines = ["## 直接答案", "", f"计划16槽，已完成{output['completed_slots']}/16；已知峰价估算USD {known:.9f}。"
             + (f"费用未知槽：{unknown}。" if unknown else "已开始槽费用记录完整。"), "",
             "## 固定设计", "", "四案各两对，AB/BA顺序；初始工具与声明由脚本产生，只有当前请求的原生Jev补做进入模型请求后才由正常DeepSeek adapter处理。",
             "", "## 全部计划槽", "",
             "| 槽 | 案例 | 对/顺序 | 条件 | 状态 | 首判 | 原生补做 | 真实模型请求 | 文件真值 | 结构 | 已知USD |",
             "| ---: | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | ---: |"]
    for row in rows:
        fact = row.get("file_truth") or {}
        file_value = "未知" if fact.get("status") != "captured" else "种子完整=" + str(fact.get("seed_intact")) + ", 新文件=" + str(len(fact.get("created_files") or {}))
        lines.append("| " + " | ".join(str(cell) for cell in (
            row["slot"], row["case"], f"{row['repeat']}/{row['pair_order']}", row["condition"], row["status"],
            row.get("first_assessment"), len(row.get("native_supplement_events") or []),
            row.get("real_request_count"), file_value, row.get("structural_ok"), row.get("known_estimated_usd"))) + " |")
    lines += ["", "## 每案例分母", "", "| 案例 | 完成/计划 | complete | omission | needs-user | unknown | 真实补做请求 |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for case, item in by_case.items():
        labels = item["first_verdicts"]
        lines.append(f"| {case} | {item['completed']}/4 | {labels['complete']} | {labels['omission']} | {labels['needs-user']} | {labels['unknown']} | {item['real_followup_calls']} |")
    lines += ["", "## 边界与验证", "", "原始判断、可用性、动作回执、Session补做、实际请求、后续工具、终态文本和宿主文件哈希分别保存在report.json与各trial原始证据中。"
              "人工语义审查尚未填写时为null。初始脚本usage单列且不计DeepSeek费用；真实补做和Jev按记录用量及冻结峰价估算，缺用量保留未知。"
              "DSH当前导出请求路由及流用量，但不导出DeepSeek服务响应的model ID；该字段保留null，不把请求别名当响应身份。"
              "本批不能推断自然任务初始错误率或一般编码收益。", ""]
    (batch / "report.md").write_text("\n".join(lines), encoding="utf-8")
    return output


def run(batch: Path, *, next_only: bool = False) -> dict:
    """Use the protected launcher and stop before any unresolved next slot."""
    if os.environ.get("JEV_REC_CREDENTIAL_LAUNCHER") != "1":
        raise RuntimeError("use the protected completion recovery credential launcher")
    checked = check(batch)
    batch = Path(batch).resolve()
    state = batch / "run-state.json"
    require_startable_state(state)
    known = 0.0
    for slot in schedule():
        current = inspect_slot(batch, slot)
        if current["status"] == "completed":
            if not current["structural_ok"] or not current["usage_complete"]:
                raise RuntimeError(f"existing slot {slot['slot']} has incomplete evidence")
            known += current["known_estimated_usd"]
            continue
        if current["status"] != "not-started":
            raise RuntimeError(f"slot {slot['slot']} started without final evidence")
        if known >= checked["max_known_estimated_usd_before_next"]:
            raise RuntimeError("advisory USD 0.25 threshold reached before next slot")
        job = batch / "slots" / f"{slot['slot']:02d}" / "job.json"
        _write(state, {"state": "running", "slot": slot["slot"], "known_estimated_usd": known,
                       "at": datetime.now(timezone.utc).isoformat()})
        plan = _read(batch / "manifest.json")
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join((str(REPO_ROOT), env.get("PYTHONPATH", "")))
        process = subprocess.run(["uv", "run", "--project", plan["paths"]["pier"], "pier", "run",
                                  "--config", str(job), "--yes"], cwd=REPO_ROOT, env=env,
                                 capture_output=True, text=True, errors="replace", check=False)
        secrets = [env.get(name) for name in (plan["jev"]["credential_env"], plan["conditions"]["main_credential_env"])]
        (job.parent / "pier.stdout.txt").write_text(redact_output(process.stdout, secrets), encoding="utf-8")
        (job.parent / "pier.stderr.txt").write_text(redact_output(process.stderr, secrets), encoding="utf-8")
        current = inspect_slot(batch, slot)
        if process.returncode != 0 or not current["structural_ok"] or not current["usage_complete"]:
            _write(state, {"state": "halted", "slot": slot["slot"], "pier_exit_code": process.returncode,
                           "reasons": current.get("blocking_errors"), "at": datetime.now(timezone.utc).isoformat()})
            report(batch)
            raise RuntimeError(f"slot {slot['slot']} failed the stop gate")
        if slot["slot"] % 2 == 0:
            previous = inspect_slot(batch, schedule()[slot["slot"] - 2])
            if previous.get("tool_schema_hashes") != current.get("tool_schema_hashes"):
                _write(state, {"state": "halted", "slot": slot["slot"],
                               "reasons": ["paired full tool schema hash differs"],
                               "at": datetime.now(timezone.utc).isoformat()})
                report(batch)
                raise RuntimeError(f"slot {slot['slot']} differs from paired tool schema")
        known += current["known_estimated_usd"]
        _write(state, {"state": "between-slots", "last_slot": slot["slot"],
                       "known_estimated_usd": known, "at": datetime.now(timezone.utc).isoformat()})
        if next_only:
            return report(batch)
    _write(state, {"state": "complete", "slots": 16, "known_estimated_usd": known,
                   "at": datetime.now(timezone.utc).isoformat()})
    return report(batch)

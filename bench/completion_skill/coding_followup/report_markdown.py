"""Render a bounded Chinese report for the four planned coding trials."""

from __future__ import annotations

from pathlib import Path


def _cell(value: object) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value).replace("|", "\\|").replace("\n", " ")


def _link(batch: Path, target: str | None, label: str) -> str:
    if not target:
        return "N/A"
    return f"[{label}]({Path(target).relative_to(batch).as_posix()})"


def render(batch: Path, report: dict) -> Path:
    """Save the final or partial result without filling missing cells as zero."""
    batch = Path(batch).resolve()
    rows = report["rows"]
    missing = ", ".join(map(str, report["missing_cost_slots"])) or "无"
    lines = ["## 直接答案", "",
             f"计划四个独立trial，已有Pier结果 {report['completed_trials']}/4；费用完整：{_cell(report['cost_complete'])}，"
             f"未知费用槽：{missing}。完整槽的已知峰价估算为USD {_cell(report['known_estimated_usd'])}，"
             "这是按冻结费率计算的估算，不是账单。",
             "", "## 固定条件", "",
             "同一原始Vitest任务、base commit、镜像digest、插件tar、DSH/Pier/Node/npm版本、官方DeepSeek Flash/high、"
             "Jev1.13.0与独立原始verifier。两组Agent各1800秒、verifier各1800秒，"
             "顺序baseline→completion_check→completion_check→baseline（AB/BA），并发1、无自动重试。"
             "主模型浮动别名和先前600秒试次不并入这四槽的配对。",
             "", "## 四个计划槽", "",
             "| 槽 | 重复 | 条件 | 状态/结束 | Agent秒 | DeepSeek已结算消息 | Jev操作 | 完成判断观察 | 首/末判断 | 补做 | verifier reward | F2P | P2P | 已知估算USD | 原始证据 |",
             "| ---: | ---: | --- | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | --- | --- | ---: | --- |"]
    for number, row in enumerate(rows, 1):
        jev = row.get("jev") or {}
        main = row.get("main") or {}
        verifier = row.get("verifier") or {}
        timeline = row.get("jev_timeline") or []
        assessments = [item.get("assessment") for item in timeline]
        first_last = f"{assessments[0]} / {assessments[-1]}" if assessments else "N/A"
        f2p = (f"{verifier['f2p_passed']}/{verifier['f2p_total']}"
               if type(verifier.get("f2p_passed")) is int and type(verifier.get("f2p_total")) is int else "N/A")
        p2p = (f"{verifier['p2p_passed']}/{verifier['p2p_total']}"
               if type(verifier.get("p2p_passed")) is int and type(verifier.get("p2p_total")) is int else "N/A")
        cells = [number, row["slot"]["repeat"] + 1, row["slot"]["arm"],
                 f"{row['status']}/{row.get('termination') or 'N/A'}",
                 row.get("agent_execution_seconds"), main.get("calls"), jev.get("operations"),
                 (row.get("completion_participation") or {}).get("judgment_observed"),
                 first_last, row.get("supplement_requests"), verifier.get("reward"),
                 f2p, p2p, row.get("known_estimated_usd")]
        lines.append("| " + " | ".join(map(_cell, cells)) + " | " +
                     _link(batch, row.get("trial_result_path"), "trial") + " |")
    lines += ["", "## AB/BA配对", "",
              "| 重复 | 执行顺序 | 两槽结构完整 | baseline reward | completion reward | 差值 | 开启组判断观察 | 开启组Jev操作 | 开启组补做 |",
              "| ---: | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |"]
    for pair in report["pairs"]:
        cells = [pair["repeat"], "→".join(pair["order"]), pair["both_structurally_complete"],
                 pair["baseline_reward"], pair["completion_check_reward"], pair["reward_delta"],
                 pair["enabled_completion_judgment_observed"],
                 pair["enabled_jev_operations"], pair["enabled_supplements"]]
        lines.append("| " + " | ".join(map(_cell, cells)) + " |")
    lines += ["", "每个真实Jev判断的model、概率、confidence、引用、usage与receipt均在对应report.json行及原始operation中；"
              "Jev未触发时，应同时核正常turn结束和完整空导出，不能从空目录推定零用量。"
              "工具动作与最终diff需对照原生Session；独立任务质量以原始verifier reward/F2P/P2P判定，"
              "不以模型声明或Jev的complete代替。",
              "", "## 边界与验证", "",
              "这是单一原始任务的两次AB/BA配对，顺序平衡不等于统计显著。正常reward0或无补做属于有效结果；"
              "超时、悬置step、服务或用量未知使对应槽不可判定，并停止追加。"
              "已记录消息的峰价估算可单列，不能冒充完整槽费用或实际账单。"
              "本地报告保留全部未开始槽与失败，不覆盖首批26槽证据。", ""]
    output = batch / "report.md"
    output.write_text("\n".join(lines), encoding="utf-8")
    return output

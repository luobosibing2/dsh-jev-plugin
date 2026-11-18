"""Render a Chinese evidence index without turning partial results into success claims."""

from __future__ import annotations

from pathlib import Path


def _value(value: object) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value).replace("|", "\\|").replace("\n", " ")


def render(report: dict, batch: Path) -> Path:
    """Write a local report with fixed denominators and links to trial evidence."""
    batch = Path(batch).resolve()
    rows = report["rows"]
    count = report["completed_slots"]
    lines = ["## 直接答案", "",
             f"计划 26 个独立 trial，已完成 {count}/26。费用按冻结峰价估算：已知 USD {_value(report['known_estimated_usd'])}；"
             f"已启动槽的费用记录完整：{_value(report['cost_complete'])}；费用未知槽："
             f"{', '.join(map(str, report['missing_cost_slots'])) or '无'}。未完成或不可判定槽保留在下面表内。",
             "", "## 固定条件", "",
             "完成核查六类固定记录使用脚本主模型与真实 Jev；技能六类及一题原始 Vitest 编码任务使用真实 DeepSeek Flash/high 与 Jev 1.13.0。"
             "每例 baseline 先于开启组，正式执行并发 1、无自动重试。编码 Agent 限时 600 秒，短于原题默认 10800 秒；独立 verifier 保持原题 1800 秒。",
             "", "## 完成核查：首轮判断与后续结果", "",
             "| 固定案例 | 原始真值 | baseline | 开启组首轮 | 首轮正确 | 补做请求 | 终态文件事实 | Jev 次数 | 证据 |",
             "| --- | --- | --- | --- | --- | ---: | --- | ---: | --- |"]
    by_case = {}
    for row in rows:
        if row.get("family") == "completion":
            by_case.setdefault(row["case"], {})[row["condition"]] = row
    for case, pair in by_case.items():
        left, right = pair.get("baseline", {}), pair.get("completion_check", {})
        evidence = right.get("trial_result_path") or left.get("trial_result_path")
        link = f"[trial]({Path(evidence).relative_to(batch).as_posix()})" if evidence else "N/A"
        facts = right.get("workspace_truth") or left.get("workspace_truth") or {}
        fact = ", ".join(f"{key}={_value(value)}" for key, value in facts.items() if key not in ("changed_files", "seed_files_intact"))
        lines.append("| " + " | ".join(map(_value, [case, right.get("initial_gold") or left.get("initial_gold"),
            left.get("status"), right.get("first_verdict"), right.get("first_verdict_correct"),
            right.get("supplement_request_count"), fact or None,
            (right.get("jev") or {}).get("calls")])) + f" | {link} |")
    classify = report["completion_classification"]
    omission_rate = (f"{classify['omission_detected']}/{classify['omission_observed_denominator']}"
                     if classify["omission_observed_denominator"] else "N/A")
    false_rate = (f"{classify['false_supplement_count']}/{classify['false_supplement_observed_denominator']}"
                  if classify["false_supplement_observed_denominator"] else "N/A")
    lines += ["", f"原始三类混淆矩阵仅纳入开启组的预声明六案；已取得首轮判定 {6 - len(classify['missing_first_verdict_cases'])}/6。"
              f"遗漏检出 {omission_rate}（计划3）；"
              f"已观察非遗漏案例误补做 {false_rate}。"
              f"三类宏平均召回 {_value(classify['macro_recall'])}；任一类别分母空时记 N/A。",
              "", "| 真值 \\ 预测 | complete | omission | needs-user | unknown |",
              "| --- | ---: | ---: | ---: | ---: |"]
    for gold, cells in classify["matrix"].items():
        lines.append("| " + gold + " | " + " | ".join(str(cells[pred]) for pred in
                     ("complete", "omission", "needs-user", "unknown")) + " |")
    lines += ["", "补做通知和最终文件、测试结果分别记录；有后续 assistant 消息不等于修复。首轮真值与补做后的二次判定分开，二次判定不覆盖首轮。",
              "", "## 技能选择：目录、加载与交付", "",
              "| 固定案例 | 候选数 | baseline任务成功 | 开启组任务成功 | 原始排名recall@5 | 必需项漏入top5 | 实际选择遗漏必需项 | 实际加载正文 | 证据 |",
              "| --- | ---: | --- | --- | ---: | --- | --- | --- | --- |"]
    by_case = {}
    for row in rows:
        if row.get("family") == "skills":
            by_case.setdefault(row["case"], {})[row["condition"]] = row
    for case, pair in by_case.items():
        left, right = pair.get("baseline", {}), pair.get("skill_selection", {})
        evidence = right.get("trial_result_path") or left.get("trial_result_path")
        link = f"[trial]({Path(evidence).relative_to(batch).as_posix()})" if evidence else "N/A"
        cells = [case, len(right.get("candidate_names") or left.get("candidate_names") or []),
                 (left.get("semantic") or {}).get("task_success"),
                 (right.get("semantic") or {}).get("task_success"), right.get("recall_at_5"),
                 ", ".join(right.get("required_missing_top5") or []) if right.get("required_missing_top5") is not None else None,
                 ", ".join(right.get("required_missing_selected") or []) if right.get("required_missing_selected") is not None else None,
                 ", ".join(right.get("loaded_names") or []) if right.get("loaded_names") is not None else None]
        lines.append("| " + " | ".join(map(_value, cells)) + f" | {link} |")
    skill = report["skill_summary"]
    lines += ["", f"开启组有定义的原始排名 recall@5：{_value(skill['recall_at_5_defined_cases'])}/6 类，均值 {_value(skill['mean_recall_at_5'])}。"
              "该指标按全部分数的前五名计算；实际选择还应用当次记录的阈值和数量上限，缺少新元数据的历史目录按原top5规则核对。"
              "目录发布、完整目录恢复、具名正文 SHA 加载、最终答案和 Jev 相关性分数在各 trial 记录中独立列出。",
              "", "## 原始编码任务", ""]
    coding = report["coding_pair"]
    lines += [f"Vitest `vitest-duration-sharding` 配对 reward：baseline {_value(coding['baseline_reward'])}，"
              f"completion_check {_value(coding['completion_check_reward'])}，差值 {_value(coding['reward_delta'])}。"
              "下表只取独立 verifier 的原始 reward 字段；任一缺失时不推断任务通过。",
              "", "| 条件 | reward | F2P | P2P | apply_failed | verifier 结果 | 工作区 diff |",
              "| --- | ---: | --- | --- | --- | --- | --- |"]
    for row in (item for item in rows if item.get("family") == "coding"):
        metrics = row.get("verifier_metrics") or {}
        evidence = row.get("verifier_evidence") or {}
        reward_file = evidence.get("reward_json")
        patch_file = evidence.get("patch_diff")
        reward_link = f"[reward.json]({Path(reward_file).relative_to(batch).as_posix()})" if reward_file else "N/A"
        patch_link = f"[patch.diff]({Path(patch_file).relative_to(batch).as_posix()})" if patch_file else "N/A"
        f2p = (f"{metrics['f2p_passed']}/{metrics['f2p_total']}"
               if type(metrics.get("f2p_passed")) is int and type(metrics.get("f2p_total")) is int else "N/A")
        p2p = (f"{metrics['p2p_passed']}/{metrics['p2p_total']}"
               if type(metrics.get("p2p_passed")) is int and type(metrics.get("p2p_total")) is int else "N/A")
        lines.append("| " + " | ".join(map(_value, [row["condition"], metrics.get("reward"),
                                                  f2p, p2p, metrics.get("apply_failed")])) +
                     f" | {reward_link} | {patch_link} |")
    lines += ["", "原始任务 verifier 测试产物保存在对应 trial 目录；实验代码只读取 reward 与字段，不读取隐藏测试答案或 solution 内容。",
              "", "## 全部计划槽", "",
              "| 序号 | 家族 | 案例 | 条件 | 状态 | Agent秒 | 主模型调用 | Jev调用 | 已知估算USD | 结构检查 |",
              "| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |"]
    for number, row in enumerate(rows, 1):
        cells = [number, row["family"], row["case"], row["condition"], row.get("status"),
                 row.get("agent_execution_seconds"), (row.get("main") or {}).get("calls"),
                 (row.get("jev") or {}).get("calls"), row.get("known_estimated_usd"), row.get("structural_ok")]
        lines.append("| " + " | ".join(map(_value, cells)) + " |")
    lines += ["", "## 边界与验证", "",
              "固定完成记录的主模型为本地脚本，所报 token 仅为合成用量且真实 DeepSeek 调用为零。"
              "无费 probe 使用本地 Jev fixture，只验证公开 DSH/Pier 接口、工具可见性、原生 Session/ledger 与补做上限，不评价真实 Jev 语义准确率。"
              "正式记录中 Jev 服务与 DeepSeek 服务的用量、模型身份、延迟和失败按原始材料分别保存；费用是峰价估算，非账单。"
              "任何缺用量、需人工、服务失败或缺验证据使后续收费停止。单题编码配对和小样本固定案例均不支持普遍性能收益结论。", ""]
    path = batch / "report.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path

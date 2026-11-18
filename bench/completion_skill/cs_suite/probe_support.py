"""Create a keyless formal-shaped plan and manage loopback Jev for Pier probes."""

from __future__ import annotations

import json
import shutil
import asyncio
import shlex
from pathlib import Path


def make_probe_plan(real_manifest: Path, probe_dir: Path, model_module: Path) -> Path:
    """Copy frozen runtime dependencies into a probe batch with no external endpoints."""
    del model_module  # The probe Agent inserts its model fixture into the profile.
    real_manifest = Path(real_manifest).resolve()
    probe_dir = Path(probe_dir).resolve()
    if probe_dir.exists():
        raise FileExistsError(probe_dir)
    probe_dir.mkdir(parents=True)
    source_batch = real_manifest.parent
    for name in ("dsh-install", "evaluator-hashes.json"):
        source = source_batch / name
        target = probe_dir / name
        if source.is_dir():
            shutil.copytree(source, target, ignore=shutil.ignore_patterns("npm-cache", "node_modules"))
        else:
            shutil.copyfile(source, target)
    plan = json.loads(real_manifest.read_text(encoding="utf-8"))
    plan["phase"] = "formal"
    plan["model"] = {"provider": "eval-local", "id": "fixed-script", "route": "eval-local/fixed-script",
                     "reasoning_effort": "high", "endpoint": "http://127.0.0.1:0/v1/local",
                     "floating_alias": False}
    plan["jev"] = {**plan["jev"], "endpoint": "http://127.0.0.1:0/v1/systemone"}
    plan["conditions"]["main_credential_env"] = "EVAL_MAIN_PLACEHOLDER"
    plan["budget"]["agent_timeout_sec"] = 120
    plan["budget"]["max_infrastructure_retries"] = 0
    manifest = probe_dir / "manifest.json"
    manifest.write_text(json.dumps(plan, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest


def ready_poll_script(ready: str, pidfile: str) -> str:
    """Wait for readiness before checking liveness of a PID that may not exist yet."""
    ready_path = shlex.quote(ready)
    pid_path = shlex.quote(pidfile)
    return (f"until test -s {ready_path}; do "
            f"if test -s {pid_path} && ! kill -0 $(cat {pid_path}); then exit 1; fi; "
            f"sleep 0.05; done")


async def start_mock_jev(environment, response_spec_path: Path, evidence_prefix: str):
    """Start a local HTTP service on an OS-selected port and return its async disposer."""
    from bench.deepswe.agent import REMOTE

    remote_script = f"{REMOTE}/cs-mock-jev.mjs"
    remote_spec = f"{REMOTE}/cs-mock-jev-spec.json"
    ready = evidence_prefix + ".ready.json"
    evidence = evidence_prefix + ".requests.jsonl"
    pidfile = evidence_prefix + ".pid"
    await environment.upload_file(Path(__file__).with_name("mock_jev.mjs"), remote_script)
    await environment.upload_file(Path(response_spec_path), remote_spec)
    child = asyncio.create_task(environment.exec(
        f"sh -c 'echo $$ > {pidfile}; exec node {remote_script} {remote_spec} {ready} {evidence}' "
        f"> {evidence_prefix}.stdout.txt 2> {evidence_prefix}.stderr.txt",
        timeout_sec=600))
    async def close() -> None:
        stopped = await environment.exec(f"test -s {pidfile} && kill -TERM $(cat {pidfile})", timeout_sec=10)
        if stopped.return_code != 0 and not child.done():
            child.cancel()
            try:
                await child
            except asyncio.CancelledError:
                pass
            raise RuntimeError("Local Jev probe could not be stopped")
        try:
            finished = await asyncio.wait_for(child, timeout=10)
        except asyncio.TimeoutError as exc:
            await environment.exec(f"kill -KILL $(cat {pidfile})", timeout_sec=10)
            try:
                await asyncio.wait_for(child, timeout=10)
            except asyncio.TimeoutError:
                child.cancel()
                try:
                    await child
                except asyncio.CancelledError:
                    pass
            raise RuntimeError("Local Jev probe did not exit after TERM") from exc
        if finished.return_code != 0:
            raise RuntimeError("Local Jev probe exited with an error")

    try:
        wait = await environment.exec(
            f"timeout 10 sh -c {shlex.quote(ready_poll_script(ready, pidfile))}", timeout_sec=15)
        if wait.return_code != 0 or child.done():
            raise RuntimeError("Local Jev probe did not become ready")
        read = await environment.exec(f"cat {ready}", timeout_sec=10)
        if read.return_code != 0:
            raise RuntimeError("Local Jev probe readiness is unavailable")
        port = json.loads(read.stdout)["port"]
        if type(port) is not int or port < 1 or port > 65535:
            raise RuntimeError("Local Jev probe returned an invalid port")
    except BaseException:
        await close()
        raise
    return f"http://127.0.0.1:{port}/v1/systemone", close

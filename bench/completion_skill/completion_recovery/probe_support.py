"""Dynamic-port local DeepSeek transport for no-fee native probes."""

from __future__ import annotations

import asyncio
import json
import shlex
from pathlib import Path

from bench.deepswe.agent import REMOTE
from bench.completion_skill.cs_suite.probe_support import ready_poll_script


async def start_mock_main(environment, spec_path: Path, prefix: str):
    """Launch and fully tear down a loopback Messages server."""
    script = f"{REMOTE}/recovery-mock-main.mjs"
    spec = f"{REMOTE}/recovery-mock-main-spec.json"
    ready, requests, pid = prefix + ".ready.json", prefix + ".requests.jsonl", prefix + ".pid"
    await environment.upload_file(Path(__file__).with_name("mock_main.mjs"), script)
    await environment.upload_file(spec_path, spec)
    child = asyncio.create_task(environment.exec(
        f"sh -c 'echo $$ > {pid}; exec node {script} {spec} {ready} {requests}' "
        f"> {prefix}.stdout.txt 2> {prefix}.stderr.txt", timeout_sec=600))

    async def close() -> None:
        stopped = await environment.exec(f"test -s {pid} && kill -TERM $(cat {pid})", timeout_sec=10)
        if stopped.return_code != 0 and not child.done():
            child.cancel()
            try:
                await child
            except asyncio.CancelledError:
                pass
            raise RuntimeError("local main probe could not be stopped")
        try:
            result = await asyncio.wait_for(child, timeout=10)
        except asyncio.TimeoutError as exc:
            await environment.exec(f"kill -KILL $(cat {pid})", timeout_sec=10)
            child.cancel()
            try:
                await child
            except asyncio.CancelledError:
                pass
            raise RuntimeError("local main probe did not exit after TERM") from exc
        if result.return_code != 0:
            raise RuntimeError("local main probe exited with error")

    try:
        wait = await environment.exec(f"timeout 10 sh -c {shlex.quote(ready_poll_script(ready, pid))}", timeout_sec=15)
        if wait.return_code != 0 or child.done():
            raise RuntimeError("local main probe did not become ready")
        result = await environment.exec(f"cat {ready}", timeout_sec=10)
        port = json.loads(result.stdout)["port"] if result.return_code == 0 else None
        if type(port) is not int or port < 1 or port > 65535:
            raise RuntimeError("local main probe returned invalid port")
    except BaseException:
        await close()
        raise
    return f"http://127.0.0.1:{port}/anthropic", close

"""Run a verified Infinite-Canvas copy behind a token-authenticated loopback boundary."""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import sys
from pathlib import Path

import uvicorn


HERE = Path(__file__).resolve().parent
SIDECAR_APP = HERE / "sidecar" / "app.py"
IMMUTABLE_ENTRIES = (
    "main.py",
    "static",
    "packages",
    "tools",
    "CLI",
    "requirements.txt",
    "VERSION",
    "LICENSE",
)
PROJECT_WORKFLOWS = HERE / "workflows"


def load_verifier():
    spec = importlib.util.spec_from_file_location("file_manager_canvas_verifier", SIDECAR_APP)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Infinite-Canvas verifier")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def prepare_runtime(source: Path, runtime: Path) -> Path:
    runtime.mkdir(parents=True, exist_ok=True)
    for name in IMMUTABLE_ENTRIES:
        src = source / name
        dst = runtime / name
        if not src.exists():
            continue
        if dst.exists():
            if dst.is_dir():
                shutil.rmtree(dst)
            else:
                dst.unlink()
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    source_workflows = source / "workflows"
    runtime_workflows = runtime / "workflows"
    if source_workflows.is_dir() and not runtime_workflows.exists():
        shutil.copytree(source_workflows, runtime_workflows)
    runtime_workflows.mkdir(parents=True, exist_ok=True)
    if PROJECT_WORKFLOWS.is_dir():
        for fixture in PROJECT_WORKFLOWS.glob("*.json"):
            shutil.copy2(fixture, runtime_workflows / fixture.name)
    for name in ("API", "data", "assets", "output"):
        (runtime / name).mkdir(parents=True, exist_ok=True)
    return runtime


class GatewayAuthMiddleware:
    def __init__(self, app, token: str):
        self.app = app
        self.token = token.encode("utf-8")

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        supplied = headers.get(b"x-file-manager-gateway-token", b"")
        import hmac
        if len(self.token) < 32 or not hmac.compare_digest(supplied, self.token):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 4401})
            else:
                await send({
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")],
                })
                await send({"type": "http.response.body", "body": b'{"code":"GATEWAY_AUTH_REQUIRED"}'})
            return
        await self.app(scope, receive, send)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--port", type=int, default=7863)
    parser.add_argument("--comfyui", required=True)
    args = parser.parse_args()

    token = os.environ.get("INFINITE_CANVAS_GATEWAY_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("INFINITE_CANVAS_GATEWAY_TOKEN must contain at least 32 characters")
    source = Path(args.source).expanduser().resolve(strict=True)
    verifier = load_verifier()
    status = verifier.inspect_upstream(source)
    if not status.get("ok"):
        raise SystemExit(f"Infinite-Canvas source verification failed: {status.get('code')}")
    runtime = prepare_runtime(source, Path(args.runtime).expanduser().resolve())
    os.environ["COMFYUI_INSTANCES"] = args.comfyui.removeprefix("http://").removeprefix("https://").rstrip("/")

    spec = importlib.util.spec_from_file_location("file_manager_infinite_canvas_upstream", runtime / "main.py")
    if spec is None or spec.loader is None:
        raise SystemExit("Unable to load Infinite-Canvas runtime")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    app = GatewayAuthMiddleware(module.app, token)
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        proxy_headers=False,
        ws_ping_interval=None,
        ws_ping_timeout=None,
        server_header=False,
    )


if __name__ == "__main__":
    main()

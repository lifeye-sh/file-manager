"""Narrow loopback adapter boundary for the pinned Infinite-Canvas checkout."""

from __future__ import annotations

import hmac
import hashlib
import asyncio
import json
import os
import re
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


HERE = Path(__file__).resolve().parent
UPSTREAM_MANIFEST = HERE.parent / "upstream.json"
GATEWAY_HEADER = "x-file-manager-gateway-token"
IMPORT_ID_PATTERN = re.compile(r"^imp_[a-f0-9]{32}$")
ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}
DEFAULT_MAX_IMPORT_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_STAGING_BYTES = 2 * 1024 * 1024 * 1024


def _load_manifest() -> dict[str, Any]:
    with UPSTREAM_MANIFEST.open("r", encoding="utf-8") as handle:
        return json.load(handle)


MANIFEST = _load_manifest()
PINNED_COMMIT = str(MANIFEST["pinnedCommit"])
CONTRACT_VERSION = int(MANIFEST["adapterContractVersion"])
ARCHIVE_ROOT = str(MANIFEST.get("archiveRoot", ""))
SOURCE_TREE_SHA256 = str(MANIFEST.get("sourceTreeSha256", "")).lower()


@dataclass(frozen=True)
class Settings:
    upstream_dir: Path
    gateway_token: str
    staging_dir: Path | None = None
    max_import_bytes: int = DEFAULT_MAX_IMPORT_BYTES
    max_staging_bytes: int = DEFAULT_MAX_STAGING_BYTES

    @classmethod
    def from_environment(cls) -> "Settings":
        upstream = os.environ.get("INFINITE_CANVAS_UPSTREAM_DIR", "").strip()
        token = os.environ.get("INFINITE_CANVAS_GATEWAY_TOKEN", "")
        staging = os.environ.get("INFINITE_CANVAS_STAGING_DIR", "").strip()
        max_import = _bounded_env_int(
            "INFINITE_CANVAS_MAX_IMPORT_BYTES",
            DEFAULT_MAX_IMPORT_BYTES,
            1024,
            DEFAULT_MAX_IMPORT_BYTES,
        )
        max_staging = _bounded_env_int(
            "INFINITE_CANVAS_MAX_STAGING_BYTES",
            DEFAULT_MAX_STAGING_BYTES,
            DEFAULT_MAX_IMPORT_BYTES,
            20 * 1024 * 1024 * 1024,
        )
        return cls(
            upstream_dir=Path(upstream) if upstream else Path(),
            gateway_token=token,
            staging_dir=Path(staging) if staging else None,
            max_import_bytes=max_import,
            max_staging_bytes=max_staging,
        )


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def hash_source_tree(root: Path) -> str | None:
    digest = hashlib.sha256()
    try:
        files = sorted(
            (item for item in root.rglob("*") if item.is_file()),
            key=lambda item: item.relative_to(root).as_posix(),
        )
        for item in files:
            if item.is_symlink():
                return None
            real_item = item.resolve(strict=True)
            try:
                real_item.relative_to(root)
            except ValueError:
                return None
            relative = item.relative_to(root).as_posix().encode("utf-8")
            digest.update(relative)
            digest.update(b"\0")
            with item.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            digest.update(b"\0")
        return digest.hexdigest()
    except (OSError, RuntimeError):
        return None


def inspect_upstream(upstream_dir: Path) -> dict[str, Any]:
    if not str(upstream_dir):
        return {"ok": False, "code": "UPSTREAM_DIR_MISSING"}
    try:
        resolved = upstream_dir.expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return {"ok": False, "code": "UPSTREAM_DIR_INVALID"}
    if not resolved.is_dir() or not (resolved / "main.py").is_file():
        return {"ok": False, "code": "UPSTREAM_ENTRYPOINT_MISSING"}
    if (resolved / ".git").exists():
        try:
            result = subprocess.run(
                ["git", "-C", str(resolved), "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
                shell=False,
            )
        except (OSError, subprocess.SubprocessError):
            return {"ok": False, "code": "UPSTREAM_REVISION_UNVERIFIABLE"}
        actual_commit = result.stdout.strip().lower()
        if actual_commit != PINNED_COMMIT.lower():
            return {"ok": False, "code": "UPSTREAM_REVISION_MISMATCH"}
    else:
        if not ARCHIVE_ROOT or resolved.name != ARCHIVE_ROOT or not SOURCE_TREE_SHA256:
            return {"ok": False, "code": "UPSTREAM_REVISION_UNVERIFIABLE"}
        actual_tree_hash = hash_source_tree(resolved)
        if actual_tree_hash is None:
            return {"ok": False, "code": "UPSTREAM_SOURCE_UNVERIFIABLE"}
        if not hmac.compare_digest(actual_tree_hash, SOURCE_TREE_SHA256):
            return {"ok": False, "code": "UPSTREAM_SOURCE_MISMATCH"}
    version = None
    version_file = resolved / "VERSION"
    try:
        if version_file.is_file():
            version = version_file.read_text(encoding="utf-8").strip()[:80] or None
    except OSError:
        version = None
    return {
        "ok": True,
        "code": "READY",
        "contractVersion": CONTRACT_VERSION,
        "upstreamCommit": PINNED_COMMIT,
        "version": version,
    }


def prepare_staging(staging_dir: Path | None) -> tuple[Path | None, str | None]:
    if staging_dir is None:
        return None, "STAGING_DIR_MISSING"
    try:
        resolved = staging_dir.expanduser().resolve()
        resolved.mkdir(parents=True, exist_ok=True)
        if not resolved.is_dir():
            return None, "STAGING_DIR_INVALID"
        return resolved, None
    except (OSError, RuntimeError):
        return None, "STAGING_DIR_INVALID"


def staging_size(staging_dir: Path) -> int:
    total = 0
    try:
        for item in staging_dir.glob("imp_*.bin"):
            if item.is_file():
                total += item.stat().st_size
    except OSError:
        return -1
    return total


def image_signature_matches(media_type: str, header: bytes) -> bool:
    if media_type == "image/jpeg":
        return header.startswith(b"\xff\xd8\xff")
    if media_type == "image/png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if media_type == "image/gif":
        return header.startswith((b"GIF87a", b"GIF89a"))
    if media_type == "image/webp":
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
    return False


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime = settings or Settings.from_environment()
    import_lock = asyncio.Lock()
    app = FastAPI(
        title="File Manager Infinite-Canvas Sidecar",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.middleware("http")
    async def require_gateway_token(request: Request, call_next):
        expected = runtime.gateway_token
        supplied = request.headers.get(GATEWAY_HEADER, "")
        if len(expected) < 32 or not hmac.compare_digest(supplied, expected):
            return JSONResponse(
                status_code=401,
                content={"ok": False, "code": "GATEWAY_AUTH_REQUIRED"},
                headers={"Cache-Control": "no-store"},
            )
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health")
    async def health():
        status = inspect_upstream(runtime.upstream_dir)
        if not status["ok"]:
            return JSONResponse(status_code=503, content=status)
        _staging, staging_error = prepare_staging(runtime.staging_dir)
        if staging_error:
            return JSONResponse(status_code=503, content={"ok": False, "code": staging_error})
        return status

    @app.put("/v1/imports/{import_id}")
    async def import_authorized_image(import_id: str, request: Request):
        if not IMPORT_ID_PATTERN.fullmatch(import_id):
            return JSONResponse(status_code=400, content={"ok": False, "code": "INVALID_IMPORT_ID"})
        media_type = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if media_type not in ALLOWED_IMAGE_TYPES:
            return JSONResponse(status_code=415, content={"ok": False, "code": "UNSUPPORTED_IMPORT_TYPE"})
        declared = request.headers.get("content-length")
        if declared:
            try:
                if int(declared) < 1 or int(declared) > runtime.max_import_bytes:
                    return JSONResponse(status_code=413, content={"ok": False, "code": "IMPORT_TOO_LARGE"})
            except ValueError:
                return JSONResponse(status_code=400, content={"ok": False, "code": "INVALID_CONTENT_LENGTH"})
        upstream_status = inspect_upstream(runtime.upstream_dir)
        if not upstream_status["ok"]:
            return JSONResponse(status_code=503, content=upstream_status)
        staging, staging_error = prepare_staging(runtime.staging_dir)
        if staging_error or staging is None:
            return JSONResponse(status_code=503, content={"ok": False, "code": staging_error})

        final_file = staging / f"{import_id}.bin"
        metadata_file = staging / f"{import_id}.json"
        temp_file = staging / f".tmp-{uuid.uuid4().hex}"
        async with import_lock:
            current_size = staging_size(staging)
            if current_size < 0:
                return JSONResponse(status_code=503, content={"ok": False, "code": "STAGING_UNAVAILABLE"})
            if final_file.exists() or metadata_file.exists():
                return JSONResponse(status_code=409, content={"ok": False, "code": "IMPORT_ALREADY_EXISTS"})
            if current_size + (int(declared) if declared else runtime.max_import_bytes) > runtime.max_staging_bytes:
                return JSONResponse(status_code=507, content={"ok": False, "code": "STAGING_CAPACITY_EXCEEDED"})

            size = 0
            digest = hashlib.sha256()
            signature = bytearray()
            metadata_temp: Path | None = None
            try:
                with temp_file.open("xb") as handle:
                    async for chunk in request.stream():
                        if not chunk:
                            continue
                        size += len(chunk)
                        if size > runtime.max_import_bytes:
                            raise ValueError("IMPORT_TOO_LARGE")
                        if current_size + size > runtime.max_staging_bytes:
                            raise ValueError("STAGING_CAPACITY_EXCEEDED")
                        if len(signature) < 16:
                            signature.extend(chunk[: 16 - len(signature)])
                        digest.update(chunk)
                        handle.write(chunk)
                if size < 1:
                    raise ValueError("IMPORT_EMPTY")
                if not image_signature_matches(media_type, bytes(signature)):
                    raise ValueError("IMPORT_SIGNATURE_MISMATCH")
                os.replace(temp_file, final_file)
                metadata = {
                    "schemaVersion": 1,
                    "importId": import_id,
                    "mediaType": media_type,
                    "size": size,
                    "sha256": digest.hexdigest(),
                    "createdAt": int(time.time()),
                }
                metadata_temp = staging / f".tmp-{uuid.uuid4().hex}"
                metadata_temp.write_text(json.dumps(metadata, separators=(",", ":")), encoding="utf-8")
                os.replace(metadata_temp, metadata_file)
            except ValueError as exc:
                code = str(exc)
                status_code = 413 if code == "IMPORT_TOO_LARGE" else 507 if code == "STAGING_CAPACITY_EXCEEDED" else 400
                return JSONResponse(status_code=status_code, content={"ok": False, "code": code})
            except OSError:
                final_file.unlink(missing_ok=True)
                metadata_file.unlink(missing_ok=True)
                return JSONResponse(status_code=503, content={"ok": False, "code": "STAGING_WRITE_FAILED"})
            except Exception:
                final_file.unlink(missing_ok=True)
                metadata_file.unlink(missing_ok=True)
                raise
            finally:
                temp_file.unlink(missing_ok=True)
                if metadata_temp is not None:
                    metadata_temp.unlink(missing_ok=True)
        return {"ok": True, **metadata}

    @app.delete("/v1/imports/{import_id}")
    async def delete_import(import_id: str):
        if not IMPORT_ID_PATTERN.fullmatch(import_id):
            return JSONResponse(status_code=400, content={"ok": False, "code": "INVALID_IMPORT_ID"})
        staging, staging_error = prepare_staging(runtime.staging_dir)
        if staging_error or staging is None:
            return JSONResponse(status_code=503, content={"ok": False, "code": staging_error})
        async with import_lock:
            final_file = staging / f"{import_id}.bin"
            metadata_file = staging / f"{import_id}.json"
            if not final_file.exists() and not metadata_file.exists():
                return JSONResponse(status_code=404, content={"ok": False, "code": "IMPORT_NOT_FOUND"})
            try:
                final_file.unlink(missing_ok=True)
                metadata_file.unlink(missing_ok=True)
            except OSError:
                return JSONResponse(status_code=503, content={"ok": False, "code": "STAGING_DELETE_FAILED"})
        return {"ok": True, "importId": import_id, "deleted": True}

    return app


app = create_app()

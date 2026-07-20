from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
APP_FILE = ROOT / "integrations" / "infinite-canvas" / "sidecar" / "app.py"
SPEC = importlib.util.spec_from_file_location("file_manager_infinite_canvas_sidecar", APP_FILE)
assert SPEC and SPEC.loader
sidecar = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sidecar
SPEC.loader.exec_module(sidecar)

TOKEN = "test-sidecar-gateway-token-with-32-characters"


class InfiniteCanvasSidecarTests(unittest.TestCase):
    def test_direct_request_without_gateway_token_is_rejected(self):
        app = sidecar.create_app(sidecar.Settings(Path(), TOKEN))
        with TestClient(app) as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"ok": False, "code": "GATEWAY_AUTH_REQUIRED"})
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_health_reports_only_verified_pinned_checkout(self):
        with tempfile.TemporaryDirectory() as temp_dir, tempfile.TemporaryDirectory() as staging_dir:
            upstream = Path(temp_dir)
            (upstream / "main.py").write_text("# fixture\n", encoding="utf-8")
            (upstream / "VERSION").write_text("fixture-version\n", encoding="utf-8")
            (upstream / ".git").mkdir()
            git_result = SimpleNamespace(stdout=sidecar.PINNED_COMMIT + "\n")
            app = sidecar.create_app(sidecar.Settings(upstream, TOKEN, Path(staging_dir)))
            with mock.patch.object(sidecar.subprocess, "run", return_value=git_result) as run:
                with TestClient(app) as client:
                    response = client.get(
                        "/health",
                        headers={sidecar.GATEWAY_HEADER: TOKEN},
                    )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "ok": True,
            "code": "READY",
            "contractVersion": sidecar.CONTRACT_VERSION,
            "upstreamCommit": sidecar.PINNED_COMMIT,
            "version": "fixture-version",
        })
        self.assertNotIn(str(upstream), response.text)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        run.assert_called_once()
        self.assertFalse(run.call_args.kwargs["shell"])
        self.assertEqual(run.call_args.args[0][0], "git")

    def test_revision_mismatch_and_unverifiable_checkout_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            upstream = Path(temp_dir)
            (upstream / "main.py").write_text("# fixture\n", encoding="utf-8")
            (upstream / ".git").mkdir()
            with mock.patch.object(
                sidecar.subprocess,
                "run",
                return_value=SimpleNamespace(stdout="0" * 40 + "\n"),
            ):
                mismatch = sidecar.inspect_upstream(upstream)
            with mock.patch.object(
                sidecar.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired("git", 5),
            ):
                unverifiable = sidecar.inspect_upstream(upstream)

        self.assertEqual(mismatch, {"ok": False, "code": "UPSTREAM_REVISION_MISMATCH"})
        self.assertEqual(unverifiable, {"ok": False, "code": "UPSTREAM_REVISION_UNVERIFIABLE"})

    def test_official_archive_source_tree_is_verified_without_git_metadata(self):
        with tempfile.TemporaryDirectory() as temp_dir, tempfile.TemporaryDirectory() as staging_dir:
            upstream = Path(temp_dir) / sidecar.ARCHIVE_ROOT
            upstream.mkdir()
            (upstream / "main.py").write_text("# fixture\n", encoding="utf-8")
            app = sidecar.create_app(sidecar.Settings(upstream, TOKEN, Path(staging_dir)))
            with mock.patch.object(
                sidecar,
                "hash_source_tree",
                return_value=sidecar.SOURCE_TREE_SHA256,
            ):
                with TestClient(app) as client:
                    response = client.get(
                        "/health",
                        headers={sidecar.GATEWAY_HEADER: TOKEN},
                    )
            with mock.patch.object(sidecar, "hash_source_tree", return_value="0" * 64):
                mismatch = sidecar.inspect_upstream(upstream)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["upstreamCommit"], sidecar.PINNED_COMMIT)
        self.assertEqual(mismatch, {"ok": False, "code": "UPSTREAM_SOURCE_MISMATCH"})

    def test_missing_checkout_returns_bounded_503_response(self):
        app = sidecar.create_app(sidecar.Settings(Path("definitely-missing-upstream"), TOKEN, Path.cwd()))
        with TestClient(app) as client:
            response = client.get(
                "/health",
                headers={sidecar.GATEWAY_HEADER: TOKEN},
            )
        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()["ok"])
        self.assertNotIn("definitely-missing-upstream", response.text)

    def test_import_is_bounded_signature_checked_and_atomically_deletable(self):
        import_id = "imp_" + "a" * 32
        png = b"\x89PNG\r\n\x1a\n" + b"fixture-image-data"
        with tempfile.TemporaryDirectory() as staging_dir:
            settings = sidecar.Settings(Path.cwd(), TOKEN, Path(staging_dir))
            app = sidecar.create_app(settings)
            with mock.patch.object(
                sidecar,
                "inspect_upstream",
                return_value={
                    "ok": True,
                    "code": "READY",
                    "contractVersion": sidecar.CONTRACT_VERSION,
                    "upstreamCommit": sidecar.PINNED_COMMIT,
                    "version": None,
                },
            ):
                with TestClient(app) as client:
                    response = client.put(
                        f"/v1/imports/{import_id}",
                        headers={
                            sidecar.GATEWAY_HEADER: TOKEN,
                            "Content-Type": "image/png",
                        },
                        content=png,
                    )
                    duplicate = client.put(
                        f"/v1/imports/{import_id}",
                        headers={
                            sidecar.GATEWAY_HEADER: TOKEN,
                            "Content-Type": "image/png",
                        },
                        content=png,
                    )
                    deleted = client.delete(
                        f"/v1/imports/{import_id}",
                        headers={sidecar.GATEWAY_HEADER: TOKEN},
                    )
            remaining = list(Path(staging_dir).iterdir())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["importId"], import_id)
        self.assertEqual(response.json()["size"], len(png))
        self.assertRegex(response.json()["sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(remaining, [])

    def test_import_rejects_invalid_id_type_signature_and_size(self):
        valid_id = "imp_" + "b" * 32
        with tempfile.TemporaryDirectory() as staging_dir:
            settings = sidecar.Settings(
                Path.cwd(),
                TOKEN,
                Path(staging_dir),
                max_import_bytes=16,
                max_staging_bytes=12,
            )
            app = sidecar.create_app(settings)
            ready = {
                "ok": True,
                "code": "READY",
                "contractVersion": sidecar.CONTRACT_VERSION,
                "upstreamCommit": sidecar.PINNED_COMMIT,
                "version": None,
            }
            with mock.patch.object(sidecar, "inspect_upstream", return_value=ready):
                with TestClient(app) as client:
                    invalid_id = client.put(
                        "/v1/imports/not-an-import",
                        headers={sidecar.GATEWAY_HEADER: TOKEN, "Content-Type": "image/png"},
                        content=b"\x89PNG\r\n\x1a\n",
                    )
                    invalid_type = client.put(
                        f"/v1/imports/{valid_id}",
                        headers={sidecar.GATEWAY_HEADER: TOKEN, "Content-Type": "text/plain"},
                        content=b"hello",
                    )
                    invalid_signature = client.put(
                        f"/v1/imports/{valid_id}",
                        headers={sidecar.GATEWAY_HEADER: TOKEN, "Content-Type": "image/png"},
                        content=b"not-a-png",
                    )
                    oversized = client.put(
                        f"/v1/imports/{valid_id}",
                        headers={sidecar.GATEWAY_HEADER: TOKEN, "Content-Type": "image/png"},
                        content=b"\x89PNG\r\n\x1a\n" + b"x" * 20,
                    )
                    capacity_limited = client.put(
                        f"/v1/imports/{valid_id}",
                        headers={
                            sidecar.GATEWAY_HEADER: TOKEN,
                            "Content-Type": "image/png",
                            "Content-Length": "1",
                        },
                        content=b"\x89PNG\r\n\x1a\n" + b"x" * 6,
                    )
            remaining = list(Path(staging_dir).iterdir())

        self.assertEqual(invalid_id.status_code, 400)
        self.assertEqual(invalid_type.status_code, 415)
        self.assertEqual(invalid_signature.status_code, 400)
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(capacity_limited.status_code, 507)
        self.assertEqual(remaining, [])


if __name__ == "__main__":
    unittest.main()

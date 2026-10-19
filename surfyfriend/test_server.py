from __future__ import annotations

import json
import base64
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from unittest import mock

import server


class AccountServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.originals = {
            "account_db": server.ACCOUNT_DB_PATH,
            "upload_root": server.UPLOAD_ROOT,
            "port": server.PORT,
            "host": server.HOST,
            "public_origin": server.PUBLIC_ORIGIN,
            "public_origin_parts": server.PUBLIC_ORIGIN_PARTS,
        }
        self.directory = tempfile.TemporaryDirectory()
        server.ACCOUNT_DB_PATH = Path(self.directory.name) / "accounts.sqlite3"
        server.UPLOAD_ROOT = Path(self.directory.name) / "uploads"
        server.PUBLIC_ORIGIN = ""
        server.PUBLIC_ORIGIN_PARTS = None
        server.initialize_account_database()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.DltimeHandler)
        server.PORT = self.httpd.server_address[1]
        self.httpd.network_enabled = False
        self.httpd.network_url = None
        self.httpd.accounts_enabled = True
        self.httpd.auth_attempts = {}
        self.httpd.auth_rate_lock = threading.Lock()
        self.httpd.website_check_attempts = {}
        self.httpd.website_check_lock = threading.Lock()
        self.httpd.webpage_download_attempts = {}
        self.httpd.webpage_download_lock = threading.Lock()
        self.httpd.media_shares = {}
        self.httpd.media_share_lock = threading.Lock()
        self.origin = f"http://127.0.0.1:{server.PORT}"
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor()
        )
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        self.directory.cleanup()
        server.ACCOUNT_DB_PATH = self.originals["account_db"]
        server.UPLOAD_ROOT = self.originals["upload_root"]
        server.PORT = self.originals["port"]
        server.HOST = self.originals["host"]
        server.PUBLIC_ORIGIN = self.originals["public_origin"]
        server.PUBLIC_ORIGIN_PARTS = self.originals["public_origin_parts"]

    def request(self, path: str, method: str = "GET", data: object = None,
                origin: Optional[str] = None) -> tuple[int, dict[str, object], str]:
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if origin is not None:
            headers["Origin"] = origin
        body = json.dumps(data).encode("utf-8") if data is not None else None
        request = urllib.request.Request(
            f"{self.origin}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with self.opener.open(request, timeout=5) as response:
                return (
                    response.status,
                    json.loads(response.read()),
                    response.headers.get("Set-Cookie", ""),
                )
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read()), error.headers.get("Set-Cookie", "")

    def request_bytes(self, path: str, data: object, origin: str):
        body = json.dumps(data).encode("utf-8")
        request = urllib.request.Request(
            f"{self.origin}{path}",
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Origin": origin,
            },
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=5) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def test_account_registration_login_data_sync_and_logout(self) -> None:
        initial_data = {
            "progress": {
                "actionXp": 25,
                "visitedWebsiteUrls": ["https://example.com/"],
            },
            "queue": [{
                "id": "queue-1",
                "url": "https://example.com/file.zip",
                "name": "file.zip",
                "addedAt": "2026-10-19T00:00:00Z",
            }],
            "history": [{
                "url": "https://example.com/file.zip",
                "name": "file.zip",
                "date": "2026-10-19T00:00:00Z",
                "tags": ["reference", "work"],
                "note": "Keep for later.",
            }],
        }
        status, registered, cookie = self.request(
            "/api/account/register",
            "POST",
            {
                "username": "Explorer_1",
                "password": "a sufficiently long password",
                "data": initial_data,
            },
            self.origin,
        )
        self.assertEqual(status, 201)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertNotIn("a sufficiently long password", cookie)
        self.assertTrue(registered["authenticated"])

        status, account_status, _ = self.request("/api/account/status")
        self.assertEqual(status, 200)
        self.assertTrue(account_status["authenticated"])
        self.assertEqual(account_status["username"], "Explorer_1")

        status, saved, _ = self.request("/api/account/data")
        self.assertEqual(status, 200)
        self.assertEqual(saved["data"]["progress"]["actionXp"], 25)
        self.assertEqual(saved["data"]["progress"]["websiteVisits"], 1)
        self.assertEqual(len(saved["data"]["queue"]), 1)
        self.assertEqual(len(saved["data"]["history"]), 1)
        self.assertEqual(saved["data"]["history"][0]["tags"], ["reference", "work"])
        self.assertEqual(saved["data"]["history"][0]["note"], "Keep for later.")

        updated_data = {
            "progress": {"actionXp": 35, "visitedWebsiteUrls": ["https://example.com/", "https://example.org/"]},
            "queue": [],
            "history": [],
        }
        status, synced, _ = self.request(
            "/api/account/data", "PUT", updated_data, self.origin
        )
        self.assertEqual(status, 200)
        self.assertTrue(synced["saved"])
        status, saved, _ = self.request("/api/account/data")
        self.assertEqual(status, 200)
        self.assertEqual(saved["data"]["progress"]["actionXp"], 35)
        self.assertEqual(saved["data"]["progress"]["websiteVisits"], 2)
        self.assertEqual(saved["data"]["queue"], [])

        status, _, deleted_cookie = self.request(
            "/api/account/logout", "POST", {}, self.origin
        )
        self.assertEqual(status, 200)
        self.assertIn("Max-Age=0", deleted_cookie)
        status, _, _ = self.request("/api/account/data")
        self.assertEqual(status, 401)

        status, _, _ = self.request(
            "/api/account/login",
            "POST",
            {"username": "Explorer_1", "password": "incorrect password"},
            self.origin,
        )
        self.assertEqual(status, 401)
        status, logged_in, _ = self.request(
            "/api/account/login",
            "POST",
            {"username": "explorer_1", "password": "a sufficiently long password"},
            self.origin,
        )
        self.assertEqual(status, 200)
        self.assertTrue(logged_in["authenticated"])

    def test_invalid_origin_and_unencrypted_lan_accounts_are_rejected(self) -> None:
        status, _, _ = self.request(
            "/api/account/register",
            "POST",
            {
                "username": "Explorer_2",
                "password": "a sufficiently long password",
            },
            "https://attacker.example",
        )
        self.assertEqual(status, 403)

        self.httpd.accounts_enabled = False
        status, state, _ = self.request("/api/account/status")
        self.assertEqual(status, 200)
        self.assertFalse(state["enabled"])
        status, _, _ = self.request(
            "/api/account/register",
            "POST",
            {
                "username": "Explorer_2",
                "password": "a sufficiently long password",
            },
            self.origin,
        )
        self.assertEqual(status, 403)

    def test_account_data_rejects_non_web_urls_and_duplicate_queue_ids(self) -> None:
        unsafe = server.validate_account_data({
            "progress": {"visitedWebsiteUrls": ["javascript:alert(1)"]},
            "queue": [],
            "history": [],
        })
        self.assertIsNone(unsafe)
        duplicate_ids = server.validate_account_data({
            "progress": {},
            "queue": [
                {"id": "same", "url": "https://example.com/a", "name": "a", "addedAt": "now"},
                {"id": "same", "url": "https://example.com/b", "name": "b", "addedAt": "now"},
            ],
            "history": [],
        })
        self.assertIsNone(duplicate_ids)

    def test_website_checker_validates_homepage_targets_and_blocks_private_hosts(self) -> None:
        self.assertEqual(
            server.normalize_website_target("example.com"),
            ("https://example.com/", "example.com", 443),
        )
        for unsafe in (
            "https://example.com/path",
            "https://example.com/?token=private",
            "https://user:password@example.com/",
            "https://example.com:8443/",
        ):
            with self.subTest(target=unsafe), self.assertRaises(server.UnsafeWebsiteTarget):
                server.normalize_website_target(unsafe)

        with self.assertRaises(server.UnsafeWebsiteTarget):
            server.resolve_public_addresses("127.0.0.1", 443)

    def test_tls_check_is_inconclusive_if_any_public_address_cannot_be_verified(self) -> None:
        with (
            mock.patch.object(server.ssl, "create_default_context") as create_context,
            mock.patch.object(
                server.socket,
                "create_connection",
                side_effect=[OSError("unreachable"), mock.MagicMock()],
            ),
        ):
            create_context.return_value.wrap_socket.return_value = mock.MagicMock()
            result = server.check_tls_certificate(
                "example.com",
                ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
            )
        self.assertEqual(result["status"], "error")
        self.assertIn("inconclusive", result["message"])

    def test_website_checker_reports_tls_and_unconfigured_reputation(self) -> None:
        with (
            mock.patch.dict("os.environ", {server.VIRUSTOTAL_API_KEY_ENV: ""}),
            mock.patch.object(
                server,
                "resolve_public_addresses",
                return_value=["93.184.216.34"],
            ),
            mock.patch.object(
                server,
                "check_tls_certificate",
                return_value={"status": "valid", "message": "Certificate verified."},
            ),
        ):
            status, result, _ = self.request(
                "/api/security/check",
                "POST",
                {"url": "example.com"},
                self.origin,
            )
        self.assertEqual(status, 200)
        self.assertEqual(result["target"], "https://example.com/")
        self.assertEqual(result["tls"]["status"], "valid")
        self.assertEqual(result["malware"]["status"], "not_configured")
        self.assertEqual(result["malware"]["provider"], "VirusTotal")

    def test_website_checker_queues_reputation_scans_and_reports_engine_counts(self) -> None:
        missing_report = urllib.error.HTTPError(
            "https://www.virustotal.com/api/v3/urls/example", 404, "Not found", {}, None
        )
        with (
            mock.patch.dict(
                "os.environ",
                {server.VIRUSTOTAL_API_KEY_ENV: "test-key"},
            ),
            mock.patch.object(
                server,
                "resolve_public_addresses",
                return_value=["93.184.216.34"],
            ),
            mock.patch.object(
                server,
                "check_tls_certificate",
                return_value={"status": "valid", "message": "Certificate verified."},
            ),
            mock.patch.object(
                server,
                "virustotal_request",
                side_effect=[missing_report, {"data": {"id": "analysis-id"}}],
            ),
        ):
            status, queued, _ = self.request(
                "/api/security/check",
                "POST",
                {"url": "example.com"},
                self.origin,
            )
        self.assertEqual(status, 200)
        self.assertEqual(queued["malware"]["status"], "pending")
        self.assertEqual(queued["malware"]["provider"], "VirusTotal")

        clean = server.parse_virustotal_report({
            "data": {"attributes": {"last_analysis_stats": {"harmless": 8, "undetected": 4}}},
        })
        flagged = server.parse_virustotal_report({
            "data": {"attributes": {"last_analysis_stats": {"malicious": 2, "harmless": 9}}},
        })
        self.assertEqual(clean["status"], "clean")
        self.assertEqual(flagged["status"], "flagged")
        self.assertEqual(server.parse_virustotal_report({
            "data": {"attributes": {"last_analysis_stats": {"timeout": 8}}},
        })["status"], "unavailable")

    def test_website_checker_rejects_private_dns_results(self) -> None:
        with (
            mock.patch.dict(
                "os.environ",
                {server.VIRUSTOTAL_API_KEY_ENV: "test-key"},
            ),
            mock.patch.object(
                server,
                "resolve_public_addresses",
                side_effect=server.UnsafeWebsiteTarget("Private address blocked."),
            ),
            mock.patch.object(server, "virustotal_request") as reputation_request,
        ):
            status, result, _ = self.request(
                "/api/security/check",
                "POST",
                {"url": "example.com"},
                self.origin,
            )
        self.assertEqual(status, 400)
        self.assertEqual(result["error"], "Private address blocked.")
        reputation_request.assert_not_called()

    def test_website_checker_requires_homepage_addresses(self) -> None:
        status, result, _ = self.request(
            "/api/security/check",
            "POST",
            {"url": "https://example.com/private?token=secret"},
            self.origin,
        )
        self.assertEqual(status, 400)
        self.assertIn("homepage only", result["error"])

    def test_html_download_returns_an_attachment_with_safe_filename(self) -> None:
        html = b"<!doctype html><title>Example</title>"
        with mock.patch.object(
            server,
            "fetch_remote_webpage",
            return_value=(html, "text/html; charset=utf-8"),
        ):
            status, headers, body = self.request_bytes(
                "/api/download/webpage",
                {"url": "https://example.com/", "filename": "../welcome"},
                self.origin,
            )
        self.assertEqual(status, 200)
        self.assertEqual(body, html)
        self.assertEqual(headers.get("Content-Disposition"), "attachment; filename*=UTF-8''welcome.html")
        self.assertEqual(headers.get("X-SurfyFriend-Filename"), "welcome.html")

    def test_html_download_leaves_non_html_links_to_the_browser(self) -> None:
        with mock.patch.object(server, "fetch_remote_webpage", return_value=None):
            status, result, _ = self.request(
                "/api/download/webpage",
                "POST",
                {"url": "https://example.com/archive.zip", "filename": "archive.zip"},
                self.origin,
            )
        self.assertEqual(status, 200)
        self.assertFalse(result["downloaded"])

    def test_lan_media_share_streams_ranges_and_can_be_revoked(self) -> None:
        server.UPLOAD_ROOT.mkdir()
        upload_id = "1234567890abcdef1234567890abcdef"
        (server.UPLOAD_ROOT / f"{upload_id}--sample.mp4").write_bytes(b"0123456789")
        self.httpd.network_enabled = True
        self.httpd.network_url = f"{self.origin}/"

        status, created, _ = self.request(
            "/api/media/shares",
            "POST",
            {"uploadId": upload_id},
            self.origin,
        )
        self.assertEqual(status, 201)
        self.assertEqual(created["name"], "sample.mp4")
        self.assertEqual(created["url"], f"{self.origin}/media/{created['token']}")

        with self.opener.open(created["url"], timeout=5) as response:
            player_page = response.read().decode("utf-8")
            self.assertIn("<video id=\"player\"", player_page)
            self.assertIn("surfyfriend.media.position.", player_page)
            self.assertIn("no-referrer", response.headers.get("Referrer-Policy", ""))

        with mock.patch.object(server.shutil, "which", return_value=None):
            status, result, _ = self.request(
                f"/media/{created['token']}/stream?transcode=1"
            )
        self.assertEqual(status, 503)
        self.assertIn("FFmpeg is not installed", result["error"])

        request = urllib.request.Request(
            f"{self.origin}/media/{created['token']}/stream",
            headers={"Range": "bytes=2-5"},
        )
        with self.opener.open(request, timeout=5) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers.get("Content-Range"), "bytes 2-5/10")
            self.assertEqual(response.headers.get("Accept-Ranges"), "bytes")
            self.assertEqual(response.headers.get("Content-Disposition", "").split(";")[0], "inline")
            self.assertEqual(response.read(), b"2345")

        status, shares, _ = self.request("/api/media/shares")
        self.assertEqual(status, 200)
        self.assertEqual(len(shares), 1)
        status, revoked, _ = self.request(
            f"/api/media/shares/{created['token']}",
            "DELETE",
            origin=self.origin,
        )
        self.assertEqual(status, 200)
        self.assertTrue(revoked["revoked"])
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.opener.open(created["url"], timeout=5)
        self.assertEqual(error.exception.code, 404)

    def test_media_library_metadata_and_local_artwork(self) -> None:
        server.UPLOAD_ROOT.mkdir()
        upload_id = "1234567890abcdef1234567890abcdef"
        (server.UPLOAD_ROOT / f"{upload_id}--A.Sample.Movie.2024.mp4").write_bytes(b"media")
        status, library, _ = self.request("/api/media/library")
        self.assertEqual(status, 200)
        item = library["items"][0]
        self.assertEqual(item["metadata"]["title"], "A Sample Movie 2024")
        self.assertIn("ffmpegAvailable", library)

        status, result, _ = self.request(
            f"/api/media/library/{upload_id}",
            "PUT",
            {
                "title": "A Local Title",
                "summary": "Saved only on this computer.",
                "year": 2024,
                "tags": ["favorite", "family"],
            },
            self.origin,
        )
        self.assertEqual(status, 200)
        self.assertTrue(result["saved"])

        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 12
        status, result, _ = self.request(
            f"/api/media/library/{upload_id}",
            "PUT",
            {
                "title": "A Local Title",
                "summary": "Saved only on this computer.",
                "year": 2024,
                "tags": ["favorite", "family"],
                "artwork": f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}",
            },
            self.origin,
        )
        self.assertEqual(status, 200)
        artwork_request = urllib.request.Request(
            f"{self.origin}/api/media/library/{upload_id}/artwork"
        )
        with self.opener.open(artwork_request, timeout=5) as response:
            self.assertEqual(response.headers.get("Content-Type"), "image/png")
            self.assertEqual(response.read(), png)

        status, library, _ = self.request("/api/media/library")
        self.assertEqual(library["items"][0]["metadata"]["tags"], ["favorite", "family"])
        self.assertTrue(library["items"][0]["artworkUrl"])

        status, result, _ = self.request(
            f"/api/media/library/{upload_id}",
            "PUT",
            {"title": "x" * 101, "summary": "", "year": None, "tags": []},
            self.origin,
        )
        self.assertEqual(status, 400)

    def test_lan_media_share_rejects_unsupported_files_and_requires_lan_mode(self) -> None:
        server.UPLOAD_ROOT.mkdir()
        html_id = "abcdef1234567890abcdef1234567890"
        (server.UPLOAD_ROOT / f"{html_id}--page.html").write_text("<h1>not media</h1>")
        status, result, _ = self.request(
            "/api/media/shares",
            "POST",
            {"uploadId": html_id},
            self.origin,
        )
        self.assertEqual(status, 403)
        self.assertIn("--lan", result["error"])

        self.httpd.network_url = f"{self.origin}/"
        status, result, _ = self.request(
            "/api/media/shares",
            "POST",
            {"uploadId": html_id},
            self.origin,
        )
        self.assertEqual(status, 415)
        self.assertIn("Only audio, video", result["error"])

    def test_remote_download_validation_rejects_private_and_nonstandard_targets(self) -> None:
        self.assertEqual(
            server.normalize_remote_download_target(
                "https://example.com/page.html?language=en#section"
            ),
            (
                "https://example.com/page.html?language=en",
                "example.com",
                443,
                "/page.html?language=en",
            ),
        )
        for unsafe in (
            "file:///etc/passwd",
            "https://user:password@example.com/",
            "https://example.com:8443/",
        ):
            with self.subTest(target=unsafe), self.assertRaises(server.UnsafeWebsiteTarget):
                server.normalize_remote_download_target(unsafe)
        with self.assertRaises(server.UnsafeWebsiteTarget):
            server.fetch_remote_webpage("http://127.0.0.1/")


if __name__ == "__main__":
    unittest.main()

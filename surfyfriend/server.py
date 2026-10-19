#!/usr/bin/env python3
"""Serve SurfyFriend, its optional accounts, local uploads, and LAN media shares."""

from __future__ import annotations

import json
import base64
import binascii
import hashlib
import html
import hmac
import http.client
import ipaddress
import mimetypes
import os
import re
import secrets
import socket
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import unicodedata
import argparse
import ssl
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from http.cookies import CookieError, SimpleCookie
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator, Optional
from urllib.parse import quote, unquote, urlsplit
from uuid import uuid4


HOST = os.environ.get("DLTIME_HOST", "127.0.0.1")
PORT = int(os.environ.get("DLTIME_PORT", "8765"))
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
MAX_MEDIA_SHARES = 50
MAX_MEDIA_METADATA_BODY_BYTES = 3_000_000
MAX_MEDIA_ARTWORK_BYTES = 2 * 1024 * 1024
FFMPEG_STREAM_LIMIT = threading.BoundedSemaphore(2)
MAX_ACCOUNT_BODY_BYTES = 25_000_000
MAX_SECURITY_CHECK_BODY_BYTES = 4_096
MAX_WEBPAGE_DOWNLOAD_BYTES = 5 * 1024 * 1024
MAX_PASSWORD_BYTES = 256
PASSWORD_ITERATIONS = 600_000
SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60
SITE_ROOT = Path(__file__).resolve().parent
UPLOAD_ROOT = Path.home() / ".dropzone" / "uploads"
ACCOUNT_DB_PATH = Path(
    os.environ.get(
        "DLTIME_ACCOUNT_DB",
        str(Path.home() / ".dropzone" / "accounts" / "accounts.sqlite3"),
    )
).expanduser()
PUBLIC_ORIGIN = os.environ.get("DLTIME_PUBLIC_ORIGIN", "").rstrip("/")
PUBLIC_ORIGIN_PARTS = urlsplit(PUBLIC_ORIGIN) if PUBLIC_ORIGIN else None
UPLOAD_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
UPLOAD_FILENAME_PATTERN = re.compile(r"^([0-9a-f]{32})--(.+)$")
MEDIA_SHARE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{40,64}$")
MEDIA_ARTWORK_DATA_PATTERN = re.compile(
    r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$"
)
LOOPBACK_HOST_HEADERS = {f"{HOST}:{PORT}", f"localhost:{PORT}"}
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,30}$")
VIRUSTOTAL_API_URL = "https://www.virustotal.com/api/v3"
VIRUSTOTAL_API_KEY_ENV = "SURFRYFRIEND_VIRUSTOTAL_API_KEY"
ACCOUNT_PROGRESS_COUNTERS = (
    "linksOpened", "queueItemsAdded", "queueLinksOpened", "batchAdds",
    "mediaPreviews", "imagePreviews", "audioPreviews", "videoPreviews",
    "filesUploaded", "actionXp", "pageScans", "pageLinksQueued",
    "cloudLinksOpened", "siteLinksOpened", "softwareSiteVisits",
    "mediaSiteVisits", "bookSiteVisits", "dataSiteVisits",
    "socialSiteVisits", "entertainmentSiteVisits", "gamesSiteVisits",
    "websiteVisits",
)
MAX_SAFE_INTEGER = 9_007_199_254_740_991
AUTH_COOKIE_NAME = "dltime_session"


@contextmanager
def account_database_connection() -> Iterator[sqlite3.Connection]:
    ACCOUNT_DB_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ACCOUNT_DB_PATH.parent, 0o700)
    connection = sqlite3.connect(ACCOUNT_DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_account_database() -> None:
    with account_database_connection() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                data_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS account_sessions (
                token_hash BLOB PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS account_sessions_expiry
                ON account_sessions(expires_at);
            """
        )
    os.chmod(ACCOUNT_DB_PATH, 0o600)


def empty_account_data() -> dict[str, object]:
    progress: dict[str, object] = {key: 0 for key in ACCOUNT_PROGRESS_COUNTERS}
    progress["visitedWebsiteUrls"] = []
    progress["claimedAchievements"] = []
    return {"progress": progress, "queue": [], "history": []}


def validate_account_url(value: object, maximum_length: int = 2048) -> Optional[str]:
    if not isinstance(value, str) or not value or len(value) > maximum_length:
        return None
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            return None
        parsed.port
    except ValueError:
        return None
    return value


def validate_account_data(value: object) -> Optional[dict[str, object]]:
    if not isinstance(value, dict) or not set(value).issubset({"progress", "queue", "history"}):
        return None
    raw_progress = value.get("progress", {})
    raw_queue = value.get("queue", [])
    raw_history = value.get("history", [])
    if (
        not isinstance(raw_progress, dict)
        or not isinstance(raw_queue, list)
        or len(raw_queue) > 50
        or not isinstance(raw_history, list)
        or len(raw_history) > 50
    ):
        return None

    progress: dict[str, object] = {key: 0 for key in ACCOUNT_PROGRESS_COUNTERS}
    for key in ACCOUNT_PROGRESS_COUNTERS:
        counter = raw_progress.get(key, 0)
        if type(counter) is not int or not 0 <= counter <= MAX_SAFE_INTEGER:
            return None
        progress[key] = counter

    claimed = raw_progress.get("claimedAchievements", [])
    visited = raw_progress.get("visitedWebsiteUrls", [])
    if (
        not isinstance(claimed, list)
        or len(claimed) > 100
        or not all(isinstance(item, str) and len(item) <= 100 for item in claimed)
        or not isinstance(visited, list)
        or len(visited) > 10_000
    ):
        return None
    clean_visited = [validate_account_url(item) for item in visited]
    if any(item is None for item in clean_visited):
        return None
    progress["claimedAchievements"] = list(dict.fromkeys(claimed))
    progress["visitedWebsiteUrls"] = list(dict.fromkeys(clean_visited))
    progress["websiteVisits"] = len(progress["visitedWebsiteUrls"])

    queue: list[dict[str, str]] = []
    queue_ids: set[str] = set()
    for item in raw_queue:
        if not isinstance(item, dict):
            return None
        item_id = item.get("id")
        item_url = validate_account_url(item.get("url"))
        name = item.get("name")
        added_at = item.get("addedAt")
        if (
            not isinstance(item_id, str)
            or not item_id
            or len(item_id) > 100
            or item_id in queue_ids
            or item_url is None
            or not isinstance(name, str)
            or not name
            or len(name) > 180
            or not isinstance(added_at, str)
            or len(added_at) > 64
        ):
            return None
        queue_ids.add(item_id)
        queue.append({"id": item_id, "url": item_url, "name": name, "addedAt": added_at})

    history: list[dict[str, object]] = []
    history_urls: set[str] = set()
    for item in raw_history:
        if not isinstance(item, dict):
            return None
        item_url = validate_account_url(item.get("url"))
        name = item.get("name")
        date = item.get("date")
        tags = item.get("tags", [])
        note = item.get("note", "")
        if (
            item_url is None
            or item_url in history_urls
            or not isinstance(name, str)
            or not name
            or len(name) > 180
            or not isinstance(date, str)
            or len(date) > 64
            or not isinstance(tags, list)
            or len(tags) > 10
            or not all(isinstance(tag, str) and 1 <= len(tag.strip()) <= 30 for tag in tags)
            or len({tag.strip().casefold() for tag in tags}) != len(tags)
            or not isinstance(note, str)
            or len(note) > 500
        ):
            return None
        history_urls.add(item_url)
        history.append({
            "url": item_url,
            "name": name,
            "date": date,
            "tags": [tag.strip() for tag in tags],
            "note": note,
        })
    return {"progress": progress, "queue": queue, "history": history}


def hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )


def password_byte_length(password: str) -> Optional[int]:
    try:
        return len(password.encode("utf-8"))
    except UnicodeEncodeError:
        return None


def safe_filename(value: str) -> str:
    filename = unicodedata.normalize("NFC", value.replace("\\", "/").split("/")[-1])
    filename = "".join(
        "-" if character in '<>:"/\\|?*' or ord(character) < 32 else character
        for character in filename
    ).strip().strip(".")
    if not filename:
        return "download"
    return filename[:180]


class UnsafeWebsiteTarget(ValueError):
    pass


class RemoteDownloadError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def normalize_website_target(value: object) -> tuple[str, str, int]:
    if not isinstance(value, str) or not value.strip() or len(value) > 2_048:
        raise UnsafeWebsiteTarget("Enter a website address up to 2,048 characters.")
    candidate = value.strip()
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    try:
        parsed = urlsplit(candidate)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise UnsafeWebsiteTarget("Enter a valid HTTP or HTTPS website address.") from error
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise UnsafeWebsiteTarget(
            "Enter a website homepage only (no sign-in details, paths, query strings, or fragments)."
        )
    scheme = parsed.scheme.lower()
    expected_port = 443 if scheme == "https" else 80
    if port is not None and port != expected_port:
        raise UnsafeWebsiteTarget("Only standard HTTP and HTTPS website ports are supported.")
    try:
        normalized_host = hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except UnicodeError as error:
        raise UnsafeWebsiteTarget("Enter a valid website hostname.") from error
    try:
        ipaddress.ip_address(normalized_host)
    except ValueError:
        labels = normalized_host.split(".")
        if (
            len(normalized_host) > 253
            or len(labels) < 2
            or any(
                not label
                or len(label) > 63
                or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label)
                for label in labels
            )
        ):
            raise UnsafeWebsiteTarget("Enter a fully qualified website hostname.")
    display_host = f"[{normalized_host}]" if ":" in normalized_host else normalized_host
    default_port = 443 if scheme == "https" else 80
    normalized_url = f"{scheme}://{display_host}"
    if port is not None and port != default_port:
        normalized_url += f":{port}"
    normalized_url += "/"
    return normalized_url, normalized_host, default_port


def resolve_public_addresses(hostname: str, port: int) -> list[str]:
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        try:
            addresses = socket.getaddrinfo(
                hostname, port, type=socket.SOCK_STREAM
            )
        except socket.gaierror as error:
            raise OSError("The website hostname could not be resolved.") from error
        resolved = list(dict.fromkeys(record[4][0] for record in addresses))
    else:
        resolved = [str(literal)]
    if not resolved:
        raise OSError("The website hostname did not resolve to an address.")
    if any(not ipaddress.ip_address(address).is_global for address in resolved):
        raise UnsafeWebsiteTarget(
            "Private or local network addresses cannot be checked."
        )
    if len(resolved) > 8:
        raise OSError("The website hostname returned too many addresses to check.")
    return resolved


def normalize_remote_download_target(value: object) -> tuple[str, str, int, str]:
    if not isinstance(value, str) or not value.strip() or len(value) > 2_048:
        raise UnsafeWebsiteTarget("Enter a valid HTTP or HTTPS link.")
    try:
        parsed = urlsplit(value.strip())
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise UnsafeWebsiteTarget("Enter a valid HTTP or HTTPS link.") from error
    scheme = parsed.scheme.lower()
    if (
        scheme not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise UnsafeWebsiteTarget("Enter a public HTTP or HTTPS link without credentials.")
    default_port = 443 if scheme == "https" else 80
    if port is not None and port != default_port:
        raise UnsafeWebsiteTarget("Only standard HTTP and HTTPS ports are supported.")
    try:
        normalized_host = hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except UnicodeError as error:
        raise UnsafeWebsiteTarget("Enter a valid website hostname.") from error
    request_path = urllib.parse.quote(
        parsed.path or "/",
        safe="/%:@!$&'()*+,;=-._~",
    )
    if parsed.query:
        request_path += "?" + urllib.parse.quote(
            parsed.query,
            safe="/?@!$&'()*+,;=:-._~%",
        )
    authority_host = f"[{normalized_host}]" if ":" in normalized_host else normalized_host
    authority = authority_host if port is None else f"{authority_host}:{port}"
    target = f"{scheme}://{authority}{request_path}"
    return target, normalized_host, default_port, request_path


class PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, hostname: str, address: str, port: int) -> None:
        super().__init__(hostname, port, timeout=8)
        self.address = address

    def connect(self) -> None:
        self.sock = socket.create_connection((self.address, self.port), self.timeout)


class PinnedHTTPSConnection(PinnedHTTPConnection):
    def __init__(self, hostname: str, address: str, port: int) -> None:
        super().__init__(hostname, address, port)
        self.context = ssl.create_default_context()

    def connect(self) -> None:
        raw_socket = socket.create_connection((self.address, self.port), self.timeout)
        try:
            self.sock = self.context.wrap_socket(
                raw_socket,
                server_hostname=self.host,
            )
        except (OSError, ssl.SSLError):
            raw_socket.close()
            raise


def fetch_remote_webpage(value: str) -> Optional[tuple[bytes, str]]:
    target = value
    for redirect_count in range(6):
        target, hostname, port, request_path = normalize_remote_download_target(target)
        addresses = resolve_public_addresses(hostname, port)
        parsed = urlsplit(target)
        connection_type = PinnedHTTPSConnection if parsed.scheme == "https" else PinnedHTTPConnection
        response = None
        connection = None
        last_error: Optional[OSError] = None
        for address in addresses:
            try:
                connection = connection_type(hostname, address, port)
                authority = parsed.netloc
                connection.request(
                    "GET",
                    request_path,
                    headers={
                        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
                        "Accept-Encoding": "identity",
                        "Connection": "close",
                        "Host": authority,
                        "User-Agent": "SurfyFriend website download/1.0",
                    },
                )
                response = connection.getresponse()
                break
            except (OSError, ssl.SSLError, http.client.HTTPException) as error:
                last_error = error
                if connection:
                    connection.close()
        if response is None or connection is None:
            if isinstance(last_error, (TimeoutError, socket.timeout)):
                raise RemoteDownloadError(504, "The source website took too long to respond.")
            raise RemoteDownloadError(502, "Could not connect to the source website.")
        try:
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location or redirect_count == 5:
                    raise RemoteDownloadError(502, "The source website redirected too many times.")
                redirected_target = urllib.parse.urljoin(target, location)
                if parsed.scheme == "https" and urlsplit(redirected_target).scheme.lower() != "https":
                    raise RemoteDownloadError(502, "The source attempted an insecure HTTPS downgrade.")
                target = redirected_target
                continue
            if response.status != 200:
                raise RemoteDownloadError(502, f"The source website returned HTTP {response.status}.")
            content_type = response.getheader("Content-Type", "")
            content_encoding = response.getheader("Content-Encoding", "").lower()
            if content_encoding not in {"", "identity"}:
                raise RemoteDownloadError(502, "The source returned an unsupported compressed webpage.")
            declared_length = response.getheader("Content-Length")
            if declared_length:
                try:
                    if int(declared_length) > MAX_WEBPAGE_DOWNLOAD_BYTES:
                        raise RemoteDownloadError(413, "The webpage is larger than the 5 MB download limit.")
                except ValueError:
                    pass
            prefix = response.read(512)
            normalized_content_type = content_type.lower().split(";", 1)[0].strip()
            looks_like_html = normalized_content_type in {"text/html", "application/xhtml+xml"}
            if not looks_like_html and normalized_content_type in {"", "text/plain", "application/octet-stream"}:
                looks_like_html = bool(re.match(
                    br"(?is)^\s*(?:<!doctype\s+html|<html(?:\s|>))",
                    prefix.lstrip(b"\xef\xbb\xbf"),
                ))
            if not looks_like_html:
                return None
            body = prefix + response.read(MAX_WEBPAGE_DOWNLOAD_BYTES + 1 - len(prefix))
            if len(body) > MAX_WEBPAGE_DOWNLOAD_BYTES:
                raise RemoteDownloadError(413, "The webpage is larger than the 5 MB download limit.")
            if normalized_content_type not in {"text/html", "application/xhtml+xml"}:
                content_type = "text/html; charset=utf-8"
            return body, content_type or "text/html; charset=utf-8"
        finally:
            connection.close()
    raise RemoteDownloadError(502, "Could not retrieve the source webpage.")


def check_tls_certificate(hostname: str, addresses: list[str]) -> dict[str, str]:
    if not addresses:
        return {
            "status": "error",
            "message": "The website did not resolve to a checked address. The certificate check is inconclusive.",
        }
    context = ssl.create_default_context()
    valid_addresses = 0
    verification_failed = False
    connection_failed = False
    for address in addresses:
        try:
            with socket.create_connection((address, 443), timeout=5) as connection:
                with context.wrap_socket(connection, server_hostname=hostname):
                    valid_addresses += 1
        except ssl.SSLCertVerificationError:
            verification_failed = True
        except (OSError, ssl.SSLError):
            connection_failed = True
    if verification_failed:
        return {
            "status": "invalid",
            "message": "At least one website address has a TLS certificate that could not be verified.",
        }
    if connection_failed or valid_addresses != len(addresses):
        return {
            "status": "error",
            "message": "A secure connection could not be completed for every website address. The certificate check is inconclusive.",
        }
    return {
        "status": "valid",
        "message": "The website's TLS certificate is valid and trusted on every checked address.",
    }


def virustotal_request(path: str, api_key: str, data: Optional[bytes] = None) -> dict[str, object]:
    request = urllib.request.Request(
        f"{VIRUSTOTAL_API_URL}{path}",
        data=data,
        headers={
            "Accept": "application/json",
            "x-apikey": api_key,
            **({"Content-Type": "application/x-www-form-urlencoded"} if data is not None else {}),
        },
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = json.loads(response.read(1_048_577))
    if not isinstance(payload, dict):
        raise ValueError("The reputation service returned an unsupported response.")
    return payload


def parse_virustotal_report(payload: dict[str, object]) -> dict[str, object]:
    data = payload.get("data")
    attributes = data.get("attributes") if isinstance(data, dict) else None
    stats = attributes.get("last_analysis_stats") if isinstance(attributes, dict) else None
    if not isinstance(stats, dict):
        return {
            "provider": "VirusTotal",
            "status": "unavailable",
            "message": "No completed website reputation report is available yet.",
        }
    clean_stats = {
        key: value for key, value in stats.items()
        if isinstance(key, str) and type(value) is int and value >= 0
    }
    if not sum(clean_stats.get(key, 0) for key in (
        "malicious", "suspicious", "harmless", "undetected"
    )):
        return {
            "provider": "VirusTotal",
            "status": "unavailable",
            "message": "No completed security engine verdicts are available in this report.",
        }
    detections = clean_stats.get("malicious", 0) + clean_stats.get("suspicious", 0)
    return {
        "provider": "VirusTotal",
        "status": "flagged" if detections else "clean",
        "message": (
            "One or more security engines flagged this website."
            if detections
            else "No security engines flagged this website in the latest available report."
        ),
        "stats": clean_stats,
        "analysisDate": attributes.get("last_analysis_date"),
    }


class DltimeHandler(BaseHTTPRequestHandler):
    server_version = "SurfyFriend/1.1"

    def log_message(self, format: str, *args: object) -> None:
        if self.path.startswith("/media/") and args and isinstance(args[0], str):
            args = (args[0].replace(self.path, "/media/[share token redacted]"), *args[1:])
        super().log_message(format, *args)

    def _send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status: int, message: str) -> None:
        self._send_json(status, {"error": message})

    def _is_local_request(self, require_origin: bool = False) -> bool:
        host_header = self.headers.get("Host", "").lower()
        bound_host = self.server.server_address[0]
        if PUBLIC_ORIGIN_PARTS:
            allowed_hosts = {PUBLIC_ORIGIN_PARTS.netloc.lower()}
            allowed_origin = PUBLIC_ORIGIN
        else:
            allowed_hosts = {f"{bound_host}:{PORT}"}
            if bound_host == HOST:
                allowed_hosts.update(LOOPBACK_HOST_HEADERS)
            allowed_origin = f"http://{host_header}"
        if host_header not in allowed_hosts:
            self._send_error_json(403, "Requests must use this SurfyFriend address.")
            return False
        origin = self.headers.get("Origin")
        if require_origin and origin != allowed_origin:
            self._send_error_json(403, "This request did not come from SurfyFriend.")
            return False
        if origin and origin != allowed_origin:
            self._send_error_json(403, "Cross-origin requests are not allowed.")
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self._send_error_json(403, "Cross-site requests are not allowed.")
            return False
        return True

    def _read_json_body(
        self, max_bytes: int = MAX_ACCOUNT_BODY_BYTES
    ) -> Optional[dict[str, object]]:
        if self.headers.get_content_type() != "application/json":
            self.close_connection = True
            self._send_error_json(415, "Send account data as application/json.")
            return None
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.close_connection = True
            self._send_error_json(411, "A valid Content-Length header is required.")
            return None
        if content_length < 0 or content_length > max_bytes:
            self.close_connection = True
            self._send_error_json(413, "The request is too large.")
            return None
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_error_json(400, "Send a valid JSON request.")
            return None
        if not isinstance(payload, dict):
            self._send_error_json(400, "Send a JSON object.")
            return None
        return payload

    def _allow_auth_attempt(self) -> bool:
        now = datetime.now(timezone.utc).timestamp()
        remote_address = self.client_address[0]
        if PUBLIC_ORIGIN:
            forwarded_address = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
            if forwarded_address:
                remote_address = forwarded_address[:64]
        with self.server.auth_rate_lock:
            attempts = [
                timestamp
                for timestamp in self.server.auth_attempts.get(remote_address, [])
                if now - timestamp < 600
            ]
            if len(attempts) >= 12:
                self.server.auth_attempts[remote_address] = attempts
                self._send_error_json(
                    429, "Too many sign-in attempts. Wait a few minutes and try again."
                )
                return False
            attempts.append(now)
            self.server.auth_attempts[remote_address] = attempts
        return True

    def _clear_auth_attempts(self) -> None:
        remote_address = self.client_address[0]
        if PUBLIC_ORIGIN:
            forwarded_address = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
            if forwarded_address:
                remote_address = forwarded_address[:64]
        with self.server.auth_rate_lock:
            self.server.auth_attempts.pop(remote_address, None)

    def _session_token(self) -> Optional[str]:
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
        except (CookieError, ValueError):
            return None
        morsel = cookies.get(AUTH_COOKIE_NAME)
        return morsel.value if morsel else None

    def _set_session_cookie(self, token: str, max_age: int) -> None:
        cookie = (
            f"{AUTH_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={max_age}"
        )
        if PUBLIC_ORIGIN_PARTS and PUBLIC_ORIGIN_PARTS.scheme == "https":
            cookie += "; Secure"
        self.send_header("Set-Cookie", cookie)

    def _send_session_json(
        self, status: int, payload: object, token: str, max_age: int
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self._set_session_cookie(token, max_age)
        self.end_headers()
        self.wfile.write(body)

    def _create_session(self, account_id: int) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).digest()
        expires_at = int(datetime.now(timezone.utc).timestamp()) + SESSION_LIFETIME_SECONDS
        now = int(datetime.now(timezone.utc).timestamp())
        with account_database_connection() as connection:
            connection.execute(
                "DELETE FROM account_sessions WHERE expires_at <= ?", (now,)
            )
            connection.execute(
                """
                INSERT INTO account_sessions (token_hash, account_id, expires_at)
                VALUES (?, ?, ?)
                """,
                (token_hash, account_id, expires_at),
            )
        return token

    def _authenticated_account(self) -> Optional[sqlite3.Row]:
        token = self._session_token()
        if not token:
            self._send_error_json(401, "Sign in to access account data.")
            return None
        token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
        now = int(datetime.now(timezone.utc).timestamp())
        try:
            with account_database_connection() as connection:
                account = connection.execute(
                    """
                    SELECT accounts.id, accounts.username, accounts.data_json
                    FROM account_sessions
                    JOIN accounts ON accounts.id = account_sessions.account_id
                    WHERE account_sessions.token_hash = ?
                      AND account_sessions.expires_at > ?
                    """,
                    (token_hash, now),
                ).fetchone()
        except sqlite3.Error:
            self.log_error("Could not check account session.")
            self._send_error_json(500, "Could not check the account session.")
            return None
        if not account:
            self._send_error_json(401, "Your sign-in has expired. Sign in again.")
            return None
        return account

    def _account_status(self) -> None:
        if not self.server.accounts_enabled:
            self._send_json(200, {
                "enabled": False,
                "authenticated": False,
                "username": None,
            })
            return
        account = None
        token = self._session_token()
        if token:
            token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
            now = int(datetime.now(timezone.utc).timestamp())
            try:
                with account_database_connection() as connection:
                    account = connection.execute(
                        """
                        SELECT accounts.username
                        FROM account_sessions
                        JOIN accounts ON accounts.id = account_sessions.account_id
                        WHERE account_sessions.token_hash = ?
                          AND account_sessions.expires_at > ?
                        """,
                        (token_hash, now),
                    ).fetchone()
            except sqlite3.Error:
                self.log_error("Could not read account status.")
                self._send_error_json(500, "Could not read account status.")
                return
        self._send_json(200, {
            "enabled": True,
            "authenticated": bool(account),
            "username": account["username"] if account else None,
        })

    def _allow_webpage_download(self) -> bool:
        now = datetime.now(timezone.utc).timestamp()
        remote_address = self.client_address[0]
        if PUBLIC_ORIGIN:
            forwarded_address = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
            if forwarded_address:
                remote_address = forwarded_address[:64]
        with self.server.webpage_download_lock:
            attempts = [
                timestamp
                for timestamp in self.server.webpage_download_attempts.get(remote_address, [])
                if now - timestamp < 600
            ]
            if len(attempts) >= 6:
                self.server.webpage_download_attempts[remote_address] = attempts
                self._send_error_json(
                    429, "Too many webpage downloads. Wait a few minutes and try again."
                )
                return False
            attempts.append(now)
            self.server.webpage_download_attempts[remote_address] = attempts
        return True

    def _download_webpage(self) -> None:
        if not self._allow_webpage_download():
            return
        payload = self._read_json_body(MAX_SECURITY_CHECK_BODY_BYTES)
        if payload is None:
            return
        requested_name = payload.get("filename", "")
        if not isinstance(requested_name, str) or len(requested_name) > 512:
            self._send_error_json(400, "Enter a valid filename.")
            return
        try:
            target, hostname, _, _ = normalize_remote_download_target(payload.get("url"))
            webpage = fetch_remote_webpage(target)
        except UnsafeWebsiteTarget as error:
            self._send_error_json(400, str(error))
            return
        except RemoteDownloadError as error:
            self._send_error_json(error.status, str(error))
            return
        except (OSError, TimeoutError, http.client.HTTPException) as error:
            self.log_error(f"Could not retrieve webpage for download: {type(error).__name__}.")
            self._send_error_json(502, "Could not retrieve the webpage. Try the original link again later.")
            return
        if webpage is None:
            self._send_json(200, {"downloaded": False})
            return
        body, content_type = webpage
        filename = safe_filename(requested_name) if requested_name else f"{hostname}.html"
        if not filename.lower().endswith((".html", ".htm")):
            filename = f"{filename}.html"
        encoded_filename = urllib.parse.quote(filename, safe="")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Content-Disposition",
            f"attachment; filename*=UTF-8''{encoded_filename}",
        )
        self.send_header("X-SurfyFriend-Filename", encoded_filename)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(body)

    def _allow_website_check(self) -> bool:
        now = datetime.now(timezone.utc).timestamp()
        remote_address = self.client_address[0]
        if PUBLIC_ORIGIN:
            forwarded_address = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
            if forwarded_address:
                remote_address = forwarded_address[:64]
        with self.server.website_check_lock:
            attempts = [
                timestamp
                for timestamp in self.server.website_check_attempts.get(remote_address, [])
                if now - timestamp < 600
            ]
            if len(attempts) >= 10:
                self.server.website_check_attempts[remote_address] = attempts
                self._send_error_json(
                    429, "Too many website checks. Wait a few minutes and try again."
                )
                return False
            attempts.append(now)
            self.server.website_check_attempts[remote_address] = attempts
        return True

    def _security_status(self) -> None:
        self._send_json(200, {
            "malwareScanEnabled": bool(os.environ.get(VIRUSTOTAL_API_KEY_ENV, "").strip()),
            "provider": "VirusTotal",
        })

    def _check_website(self) -> None:
        if not self._allow_website_check():
            return
        payload = self._read_json_body(MAX_SECURITY_CHECK_BODY_BYTES)
        if payload is None:
            return
        try:
            target, hostname, port = normalize_website_target(payload.get("url"))
        except UnsafeWebsiteTarget as error:
            self._send_error_json(400, str(error))
            return

        parsed = urlsplit(target)
        if parsed.scheme == "https":
            try:
                addresses = resolve_public_addresses(hostname, port)
            except UnsafeWebsiteTarget as error:
                self._send_error_json(400, str(error))
                return
            except OSError:
                addresses = []
                tls_result = {
                    "status": "error",
                    "message": "The website hostname could not be reached to check its TLS certificate.",
                }
            else:
                tls_result = check_tls_certificate(hostname, addresses)
        else:
            addresses = []
            tls_result = {
                "status": "not_applicable",
                "message": "This website uses HTTP, so it does not have a TLS certificate.",
            }

        api_key = os.environ.get(VIRUSTOTAL_API_KEY_ENV, "").strip()
        if not api_key:
            malware_result = {
                "provider": "VirusTotal",
                "status": "not_configured",
                "message": (
                    "Malware reputation checks are unavailable until the server "
                    f"administrator configures {VIRUSTOTAL_API_KEY_ENV}."
                ),
            }
            self._send_json(200, {
                "target": target,
                "tls": tls_result,
                "malware": malware_result,
            })
            return

        url_id = base64.urlsafe_b64encode(target.encode("utf-8")).decode("ascii").rstrip("=")
        try:
            try:
                report = virustotal_request(f"/urls/{url_id}", api_key)
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
                virustotal_request(
                    "/urls",
                    api_key,
                    urllib.parse.urlencode({"url": target}).encode("ascii"),
                )
                malware_result = {
                    "provider": "VirusTotal",
                    "status": "pending",
                    "message": (
                        "A reputation scan was submitted. Check again in a minute "
                        "for its results."
                    ),
                }
            else:
                malware_result = parse_virustotal_report(report)
        except urllib.error.HTTPError as error:
            self.log_error(f"Website reputation request failed with HTTP {error.code}.")
            if error.code == 401:
                message = "The server's reputation-service API key was rejected."
            elif error.code == 429:
                message = "The reputation service rate limit was reached. Try again later."
            else:
                message = "The reputation service could not complete this check."
            malware_result = {
                "provider": "VirusTotal",
                "status": "error",
                "message": message,
            }
        except (OSError, TimeoutError, ValueError, urllib.error.URLError) as error:
            self.log_error(f"Website reputation check failed: {error}")
            malware_result = {
                "provider": "VirusTotal",
                "status": "error",
                "message": "The reputation service is temporarily unavailable.",
            }
        self._send_json(200, {
            "target": target,
            "tls": tls_result,
            "malware": malware_result,
        })

    def _register_account(self) -> None:
        if not self.server.accounts_enabled:
            self._send_error_json(403, "Account sign-in is disabled on an unencrypted network connection.")
            return
        if not self._allow_auth_attempt():
            return
        payload = self._read_json_body()
        if payload is None:
            return
        username = payload.get("username")
        password = payload.get("password")
        account_data = validate_account_data(payload.get("data", empty_account_data()))
        password_length = password_byte_length(password) if isinstance(password, str) else None
        if (
            not isinstance(username, str)
            or not USERNAME_PATTERN.fullmatch(username)
            or not isinstance(password, str)
            or password_length is None
            or not 12 <= password_length <= MAX_PASSWORD_BYTES
            or account_data is None
        ):
            self._send_error_json(
                400,
                "Use a 3–30 character username (letters, numbers, _ or -), a 12–256 byte password, and valid account data.",
            )
            return
        salt = secrets.token_bytes(16)
        password_hash = hash_password(password, salt)
        try:
            with account_database_connection() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO accounts (username, salt, password_hash, data_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        username,
                        salt,
                        password_hash,
                        json.dumps(account_data, ensure_ascii=False),
                        int(datetime.now(timezone.utc).timestamp()),
                    ),
                )
                account_id = cursor.lastrowid
            if account_id is None:
                raise sqlite3.DatabaseError("The account record was not created.")
            token = self._create_session(account_id)
        except sqlite3.IntegrityError:
            self._send_error_json(409, "That username is already in use.")
            return
        except sqlite3.Error:
            self.log_error("Could not create account.")
            self._send_error_json(500, "Could not create the account. Try again.")
            return
        self._clear_auth_attempts()
        self._send_session_json(
            201,
            {"authenticated": True, "username": username},
            token,
            SESSION_LIFETIME_SECONDS,
        )

    def _login_account(self) -> None:
        if not self.server.accounts_enabled:
            self._send_error_json(403, "Account sign-in is disabled on an unencrypted network connection.")
            return
        if not self._allow_auth_attempt():
            return
        payload = self._read_json_body()
        if payload is None:
            return
        username = payload.get("username")
        password = payload.get("password")
        password_length = password_byte_length(password) if isinstance(password, str) else None
        if (
            not isinstance(username, str)
            or not USERNAME_PATTERN.fullmatch(username)
            or not isinstance(password, str)
            or password_length is None
            or password_length > MAX_PASSWORD_BYTES
        ):
            self._send_error_json(401, "Username or password was not recognized.")
            return
        try:
            with account_database_connection() as connection:
                account = connection.execute(
                    """
                    SELECT id, username, salt, password_hash
                    FROM accounts WHERE username = ?
                    """,
                    (username,),
                ).fetchone()
            salt = account["salt"] if account else bytes(16)
            expected_hash = account["password_hash"] if account else bytes(32)
            actual_hash = hash_password(password, salt)
        except sqlite3.Error:
            self.log_error("Could not look up account.")
            self._send_error_json(500, "Could not sign in. Try again.")
            return
        if not account or not hmac.compare_digest(actual_hash, expected_hash):
            self._send_error_json(401, "Username or password was not recognized.")
            return
        try:
            token = self._create_session(account["id"])
        except sqlite3.Error:
            self.log_error("Could not create account session.")
            self._send_error_json(500, "Could not create a sign-in session.")
            return
        self._clear_auth_attempts()
        self._send_session_json(
            200,
            {"authenticated": True, "username": account["username"]},
            token,
            SESSION_LIFETIME_SECONDS,
        )

    def _logout_account(self) -> None:
        if not self.server.accounts_enabled:
            self._send_error_json(403, "Account sign-in is disabled on an unencrypted network connection.")
            return
        token = self._session_token()
        if token:
            token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
            try:
                with account_database_connection() as connection:
                    connection.execute(
                        "DELETE FROM account_sessions WHERE token_hash = ?",
                        (token_hash,),
                    )
            except sqlite3.Error:
                self.log_error("Could not end account session.")
                self._send_error_json(500, "Could not sign out. Try again.")
                return
        self._send_session_json(
            200, {"authenticated": False}, "", 0
        )

    def _account_data(self) -> None:
        if not self.server.accounts_enabled:
            self._send_error_json(403, "Account sync requires a secure HTTPS connection.")
            return
        account = self._authenticated_account()
        if not account:
            return
        try:
            data = json.loads(account["data_json"])
        except json.JSONDecodeError:
            self.log_error("Stored account data is invalid JSON.")
            self._send_error_json(500, "The saved account data could not be read.")
            return
        self._send_json(200, {"username": account["username"], "data": data})

    def _upload_files(self) -> list[tuple[Path, str, str]]:
        files = []
        for path in UPLOAD_ROOT.iterdir():
            if path.is_symlink() or not path.is_file():
                continue
            match = UPLOAD_FILENAME_PATTERN.fullmatch(path.name)
            if match:
                files.append((path, match.group(1), match.group(2)))
        files.sort(key=lambda item: item[0].stat().st_mtime, reverse=True)
        return files

    def _find_upload(self, upload_id: str) -> Optional[tuple[Path, str]]:
        if not UPLOAD_ID_PATTERN.fullmatch(upload_id):
            return None
        for path, file_id, filename in self._upload_files():
            if file_id == upload_id:
                return path, filename
        return None

    def _is_loopback_client(self) -> bool:
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    def _require_media_share_manager(self) -> bool:
        if not self._is_loopback_client():
            self.close_connection = True
            self._send_error_json(403, "Manage media shares from this computer using its local SurfyFriend address.")
            return False
        if PUBLIC_ORIGIN or not self.server.network_url:
            self._send_error_json(403, "Start SurfyFriend with --lan before creating or managing LAN media shares.")
            return False
        return True

    @staticmethod
    def _media_content_type(filename: str) -> Optional[str]:
        content_type = mimetypes.guess_type(filename)[0] or ""
        if not content_type.startswith(("audio/", "video/", "image/")):
            return None
        if content_type == "image/svg+xml":
            return None
        return content_type

    @staticmethod
    def _media_metadata_root() -> Path:
        return UPLOAD_ROOT / ".media-library"

    def _default_media_metadata(self, filename: str) -> dict[str, object]:
        stem = Path(filename).stem
        year_match = re.search(r"(?<!\d)(18\d{2}|19\d{2}|20\d{2}|2100)(?!\d)", stem)
        title = re.sub(r"[._]+", " ", stem).strip() or filename
        return {
            "title": title[:100],
            "summary": "",
            "year": int(year_match.group(1)) if year_match else None,
            "tags": [],
            "artwork": "",
        }

    def _read_media_metadata(self, upload_id: str, filename: str) -> dict[str, object]:
        root = self._media_metadata_root()
        path = root / f"{upload_id}.json"
        if root.is_symlink() or path.is_symlink() or not path.is_file():
            return self._default_media_metadata(filename)
        try:
            metadata = json.loads(path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as error:
            self.log_error("Could not read media metadata for %s: %s", upload_id, error)
            return self._default_media_metadata(filename)
        if not isinstance(metadata, dict):
            self.log_error("Stored media metadata for %s is not an object.", upload_id)
            return self._default_media_metadata(filename)
        title = metadata.get("title")
        summary = metadata.get("summary")
        year = metadata.get("year")
        tags = metadata.get("tags")
        artwork = metadata.get("artwork")
        if (
            not isinstance(title, str)
            or not title.strip()
            or len(title) > 100
            or not isinstance(summary, str)
            or len(summary) > 500
            or (year is not None and (type(year) is not int or not 1888 <= year <= 2100))
            or not isinstance(tags, list)
            or len(tags) > 10
            or not all(isinstance(tag, str) and 1 <= len(tag.strip()) <= 30 for tag in tags)
            or not isinstance(artwork, str)
            or (artwork and not re.fullmatch(rf"{upload_id}--poster\.(jpg|png|webp)", artwork))
        ):
            self.log_error("Stored media metadata for %s has invalid fields.", upload_id)
            return self._default_media_metadata(filename)
        return {
            "title": title.strip(),
            "summary": summary,
            "year": year,
            "tags": tags,
            "artwork": artwork,
        }

    def _list_media_library(self) -> None:
        if PUBLIC_ORIGIN:
            self._send_error_json(403, "The local media library is disabled on public deployments.")
            return
        try:
            files = []
            for path, upload_id, filename in self._upload_files():
                content_type = self._media_content_type(filename)
                if not content_type:
                    continue
                stat = path.stat()
                metadata = self._read_media_metadata(upload_id, filename)
                files.append({
                    "id": upload_id,
                    "name": filename,
                    "bytes": stat.st_size,
                    "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    "mediaType": content_type,
                    "metadata": {key: value for key, value in metadata.items() if key != "artwork"},
                    "artworkUrl": f"/api/media/library/{upload_id}/artwork" if metadata["artwork"] else "",
                })
        except OSError as error:
            self._send_error_json(500, f"Could not read the local media library: {error.strerror or 'file system error'}.")
            return
        self._send_json(200, {"items": files, "ffmpegAvailable": shutil.which("ffmpeg") is not None})

    def _save_media_metadata(self, upload_id: str) -> None:
        if PUBLIC_ORIGIN:
            self._send_error_json(403, "The local media library is disabled on public deployments.")
            return
        if not self._is_loopback_client():
            self.close_connection = True
            self._send_error_json(403, "Edit the local media library from this computer.")
            return
        upload = self._find_upload(upload_id)
        if not upload or not self._media_content_type(upload[1]):
            self._send_error_json(404, "That local media file was not found.")
            return
        payload = self._read_json_body(max_bytes=MAX_MEDIA_METADATA_BODY_BYTES)
        if payload is None:
            return
        title = payload.get("title")
        summary = payload.get("summary", "")
        year = payload.get("year")
        tags = payload.get("tags", [])
        if (
            not isinstance(title, str)
            or not title.strip()
            or len(title.strip()) > 100
            or not isinstance(summary, str)
            or len(summary) > 500
            or (year is not None and (type(year) is not int or not 1888 <= year <= 2100))
            or not isinstance(tags, list)
            or len(tags) > 10
            or not all(isinstance(tag, str) and 1 <= len(tag.strip()) <= 30 for tag in tags)
            or len({tag.strip().casefold() for tag in tags}) != len(tags)
        ):
            self._send_error_json(400, "Use a title up to 100 characters, a description up to 500 characters, a valid year, and up to 10 unique tags.")
            return

        root = self._media_metadata_root()
        metadata_path = root / f"{upload_id}.json"
        previous = self._read_media_metadata(upload_id, upload[1])
        artwork_name = previous["artwork"]
        artwork_value = payload.get("artwork", "keep")
        new_artwork_path: Optional[Path] = None
        if artwork_value != "keep":
            if artwork_value is None or artwork_value == "":
                artwork_name = ""
            elif isinstance(artwork_value, str):
                match = MEDIA_ARTWORK_DATA_PATTERN.fullmatch(artwork_value)
                if not match:
                    self._send_error_json(400, "Cover art must be a JPEG, PNG, or WebP data URL.")
                    return
                image_type, encoded_image = match.groups()
                try:
                    image_bytes = base64.b64decode(encoded_image, validate=True)
                except (binascii.Error, ValueError):
                    self._send_error_json(400, "The cover art data is invalid.")
                    return
                if not image_bytes or len(image_bytes) > MAX_MEDIA_ARTWORK_BYTES:
                    self._send_error_json(413, "Cover art must be smaller than 2 MB.")
                    return
                signatures = {
                    "jpeg": image_bytes.startswith(b"\xff\xd8\xff"),
                    "png": image_bytes.startswith(b"\x89PNG\r\n\x1a\n"),
                    "webp": image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP",
                }
                if not signatures[image_type]:
                    self._send_error_json(400, "The cover art does not match its declared image format.")
                    return
                extension = {"jpeg": "jpg", "png": "png", "webp": "webp"}[image_type]
                artwork_name = f"{upload_id}--poster.{extension}"
                try:
                    root.mkdir(mode=0o700, parents=True, exist_ok=True)
                    if root.is_symlink():
                        raise OSError("The media metadata directory cannot be a symbolic link.")
                    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{upload_id}-", suffix=".part", dir=root)
                    new_artwork_path = Path(temporary_name)
                    with os.fdopen(descriptor, "wb") as output:
                        os.chmod(new_artwork_path, 0o600)
                        output.write(image_bytes)
                    new_artwork_path.replace(root / artwork_name)
                    new_artwork_path = None
                except OSError as error:
                    if new_artwork_path:
                        new_artwork_path.unlink(missing_ok=True)
                    self._send_error_json(500, f"Could not save cover art: {error.strerror or str(error)}.")
                    return
            else:
                self._send_error_json(400, "The cover art data is invalid.")
                return

        metadata = {
            "title": title.strip(),
            "summary": summary.strip(),
            "year": year,
            "tags": list(dict.fromkeys(tag.strip() for tag in tags)),
            "artwork": artwork_name,
        }
        temporary_metadata: Optional[Path] = None
        try:
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
            if root.is_symlink():
                raise OSError("The media metadata directory cannot be a symbolic link.")
            descriptor, temporary_name = tempfile.mkstemp(prefix=f".{upload_id}-", suffix=".part", dir=root)
            temporary_metadata = Path(temporary_name)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                os.chmod(temporary_metadata, 0o600)
                json.dump(metadata, output, ensure_ascii=False)
            temporary_metadata.replace(metadata_path)
            temporary_metadata = None
        except OSError as error:
            if temporary_metadata:
                temporary_metadata.unlink(missing_ok=True)
            self._send_error_json(500, f"Could not save media details: {error.strerror or str(error)}.")
            return
        if previous["artwork"] and previous["artwork"] != artwork_name:
            old_artwork = root / str(previous["artwork"])
            if old_artwork.parent == root and not old_artwork.is_symlink():
                old_artwork.unlink(missing_ok=True)
        self._send_json(200, {"saved": True})

    def _serve_media_artwork(self, upload_id: str) -> None:
        upload = self._find_upload(upload_id)
        if not upload:
            self._send_error_json(404, "That media file was not found.")
            return
        metadata = self._read_media_metadata(upload_id, upload[1])
        artwork_name = metadata["artwork"]
        if not artwork_name:
            self._send_error_json(404, "No cover art is saved for that media file.")
            return
        root = self._media_metadata_root()
        artwork_path = root / str(artwork_name)
        try:
            if root.is_symlink() or artwork_path.is_symlink():
                raise OSError("Cover art path is not safe.")
            content_type = mimetypes.guess_type(str(artwork_path))[0] or "application/octet-stream"
            body = artwork_path.read_bytes()
        except OSError:
            self._send_error_json(404, "The saved cover art could not be read.")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _list_media_shares(self) -> None:
        if not self._require_media_share_manager():
            return
        with self.server.media_share_lock:
            shares = list(self.server.media_shares.items())
        files = []
        for token, upload_id in shares:
            upload = self._find_upload(upload_id)
            if not upload or not self._media_content_type(upload[1]):
                continue
            files.append({
                "token": token,
                "name": upload[1],
                "url": f"{self.server.network_url.rstrip('/')}/media/{token}",
            })
        self._send_json(200, files)

    def _create_media_share(self) -> None:
        if not self._require_media_share_manager():
            return
        payload = self._read_json_body(max_bytes=4_096)
        if payload is None:
            return
        upload_id = payload.get("uploadId")
        if not isinstance(upload_id, str) or not UPLOAD_ID_PATTERN.fullmatch(upload_id):
            self._send_error_json(400, "Choose a saved media file to share.")
            return
        upload = self._find_upload(upload_id)
        if not upload:
            self._send_error_json(404, "That saved media file was not found.")
            return
        if not self._media_content_type(upload[1]):
            self._send_error_json(415, "Only audio, video, and non-SVG image files can be shared.")
            return
        token = secrets.token_urlsafe(32)
        with self.server.media_share_lock:
            if len(self.server.media_shares) >= MAX_MEDIA_SHARES:
                self._send_error_json(409, f"You can have up to {MAX_MEDIA_SHARES} active media shares.")
                return
            self.server.media_shares[token] = upload_id
        self._send_json(201, {
            "token": token,
            "name": upload[1],
            "url": f"{self.server.network_url.rstrip('/')}/media/{token}",
        })

    def _revoke_media_share(self, token: str) -> None:
        if not self._require_media_share_manager():
            return
        if not MEDIA_SHARE_TOKEN_PATTERN.fullmatch(token):
            self._send_error_json(404, "That media share was not found.")
            return
        with self.server.media_share_lock:
            removed = self.server.media_shares.pop(token, None)
        if removed is None:
            self._send_error_json(404, "That media share was not found.")
            return
        self._send_json(200, {"revoked": True})

    def _remove_media_metadata(self, upload_id: str, filename: str) -> None:
        root = self._media_metadata_root()
        if root.is_symlink():
            self.log_error("Could not remove media metadata from a symbolic-link directory.")
            return
        metadata = self._read_media_metadata(upload_id, filename)
        try:
            (root / f"{upload_id}.json").unlink(missing_ok=True)
            artwork_name = metadata["artwork"]
            if artwork_name:
                artwork_path = root / str(artwork_name)
                if artwork_path.parent == root and not artwork_path.is_symlink():
                    artwork_path.unlink(missing_ok=True)
        except OSError as error:
            self.log_error("Could not remove media metadata for %s: %s", upload_id, error)

    def _media_share_upload(self, token: str) -> Optional[tuple[str, Path, str, str]]:
        if (
            not self.server.network_enabled
            or PUBLIC_ORIGIN
            or not MEDIA_SHARE_TOKEN_PATTERN.fullmatch(token)
        ):
            return None
        with self.server.media_share_lock:
            upload_id = self.server.media_shares.get(token)
        upload = self._find_upload(upload_id) if upload_id else None
        if not upload:
            return None
        path, filename = upload
        content_type = self._media_content_type(filename)
        if not content_type:
            return None
        return upload_id, path, filename, content_type

    def _serve_media_player(self, token: str) -> None:
        media = self._media_share_upload(token)
        if not media:
            self._send_error_json(404, "That media share was not found or has expired.")
            return
        upload_id, _, filename, content_type = media
        metadata = self._read_media_metadata(upload_id, filename)
        title = html.escape(str(metadata["title"]))
        summary = html.escape(str(metadata["summary"]))
        year = f'<span>{metadata["year"]}</span>' if metadata["year"] else ""
        tags = "".join(
            f"<span>{html.escape(tag)}</span>"
            for tag in metadata["tags"]
        )
        artwork = (
            f'<img class="artwork" src="/api/media/library/{upload_id}/artwork" alt="">'
            if metadata["artwork"]
            else ""
        )
        stream_url = f"/media/{token}/stream"
        if content_type.startswith("video/"):
            player = (
                f'<video id="player" controls playsinline preload="metadata" '
                f'poster="/api/media/library/{upload_id}/artwork" src="{stream_url}"></video>'
            )
        elif content_type.startswith("audio/"):
            player = f'<audio id="player" controls preload="metadata" src="{stream_url}"></audio>'
        else:
            player = f'<img class="media-image" src="{stream_url}" alt="{title}">'
        ffmpeg_button = (
            '<button id="transcode" type="button">Try FFmpeg-compatible playback</button>'
            if shutil.which("ffmpeg") and content_type.startswith(("audio/", "video/"))
            else ""
        )
        page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>{title} · SurfyFriend</title>
  <style>
    :root {{ color-scheme: dark; font: 16px system-ui, sans-serif; background: #11131a; color: #f6f7fb; }}
    body {{ max-width: 1000px; margin: 0 auto; padding: 28px; }}
    main {{ display: grid; gap: 18px; }}
    .heading {{ display: flex; align-items: center; gap: 20px; }}
    .artwork {{ width: 100px; height: 140px; object-fit: cover; border-radius: 10px; }}
    h1 {{ margin: 0 0 8px; font-size: clamp(24px, 5vw, 42px); }}
    p, .meta {{ color: #b9becb; line-height: 1.6; }}
    .tags {{ display: flex; flex-wrap: wrap; gap: 7px; }}
    .tags span {{ padding: 5px 9px; border-radius: 999px; background: #282c39; }}
    video {{ width: 100%; max-height: 72vh; background: #000; }}
    audio {{ width: 100%; }}
    .media-image {{ display: block; max-width: 100%; max-height: 72vh; margin: auto; }}
    button, a {{ color: #c2b5ff; }}
    button {{ padding: 10px 14px; border: 1px solid #49445e; border-radius: 8px; background: #252231; cursor: pointer; }}
    .controls {{ display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }}
    #status {{ min-height: 1.5em; color: #b9becb; }}
    @media (max-width: 520px) {{ body {{ padding: 16px; }} .artwork {{ width: 70px; height: 100px; }} }}
  </style>
</head>
<body data-token="{token}">
  <main>
    <header class="heading">{artwork}<div><h1>{title}</h1><div class="meta">{year}<span>{html.escape(filename)}</span></div></div></header>
    <p>{summary}</p>
    <div class="tags">{tags}</div>
    {player}
    <div class="controls">{ffmpeg_button}<a href="{stream_url}">Open media stream</a></div>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script>
    const token = document.body.dataset.token;
    const player = document.getElementById("player");
    const status = document.getElementById("status");
    if (player) {{
      const key = `surfyfriend.media.position.${{token}}`;
      player.addEventListener("loadedmetadata", () => {{
        try {{
          const saved = Number(localStorage.getItem(key) || 0);
          if (saved > 0 && saved < player.duration - 5) player.currentTime = saved;
        }} catch (error) {{ console.error("Could not restore media position.", error); }}
      }});
      player.addEventListener("timeupdate", () => {{
        if (player.currentTime < 5 || player.ended) return;
        try {{ localStorage.setItem(key, String(player.currentTime)); }}
        catch (error) {{ console.error("Could not save media position.", error); }}
      }});
      player.addEventListener("ended", () => {{
        try {{ localStorage.removeItem(key); }}
        catch (error) {{ console.error("Could not clear media position.", error); }}
      }});
      player.addEventListener("error", () => {{
        status.textContent = "Playback failed. Check that this format is supported or try FFmpeg-compatible playback.";
      }});
    }}
    const transcode = document.getElementById("transcode");
    if (transcode && player) {{
      transcode.addEventListener("click", () => {{
        status.textContent = "Transcoding with FFmpeg. Seeking is unavailable during transcoded playback.";
        player.src = `/media/${{encodeURIComponent(token)}}/stream?transcode=1`;
        player.load();
      }});
    }}
  </script>
</body>
</html>""".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; media-src 'self'; img-src 'self'; "
            "style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'",
        )
        self.end_headers()
        self.wfile.write(page)

    def _serve_transcoded_media(self, path: Path, content_type: str) -> None:
        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            self._send_error_json(503, "FFmpeg is not installed. Install it separately to use compatible playback.")
            return
        if not FFMPEG_STREAM_LIMIT.acquire(blocking=False):
            self._send_error_json(429, "The media server is busy transcoding other files. Try again shortly.")
            return
        if content_type.startswith("audio/"):
            output_type = "audio/mp4"
            stream_args = ["-vn", "-c:a", "aac", "-b:a", "160k"]
        else:
            output_type = "video/mp4"
            stream_args = [
                "-map", "0:v:0?", "-map", "0:a:0?",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-b:a", "160k",
            ]
        command = [
            ffmpeg_path, "-nostdin", "-hide_banner", "-loglevel", "error",
            "-i", str(path), *stream_args,
            "-movflags", "frag_keyframe+empty_moov+default_base_moof",
            "-f", "mp4", "pipe:1",
        ]
        try:
            with tempfile.TemporaryFile() as error_output:
                process = subprocess.Popen(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=error_output,
                )
                self.close_connection = True
                self.send_response(200)
                self.send_header("Content-Type", output_type)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    if process.stdout:
                        while True:
                            chunk = process.stdout.read1(1024 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                    return_code = process.wait(timeout=15)
                except (BrokenPipeError, ConnectionResetError):
                    if process.poll() is None:
                        process.terminate()
                    return_code = process.wait(timeout=5)
                except OSError as error:
                    if process.poll() is None:
                        process.terminate()
                    process.wait(timeout=5)
                    self.log_error("Media client disconnected during FFmpeg streaming: %s", error)
                    return_code = 0
                except subprocess.TimeoutExpired:
                    process.kill()
                    return_code = process.wait(timeout=5)
                if return_code:
                    error_output.seek(0)
                    detail = error_output.read(2_048).decode("utf-8", errors="replace").strip()
                    self.log_error("FFmpeg exited with status %s: %s", return_code, detail or "no diagnostic output")
        except OSError as error:
            self._send_error_json(500, f"Could not start FFmpeg: {error.strerror or str(error)}.")
        finally:
            FFMPEG_STREAM_LIMIT.release()

    def _serve_media_stream(self, token: str, transcode: bool = False) -> None:
        media = self._media_share_upload(token)
        if not media:
            self._send_error_json(404, "That media share was not found or has expired.")
            return
        _, path, filename, content_type = media
        if transcode:
            if not content_type.startswith(("audio/", "video/")):
                self._send_error_json(415, "FFmpeg-compatible playback is only available for audio and video.")
                return
            self._serve_transcoded_media(path, content_type)
            return

        try:
            source = path.open("rb")
            size = path.stat().st_size
        except OSError as error:
            self._send_error_json(404, f"Could not open the shared media: {error.strerror or 'file system error'}.")
            return

        start = 0
        end = size - 1
        status = 200
        range_header = self.headers.get("Range")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match or size == 0 or (not match.group(1) and not match.group(2)):
                source.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            first, last = match.groups()
            if first:
                start = int(first)
                end = int(last) if last else size - 1
            else:
                suffix_length = int(last)
                if suffix_length == 0:
                    source.close()
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                start = max(0, size - suffix_length)
            if start >= size or end < start:
                source.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            end = min(end, size - 1)
            status = 206

        content_length = end - start + 1
        fallback_name = filename.encode("ascii", "replace").decode("ascii").replace('"', "_")
        disposition = (
            f'inline; filename="{fallback_name}"; '
            f"filename*=UTF-8''{quote(filename, safe='')}"
        )
        try:
            source.seek(start)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(content_length))
            self.send_header("Content-Disposition", disposition)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            remaining = content_length
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        except OSError as error:
            self.log_error("Could not stream shared media: %s", error)
        finally:
            source.close()

    def do_GET(self) -> None:
        if not self._is_local_request():
            return
        request = urlsplit(self.path)
        if request.path == "/api/account/status":
            self._account_status()
            return
        if request.path == "/api/account/data":
            self._account_data()
            return
        if request.path == "/api/security/status":
            self._security_status()
            return
        if request.path == "/api/uploads":
            if PUBLIC_ORIGIN:
                self._send_error_json(403, "The file shelf is disabled on public deployments.")
                return
            self._list_uploads()
            return
        if request.path == "/api/media/library":
            self._list_media_library()
            return
        artwork_match = re.fullmatch(r"/api/media/library/([0-9a-f]{32})/artwork", request.path)
        if artwork_match:
            self._serve_media_artwork(artwork_match.group(1))
            return
        if request.path == "/api/media/shares":
            self._list_media_shares()
            return
        if request.path.startswith("/media/"):
            media_path = request.path.removeprefix("/media/")
            parts = media_path.split("/")
            if len(parts) == 1:
                self._serve_media_player(parts[0])
            elif len(parts) == 2 and parts[1] == "stream":
                query = urllib.parse.parse_qs(request.query, keep_blank_values=True)
                if query and query != {"transcode": ["1"]}:
                    self._send_error_json(400, "The media stream options are invalid.")
                    return
                self._serve_media_stream(parts[0], transcode=query == {"transcode": ["1"]})
            else:
                self._send_error_json(404, "That media share was not found.")
            return
        if request.path == "/api/status":
            self._send_json(200, {
                "networkEnabled": self.server.network_enabled,
                "networkUrl": self.server.network_url,
                "uploadsEnabled": not bool(PUBLIC_ORIGIN),
                "ffmpegAvailable": shutil.which("ffmpeg") is not None,
            })
            return
        if request.path.startswith("/api/uploads/"):
            if PUBLIC_ORIGIN:
                self._send_error_json(403, "The file shelf is disabled on public deployments.")
                return
            self._download_upload(unquote(request.path.removeprefix("/api/uploads/")))
            return
        self._serve_site_file(unquote(request.path))

    def do_POST(self) -> None:
        if not self._is_local_request(require_origin=True):
            return
        path = urlsplit(self.path).path
        if path == "/api/account/register":
            self._register_account()
            return
        if path == "/api/account/login":
            self._login_account()
            return
        if path == "/api/account/logout":
            self._logout_account()
            return
        if path == "/api/security/check":
            self._check_website()
            return
        if path == "/api/download/webpage":
            self._download_webpage()
            return
        if path == "/api/media/shares":
            self._create_media_share()
            return
        if path != "/api/uploads":
            self._send_error_json(404, "Unknown local upload endpoint.")
            return
        if PUBLIC_ORIGIN:
            self._send_error_json(403, "The file shelf is disabled on public deployments.")
            return
        self._save_upload()

    def do_PUT(self) -> None:
        if not self._is_local_request(require_origin=True):
            return
        request_path = unquote(urlsplit(self.path).path)
        media_metadata_match = re.fullmatch(r"/api/media/library/([0-9a-f]{32})", request_path)
        if media_metadata_match:
            self._save_media_metadata(media_metadata_match.group(1))
            return
        if request_path != "/api/account/data":
            self._send_error_json(404, "Unknown account endpoint.")
            return
        account = self._authenticated_account()
        if not account:
            return
        payload = self._read_json_body()
        if payload is None:
            return
        clean_data = validate_account_data(payload)
        if clean_data is None:
            self._send_error_json(400, "The account data is invalid or too large.")
            return
        try:
            with account_database_connection() as connection:
                connection.execute(
                    "UPDATE accounts SET data_json = ? WHERE id = ?",
                    (json.dumps(clean_data, ensure_ascii=False), account["id"]),
                )
        except sqlite3.Error:
            self.log_error("Could not save account data.")
            self._send_error_json(500, "Could not save account data. Try again.")
            return
        self._send_json(200, {"saved": True})

    def do_DELETE(self) -> None:
        if not self._is_local_request(require_origin=True):
            return
        if PUBLIC_ORIGIN:
            self._send_error_json(403, "The file shelf is disabled on public deployments.")
            return
        request_path = unquote(urlsplit(self.path).path)
        if request_path.startswith("/api/media/shares/"):
            self._revoke_media_share(request_path.removeprefix("/api/media/shares/"))
            return
        prefix = "/api/uploads/"
        if not request_path.startswith(prefix):
            self._send_error_json(404, "Unknown local upload endpoint.")
            return
        upload = self._find_upload(request_path[len(prefix):])
        if not upload:
            self._send_error_json(404, "That saved file was not found.")
            return
        upload_id = request_path[len(prefix):]
        try:
            upload[0].unlink()
        except OSError as error:
            self._send_error_json(500, f"Could not delete the saved file: {error.strerror or 'file system error'}.")
            return
        self._remove_media_metadata(upload_id, upload[1])
        with self.server.media_share_lock:
            expired_tokens = [
                token
                for token, shared_id in self.server.media_shares.items()
                if shared_id == upload_id
            ]
            for token in expired_tokens:
                del self.server.media_shares[token]
        self._send_json(200, {"deleted": True})

    def _list_uploads(self) -> None:
        try:
            files = [
                {
                    "id": file_id,
                    "name": filename,
                    "bytes": path.stat().st_size,
                    "modifiedAt": datetime.fromtimestamp(
                        path.stat().st_mtime, timezone.utc
                    ).isoformat(),
                }
                for path, file_id, filename in self._upload_files()
            ]
        except OSError as error:
            self._send_error_json(500, f"Could not read saved files: {error.strerror or 'file system error'}.")
            return
        self._send_json(200, files)

    def _save_upload(self) -> None:
        if self.headers.get_content_type() != "application/octet-stream":
            self._send_error_json(415, "Upload the file as application/octet-stream.")
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send_error_json(411, "A valid Content-Length header is required.")
            return
        if content_length < 0:
            self._send_error_json(400, "The upload size is invalid.")
            return
        if content_length > MAX_UPLOAD_BYTES:
            self._send_error_json(413, "Files must be 500 MB or smaller.")
            return
        filename_header = self.headers.get("X-File-Name", "")
        try:
            filename = safe_filename(unquote(filename_header, errors="strict"))
        except (UnicodeDecodeError, ValueError):
            self._send_error_json(400, "The file name is invalid.")
            return
        if not filename_header:
            self._send_error_json(400, "A file name is required.")
            return

        upload_id = uuid4().hex
        temporary_path: Optional[Path] = None
        try:
            UPLOAD_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{upload_id}-", suffix=".part", dir=UPLOAD_ROOT
            )
            temporary_path = Path(temporary_name)
            remaining = content_length
            with os.fdopen(descriptor, "wb") as output:
                os.chmod(temporary_path, 0o600)
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise OSError("The connection ended before the full file arrived.")
                    output.write(chunk)
                    remaining -= len(chunk)
            destination = UPLOAD_ROOT / f"{upload_id}--{filename}"
            temporary_path.replace(destination)
        except OSError as error:
            if temporary_path:
                temporary_path.unlink(missing_ok=True)
            self._send_error_json(500, f"Could not save the upload: {error.strerror or str(error)}")
            return
        self._send_json(201, {"id": upload_id, "name": filename, "bytes": content_length})

    def _download_upload(self, upload_id: str) -> None:
        upload = self._find_upload(upload_id)
        if not upload:
            self._send_error_json(404, "That saved file was not found.")
            return
        path, filename = upload
        try:
            size = path.stat().st_size
            content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            fallback_name = filename.encode("ascii", "replace").decode("ascii").replace('"', "_")
            disposition = (
                f'attachment; filename="{fallback_name}"; '
                f"filename*=UTF-8''{quote(filename, safe='')}"
            )
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", disposition)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            with path.open("rb") as source:
                shutil.copyfileobj(source, self.wfile, length=1024 * 1024)
        except OSError as error:
            self._send_error_json(500, f"Could not read the saved file: {error.strerror or 'file system error'}.")

    def _serve_site_file(self, request_path: str) -> None:
        relative_path = request_path.lstrip("/")
        if any(part.startswith(".") for part in Path(relative_path).parts):
            self.send_error(404)
            return
        if relative_path == "README.md" or Path(relative_path).suffix.lower() == ".py":
            self.send_error(404)
            return
        try:
            target = (SITE_ROOT / relative_path).resolve()
            target.relative_to(SITE_ROOT)
            if target.is_dir():
                target = target / "index.html"
            if not target.is_file():
                self.send_error(404)
                return
            body_size = target.stat().st_size
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(body_size))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            with target.open("rb") as source:
                shutil.copyfileobj(source, self.wfile, length=1024 * 1024)
        except (OSError, ValueError):
            self.send_error(404)


def main() -> None:
    global PUBLIC_ORIGIN, PUBLIC_ORIGIN_PARTS
    parser = argparse.ArgumentParser(description="Run the SurfyFriend web app and optional account service.")
    parser.add_argument(
        "--lan",
        action="store_true",
        help="also allow devices on the same local network to access the file shelf",
    )
    args = parser.parse_args()
    if PUBLIC_ORIGIN:
        public_origin_is_valid = False
        public_origin_canonical = ""
        try:
            public_origin_canonical = (
                f"{PUBLIC_ORIGIN_PARTS.scheme}://{PUBLIC_ORIGIN_PARTS.netloc}"
                if PUBLIC_ORIGIN_PARTS
                else ""
            )
            if PUBLIC_ORIGIN_PARTS:
                PUBLIC_ORIGIN_PARTS.port
            public_origin_is_valid = bool(
                PUBLIC_ORIGIN_PARTS
                and PUBLIC_ORIGIN_PARTS.scheme == "https"
                and PUBLIC_ORIGIN_PARTS.hostname
                and PUBLIC_ORIGIN_PARTS.path in {"", "/"}
                and not PUBLIC_ORIGIN_PARTS.query
                and not PUBLIC_ORIGIN_PARTS.fragment
                and not PUBLIC_ORIGIN_PARTS.username
                and not PUBLIC_ORIGIN_PARTS.password
                and PUBLIC_ORIGIN.lower() == public_origin_canonical.lower()
            )
        except ValueError:
            public_origin_is_valid = False
        if (
            not public_origin_is_valid
        ):
            raise RuntimeError(
                "DLTIME_PUBLIC_ORIGIN must be an HTTPS origin, for example https://surfyfriend.example."
            )
        PUBLIC_ORIGIN = public_origin_canonical.lower()
        PUBLIC_ORIGIN_PARTS = urlsplit(PUBLIC_ORIGIN)
        if args.lan:
            raise RuntimeError("Do not enable --lan on a public account deployment.")
        if HOST not in {"127.0.0.1", "localhost"}:
            raise RuntimeError(
                "Bind public deployments to 127.0.0.1 behind a trusted HTTPS reverse proxy."
            )
    else:
        UPLOAD_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    initialize_account_database()
    servers = []
    media_shares: dict[str, str] = {}
    media_share_lock = threading.Lock()
    lan_address = None
    if args.lan and not PUBLIC_ORIGIN:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route_socket:
                route_socket.connect(("192.0.2.1", 80))
                lan_address = route_socket.getsockname()[0]
            if not ipaddress.ip_address(lan_address).is_private:
                raise RuntimeError("The detected network address is not private.")
        except OSError as error:
            raise RuntimeError("Could not detect this computer's local network address.") from error
        except ValueError as error:
            raise RuntimeError("Could not detect a valid local network address.") from error

    try:
        for bind_host in ([HOST, lan_address] if lan_address else [HOST]):
            server = ThreadingHTTPServer((bind_host, PORT), DltimeHandler)
            server.daemon_threads = True
            server.network_enabled = bool(lan_address)
            server.accounts_enabled = bool(PUBLIC_ORIGIN) or not bool(lan_address)
            server.network_url = (
                f"http://{lan_address}:{PORT}/" if lan_address else None
            )
            server.auth_attempts = {}
            server.auth_rate_lock = threading.Lock()
            server.website_check_attempts = {}
            server.website_check_lock = threading.Lock()
            server.webpage_download_attempts = {}
            server.webpage_download_lock = threading.Lock()
            server.media_shares = media_shares
            server.media_share_lock = media_share_lock
            servers.append(server)
    except OSError as error:
        for server in servers:
            server.server_close()
        raise RuntimeError(
            f"Could not start SurfyFriend on port {PORT}: {error.strerror or error}."
        ) from error

    local_server = servers[0]
    if PUBLIC_ORIGIN:
        print(f"SurfyFriend public origin: {PUBLIC_ORIGIN}")
        print(f"Backend listening for its trusted HTTPS reverse proxy at {HOST}:{PORT}")
        print(f"Account database: {ACCOUNT_DB_PATH}")
        print("Internet-facing uploads and the local file shelf are disabled.")
    else:
        print(f"SurfyFriend is running at http://{HOST}:{PORT}/")
        print(f"Optional account database: {ACCOUNT_DB_PATH}")
    if lan_address:
        print(f"Local network sharing is enabled at http://{lan_address}:{PORT}/")
        print("WARNING: There is no password; devices on this network can view, download, upload, and delete saved files.")
        print("Selected media shares use unencrypted HTTP and can be opened by anyone with their link while this server runs.")
    if not PUBLIC_ORIGIN:
        print(f"Uploads are stored in {UPLOAD_ROOT}")
    print("Press Ctrl+C to stop the local server.")
    try:
        for server in servers[1:]:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        local_server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping SurfyFriend local server.")
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()

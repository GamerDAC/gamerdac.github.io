# SurfyFriend — Direct File Downloader

SurfyFriend is a standalone project in this directory.

The static downloader can be hosted independently. Without the full Python version, only Overview and Downloader remain available in the workspace; the other workspace links are greyed out and locked. Custom themes, **Website Explorer**, **Achievements**, **Media player**, **Download queue**, **My uploads**, and **Website checker** require the full Python version. **Suggested websites**, **Download history**, and the **AI helper** additionally require a signed-in account. Python 3.9 or newer is required; no packages need to be installed.

## Points and achievements

SurfyFriend keeps optional points, levels, and 61 badges in this browser by default. The dedicated **Achievements** page shows progress and lets you filter unlocked badges. Claim unlocked badges to celebrate with confetti; the sidebar count shows how many badges are waiting to be claimed and disappears when there are none. Points reflect actions SurfyFriend can observe: opening links (not confirming downloads), exploring unique website addresses, scanning webpages, adding queue links, visiting suggested sources, previewing media, and uploading files to the local shelf. Website Explorer normalizes addresses, ignores fragments, and awards 5 XP per address only once; repeat visits still open but award no XP. Unlocked badges award bonus points automatically. Progress stays in this browser unless you opt in to an account. Reset progress from **Settings** at any time.

The full Python version unlocks six color themes—Light, Dark, Ocean, Sunset, Forest, and Midnight—in **Settings → Appearance**. The toolbar theme button cycles through them. Your choice is saved in this browser. **Share** in the toolbar opens your device's share sheet where supported, or a dialog with a copyable link. Local `file://` and localhost addresses only work on the computer running SurfyFriend.

## Media player

Open **Media player** to play a direct HTTP or HTTPS audio/video file, preview an image, or choose a supported media file from this device. Device files are opened in the browser and are not uploaded. Remote media links must point directly to the media file; streaming-service pages, sign-in pages, and protected streams are not supported. Playback depends on the browser's supported formats and the source site's access rules.

## More ways to find downloads

The **Downloader** accepts direct file links and supported Google Drive, Dropbox, and OneDrive share links. When a URL looks like a webpage, SurfyFriend uses its Python backend to check the response and downloads HTML pages as `.html` files instead of opening them; this includes only the page source, not its images or linked files. Webpage downloads are limited to 5 MB, require a public HTTP(S) host, and need the local backend (they are unavailable from a static `file://` copy). Non-HTML responses are handed back to the browser's normal link behavior. A cloud share may open the provider's preview page; use its own Download option if shown. SurfyFriend does not bypass sign-in, sharing permissions, or protected streams.

Use **Find downloadable links on a webpage** to scan a public page for links that look like files, then choose which ones to add to the queue. Scanning is done in the browser, without a SurfyFriend proxy, and is limited to 5 MB and 50 links. The source must allow cross-origin browser access (CORS); pages that need sign-in or build their links with JavaScript may not work. The queue can also accept up to 50 links pasted one per line.

## Suggested websites and Puter AI

The **Suggested websites** page has curated links for official software downloads, openly available media, entertainment, games, books and learning, open datasets, and official exports of your own social-account data. Entertainment and games may be streamed, account-based, paid, or region-limited; check each source's requirements, licenses, and download permissions.

Curated suggestions work without an AI service. If you choose **Get AI picks**, SurfyFriend loads Puter.js from `js.puter.com` and sends Puter the selected category and SurfyFriend's curated list. Puter can suggest items from that list or other websites based on its existing knowledge; it does not perform a live web search or verify that a site is current. Outside suggestions are marked as unverified, and SurfyFriend only displays HTTPS links with a valid web address. Check the destination and its license and download rules before using it. SurfyFriend does not send download history, queue contents, or entered URLs. Puter may ask you to sign in; its User-Pays model applies the request to your own allowance or billing. Puter requires an `http://` or `https://` origin; if you opened `index.html` directly, run `python3 server.py` and open <http://127.0.0.1:8765/> instead. Curated suggestions still work from a `file://` page. See [Puter's developer site](https://developer.puter.com/) for details.

## Website Explorer

Use **Website Explorer** to open an address in a new browser tab. Enter a full `https://` or `http://` URL, or just a domain such as `example.com` (SurfyFriend will use HTTPS). The first visit to each normalized address earns 5 XP and can unlock exploration badges. Fragments are ignored, query parameters are sorted, and revisiting an address earns no XP. SurfyFriend awards XP when it successfully opens the tab; it cannot verify that the site loaded. Visited addresses and XP stay in this browser unless you opt in to an account. Check unfamiliar addresses before opening them.

## Website checker

**Website checker** checks an HTTPS certificate from the SurfyFriend server and can look up the latest available malware reputation report from VirusTotal. A clean report only means that no engines flagged the site in that report; it is not a safety guarantee, and reports can be incomplete or stale. HTTP sites have no TLS certificate to verify.

To enable malware reputation lookups, configure `SURFRYFRIEND_VIRUSTOTAL_API_KEY` in the server process environment before starting `python3 server.py`. Keep the key private and never put it in client-side code or commit it to the project. Without a key, certificate checks remain available and the page reports that malware checks are not configured. Submitted homepage addresses are sent to VirusTotal when lookups are enabled. The checker accepts only a site's homepage (no paths, query strings, fragments, or credentials) and blocks private/local network targets.

## Optional accounts and sync

You can sign in or create an account directly from the toolbar, or use **Settings**. The toolbar's **Tools** menu also provides shortcuts to frequently used pages, including Suggested websites, Website Explorer, the Media player, and My uploads. Usernames are 3–30 ASCII letters, digits, `_` or `-`; passwords must be 12–256 UTF-8 bytes. Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes (600,000 iterations); session tokens are random and only their hashes are stored. Sign-in uses an HttpOnly, SameSite=Strict cookie, marked Secure on an HTTPS deployment. No email address is collected, so there is no email password-recovery flow.

An account syncs XP and achievements, the Website Explorer address list, the download queue, and download history. The first account is initialized with the current browser's data. If you sign in on a browser that already has data and the account also has data, SurfyFriend asks you to choose: load the account copy onto this device, or replace the account copy with this device's data. After choosing, changes sync automatically. Signing out leaves the device's saved data in place. These saved links and browsing/download history may be private; the server's SQLite database stores them as readable application data (passwords are not stored in plain text). Protect the host and its database/backups.

For an internet-hosted account service, deploy `server.py` behind a trusted HTTPS reverse proxy and use persistent storage for SQLite. Example environment:

```sh
DLTIME_PUBLIC_ORIGIN=https://surfyfriend.example \
DLTIME_HOST=127.0.0.1 \
DLTIME_PORT=8765 \
DLTIME_ACCOUNT_DB=/var/lib/dltime/accounts.sqlite3 \
python3 server.py
```

Replace the example origin and database path. Existing deployments continue to use the `DLTIME_*` environment variable names. Configure the proxy to preserve the public `Host` header, terminate HTTPS, overwrite `X-Forwarded-For` with the visitor address, and proxy traffic to the loopback server. Keep port 8765 private to the host/proxy; do not enable `--lan`. The server rejects non-HTTPS public origins and non-loopback public binds, and throttles repeated sign-in attempts. Configure additional rate limiting at the proxy too. Public deployments disable the unauthenticated **My uploads** file shelf. SQLite is intended for a single persistent host, not multiple load-balanced app instances. Back up its database securely.

On the ordinary local server, accounts are kept on this computer in `~/.dropzone/accounts/accounts.sqlite3`. The `.dropzone` storage paths and `dltime_session` cookie name are retained so existing local files and signed-in sessions continue to work after the SurfyFriend rename. Account sign-in is deliberately disabled when `--lan` exposes the HTTP server to other devices; passwords must not be sent over unencrypted network connections. Hosted accounts require HTTPS.

## Keyboard, gamepad, and sound

Use `Alt+1` through `Alt+9` to open Home, Downloader, Suggested websites, Website Explorer, Media player, Download queue, My uploads, AI helper, and Achievements; `Alt+0` opens Settings. `Escape` returns to the previous SurfyFriend page. These shortcuts do not intercept keys while you type in a form. Normal Tab, Enter, and Space keyboard behavior remains available.

Connect a standard-mapped gamepad: the D-pad or left stick moves focus, A/0 activates, B/1 goes back, and Start toggles the navigation menu. Gamepad access depends on browser support and a secure browser context (HTTPS or localhost); typing website addresses still uses the keyboard. Turn on **Sound effects** in Settings to hear small locally generated navigation, XP, and achievement sounds. Sounds are off by default and no audio is sent over the network.

From this project directory (`appmarket/downloader` in the current workspace), start it with:

```sh
python3 server.py
```

Then open <http://127.0.0.1:8765/>. Keep the terminal running while using the local file shelf or local account service. Press `Ctrl+C` in that terminal to stop it.

Uploaded files are stored on this computer in `~/.dropzone/uploads` (the current user's home folder). This existing folder is retained so an app rename does not move or hide previously uploaded files. They remain there after the server stops and can be downloaded or deleted from **My uploads**. Files are limited to 500 MB each. The server binds to `127.0.0.1`, so it is not available to other computers on the network.

## Optional local-network sharing

To allow other devices on the same Wi-Fi/LAN to use this file shelf, stop the server and restart it with:

```sh
python3 server.py --lan
```

The server prints a local-network URL. Open that URL on devices connected to the same trusted network. Network access is off by default; the `--lan` flag also binds a listener to the detected private network address while keeping the loopback address available on this computer.

**Network sharing has no password or encryption.** Anyone who can reach that address on the local network can list, upload, download, and delete files in the shelf, and network traffic is sent over plain HTTP. Only enable it on a trusted network, stop the server with `Ctrl+C` when finished, and do not expose or forward port 8765 to the internet.

The **AI helper** is a context-aware built-in guide available to signed-in account holders. It can check a link's format, use the link already entered in the Downloader, explain the Media player, summarize the current queue and history, and give targeted troubleshooting steps. It runs locally using built-in rules and cannot test remote links or confirm that a download completed. It is separate from the optional Puter AI picks on the Suggested websites page.

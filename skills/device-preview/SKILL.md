---
name: device-preview
description: Open the local site in a preview showing a laptop frame and a mobile frame side by side, with selectable device sizes (MacBook Pro 16"/14", MacBook Air, laptop, desktop, iPhone, Android, iPad) and scroll synced between both. Use when the user wants to preview, check or test responsive layout, or says "preview", "lihat di mobile", "cek responsive".
argument-hint: "[url | port]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/preview.mjs *)
---

# Device Preview

Shows the user's site in two device frames side by side, a laptop/desktop on the left
and a phone/tablet on the right, so responsive layout can be checked without resizing
any window. Scrolling, clicking links and client-side navigation in one frame are
mirrored in the other, and hot reload updates both.

The script runs a small local server (default port 4747) that serves the preview and
proxies the site through the same origin, which is what makes scroll sync possible.
It never opens the system browser by itself.

Arguments: $ARGUMENTS

## Steps

1. **Work out the target URL.**
   - If an argument was given, use it. A bare number such as `5173` means `http://localhost:5173`.
   - Otherwise, look for a dev server that is already running. Check the common ports
     with `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>`, in this order:
     5173, 3000, 4321, 8080, 4200, 8000, 5000. Use the first one that answers.
   - If nothing is running, start the project's dev server **in the background**:
     read `package.json` scripts (`dev`, then `start`), pick the package manager from the
     lockfile (pnpm-lock.yaml → pnpm, yarn.lock → yarn, bun.lockb/bun.lock → bun, else npm),
     and wait until its output prints the local URL.
   - If it is a plain HTML project with no package.json, serve the folder in the background
     with `python3 -m http.server 8000` and use `http://localhost:8000`.

2. **Show the preview inside Claude, never in the system browser.**

   **If you have a Browser pane / preview tools (Claude Code Desktop):** add this entry to
   `.claude/launch.json` at the project root (create the file if it is missing; keep any
   existing entries and replace an older `device-preview` entry), using the target URL from step 1:

   ```json
   {
     "version": "0.0.1",
     "configurations": [
       {
         "name": "device-preview",
         "runtimeExecutable": "node",
         "runtimeArgs": ["${CLAUDE_SKILL_DIR}/scripts/preview.mjs", "<target-url>", "--port", "4747"],
         "port": 4747,
         "autoPort": false
       }
     ]
   }
   ```

   Then start the `device-preview` server with your preview tools and open it in the
   Browser pane. It opens at `http://localhost:4747`, which shows the device preview.

   **Otherwise (terminal):** start the server **in the background**:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/preview.mjs <target-url>
   ```

   It prints `✓ Device Preview running: http://localhost:4747/`. Give the user that URL as a
   clickable link. Only add `--open` (system browser) if the user asks for it.

3. **Reply in one or two lines:** which URL is showing, and that the device menus are at
   the top. Do not take screenshots or describe the layout unless asked.

## Notes

- Running the skill again is safe: in the terminal it reuses a running preview server for the
  same site; with `--port` it replaces the older server on that port.
- The ↗ button in the toolbar is the one action that opens the page in the system browser.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Frames show "cannot reach" | The dev server is not running or the port is wrong. Start it, then reload the preview. |
| Scroll does not sync on one page | That page scrolls inside an element whose structure differs between the laptop and mobile layouts. Window scroll and matching scroll containers sync; others cannot. |
| Port 4747 is taken by another app | Use another port in both `runtimeArgs` and `port` (launch.json), or pass `--port <n>` in the terminal. |
| SSH / remote session | The Browser pane cannot reach the machine; give the user the URL to open after forwarding the port. |

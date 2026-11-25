---
name: device-preview
description: Open the local site in a preview showing a laptop frame and a mobile frame side by side, with selectable device sizes (MacBook Pro 16"/14", MacBook Air, laptop, desktop, iPhone, Android, iPad) and scroll synced between both. Use when the user wants to preview, check or test responsive layout, or says "preview", "lihat di mobile", "cek responsive".
argument-hint: "[url | port]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/preview.mjs *)
---

# Device Preview

Shows the site in two device frames side by side: a laptop or desktop on the left and a
phone or tablet on the right. Scrolling, link clicks and client-side navigation in one frame
are mirrored in the other, and hot reload updates both.

`scripts/preview.mjs` runs a local server (default port 4747) that serves the preview page and
proxies the site through the same origin, which is what makes scroll sync possible. It does
not open the system browser unless `--open` is passed.

Arguments: $ARGUMENTS

## Steps

1. **Find the target URL.**
   - If an argument was given, use it. A bare number such as `5173` means `http://localhost:5173`.
   - Otherwise check for a running dev server with
     `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>` on these ports, in order:
     5173, 3000, 4321, 8080, 4200, 8000, 5000. Use the first one that answers.
   - If nothing is running, start the project's dev server in the background. Use the `dev`
     script from `package.json` (or `start`), with the package manager that matches the lockfile
     (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb`/`bun.lock` → bun, otherwise npm).
     Wait until it prints its local URL.
   - For a plain HTML folder without `package.json`, run `python3 -m http.server 8000` in the
     background and use `http://localhost:8000`.

2. **Start the preview.**

   **With a Browser pane (desktop app with preview tools):** add this configuration to
   `.claude/launch.json` in the project root. Create the file if needed, keep other entries,
   and replace any older `device-preview` entry:

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

   Start the `device-preview` server with the preview tools and open `http://localhost:4747`
   in the Browser pane.

   **In a terminal:** start the server in the background:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/preview.mjs <target-url>
   ```

   It prints `Device Preview running: http://localhost:4747/`. Share that URL as a link.
   Add `--open` only when the user wants the system browser.

3. **Reply in one or two lines:** the URL being shown, and that the device menus are in the
   toolbar at the top. Skip screenshots and layout descriptions unless asked.

## Notes

- Running it again is safe. Without `--port` it reuses a server that already proxies the same
  site; with `--port` it replaces the older server on that port.
- The ↗ button in the toolbar opens the current page in the system browser.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Frames show "cannot reach" | The dev server is not running or the port is wrong. Start it, then reload the preview. |
| Scroll does not sync on one page | The page scrolls inside an element that differs between the laptop and mobile layouts. Window scroll and matching scroll containers sync; others cannot. |
| Port 4747 is taken by another app | Use another port in both `runtimeArgs` and `port` in launch.json, or pass `--port <n>` in the terminal. |
| SSH or remote session | The Browser pane cannot reach the remote machine. Forward the port and share the URL. |

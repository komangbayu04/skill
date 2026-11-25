---
name: device-preview
description: Open the local site in a browser preview showing a laptop frame and a mobile frame side by side, with selectable device sizes (MacBook Pro 16"/14", MacBook Air, laptop, desktop, iPhone, Android, iPad) and scroll synced between both. Use when the user wants to preview, check or test responsive layout, or says "preview", "lihat di mobile", "cek responsive".
argument-hint: "[url | port]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/preview.mjs *)
---

# Device Preview

Opens one browser tab showing the user's site in two device frames side by side,
a laptop/desktop on the left and a phone/tablet on the right, so responsive layout
can be checked without resizing any window. Scrolling, clicking links and client-side
navigation in one frame are mirrored in the other, and hot reload updates both.

The script runs a small local server that proxies the site through the preview's own
origin. That is what makes scroll sync possible, so the server has to keep running.

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

2. **Start the preview server in the background** (it keeps running):

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/preview.mjs <url>
   ```

   It prints `✓ Device Preview running: http://localhost:4747/__device-preview/...` and opens
   that page in the default browser. If a preview server for the same site is already
   running, the script just opens the page again and exits, so running it twice is safe.

3. **Reply in one or two lines:** which URL is showing, and that the device menus are at
   the top. Do not take screenshots or describe the layout unless asked.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Frames show "cannot reach" | The dev server is not running or the port is wrong. Start it, then reload the preview. |
| Scroll does not sync on one page | That page scrolls inside an element whose structure differs between the laptop and mobile layouts. Window scroll and matching scroll containers sync; others cannot. |
| Hot reload stops working inside the frames | Some dev servers pin the HMR socket to their own port. That still works (the frames reach it directly); if not, open the site's own URL with the ↗ button. |
| Browser does not open (remote/SSH machine) | Run the script with `--no-open` and give the user the printed URL. |
| Port 4747 is busy | The script picks the next free port automatically, or pass `--port <n>`. |

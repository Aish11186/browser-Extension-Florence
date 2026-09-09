# Florence-2 Screen Watcher (v1)

## Load
1. `chrome://extensions` → Developer mode → "Load unpacked" → select this folder.
2. Needs Chrome 121+ with WebGPU enabled (`chrome://flags/#enable-unsafe-webgpu` if not default).
3. Reload the extension after loading it.
4. To run `sanitisation.py` automatically, copy the extension ID and run:
   `powershell -ExecutionPolicy Bypass -File .\setup-sanitisation-host.ps1 -ExtensionId YOUR_EXTENSION_ID`

## What it does
- Every 4s, captures the active tab screenshot. Or when siginificant DOM changes occur.
- Sends it to an offscreen document running Florence-2-base-ft (`<OD>` task) via transformers.js + WebGPU.
- Detected object labels appear in a small popup, bottom-right of the page.
- Saves every completed scan in Chrome extension local storage under `florenceDetectionLog`. Each saved record includes the screenshot number, elapsed seconds, ISO timestamp, labels, and bounding-box positions. Nothing is written to Downloads. The bottom-right panel has an ON/OFF button; it is ON by default. Turning it OFF pauses captures and inference while keeping the loaded model available.
- Additionally saves the first five screenshots containing the exact label `human face` as `images\1.png` through `images\5.png` in this project folder. Coordinates for every detection in each saved screenshot are written in clearly separated `Image N` blocks in `coordinates.txt`. After each image and coordinate update completes, the local Native Messaging helper runs `sanitisation.py`, which writes sanitized images to `sanitized\N.png`.

## Known v1 limitations
- No PII redaction yet — this is just the detection loop.
- First load downloads/caches the model (~200-400MB quantized) from HF Hub — expect a delayed first popup.
- `captureVisibleTab` only sees the visible tab, not full page/cross-origin iframes.
- Interval (`CAPTURE_INTERVAL_MS` in background.js) trades latency vs. resource use — tune per your eval metric.

## Next steps toward the full spec
- Add PII detection pass (`<OPEN_VOCABULARY_DETECTION>` with prompts: "face", "password field", "email text") and canvas redaction before any server transmission.
- Add server POST of sanitized image + DOM JSON, replace popup text with returned VLM action.

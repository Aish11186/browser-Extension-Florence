# Florence-2 Screen Watcher (v1)

## Load
1. `chrome://extensions` → Developer mode → "Load unpacked" → select this folder.
2. Needs Chrome 121+ with WebGPU enabled (`chrome://flags/#enable-unsafe-webgpu` if not default).

## What it does
- Every 4s, captures the active tab screenshot.
- Sends it to an offscreen document running Florence-2-base-ft (`<OD>` task) via transformers.js + WebGPU.
- Detected object labels appear in a small popup, bottom-right of the page.

## Known v1 limitations
- No PII redaction yet — this is just the detection loop.
- First load downloads/caches the model (~200-400MB quantized) from HF Hub — expect a delayed first popup.
- `captureVisibleTab` only sees the visible tab, not full page/cross-origin iframes.
- Interval (`CAPTURE_INTERVAL_MS` in background.js) trades latency vs. resource use — tune per your eval metric.

## Next steps toward the full spec
- Add PII detection pass (`<OPEN_VOCABULARY_DETECTION>` with prompts: "face", "password field", "email text") and canvas redaction before any server transmission.
- Add server POST of sanitized image + DOM JSON, replace popup text with returned VLM action.

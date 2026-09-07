// background.js — MV3 service worker
const OFFSCREEN_URL = "offscreen.html";
const CAPTURE_INTERVAL_MS = 4000; // tune for latency/resource tradeoff
const NATIVE_HOST_NAME = "com.florence2.sanitisation";
const DETECTION_LOG_KEY = "florenceDetectionLog";
const HUMAN_FACE_IMAGE_KEY = "florenceHumanFaceFaceOnlyImages";
const HUMAN_FACE_IMAGE_FOLDER = "Florence2extensionv1";
const HUMAN_FACE_COORDINATES_FILE = `${HUMAN_FACE_IMAGE_FOLDER}/coordinates.txt`;
const MAX_HUMAN_FACE_IMAGES = 5;

let offscreenReady = false;
let lastStatus = "extension started";
let modelLoaded = false;
const optionPorts = new Set();
let detectionSaveQueue = Promise.resolve();
let humanFaceExportQueue = Promise.resolve();
let detectionEnabled = true;

function getDetectionLabel(item) {
  return typeof item === "string"
    ? item
    : (item?.label || item?.class || item?.name || "");
}

function getHumanFaceBboxes(detections) {
  return detections.filter((item) => {
    return String(getDetectionLabel(item)).trim().toLowerCase() === "human face";
  }).map((item) => item?.bbox).filter((bbox) => Array.isArray(bbox));
}

async function waitForDownload(downloadId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [download] = await chrome.downloads.search({ id: downloadId });
    if (download?.state === "complete") return;
    if (download?.state === "interrupted") throw new Error(`download ${downloadId} was interrupted`);
    await sleep(100);
  }
  throw new Error(`download ${downloadId} did not finish in time`);
}

function downloadData(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, saveAs: false, conflictAction: "overwrite" },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(downloadId);
      }
    );
  });
}

async function runSanitisation() {
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { type: "RUN_SANITISATION" });
    if (!response?.ok) console.warn("sanitisation.py failed:", response?.error || "unknown error");
  } catch (error) {
    console.warn("could not run sanitisation.py:", error?.message || error);
  }
}

function exportHumanFaceImage(dataUrl, detections) {
  const humanFaceBboxes = getHumanFaceBboxes(detections);
  if (humanFaceBboxes.length === 0) return Promise.resolve();
  const exportJob = humanFaceExportQueue.then(async () => {
    // Session storage resets for a new extension run but survives service-worker
    // suspension, so each run can export its own first two images.
    const stored = await chrome.storage.session.get(HUMAN_FACE_IMAGE_KEY);
    const exported = Array.isArray(stored[HUMAN_FACE_IMAGE_KEY])
      ? stored[HUMAN_FACE_IMAGE_KEY]
      : [];
    if (exported.length >= MAX_HUMAN_FACE_IMAGES) return;

    const imageNumber = exported.length + 1;
    const imageDownloadId = await downloadData(dataUrl, `${HUMAN_FACE_IMAGE_FOLDER}/images/${imageNumber}.png`);
    const nextExport = [...exported, {
      image: imageNumber,
      humanFaceBboxes,
      timestamp: new Date().toISOString(),
    }];
    const coordinates = nextExport.map((record) => [
      `Image ${record.image}`,
      ...record.humanFaceBboxes.map((bbox, index) => `bbox ${index + 1}: [${bbox.join(", ")}]`),
      "",
    ].join("\n")).join("\n");
    const coordinatesUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(coordinates)}`;
    const coordinatesDownloadId = await downloadData(coordinatesUrl, HUMAN_FACE_COORDINATES_FILE);
    await Promise.all([waitForDownload(imageDownloadId), waitForDownload(coordinatesDownloadId)]);
    await chrome.storage.session.set({ [HUMAN_FACE_IMAGE_KEY]: nextExport });
    await runSanitisation();
  });
  humanFaceExportQueue = exportJob.catch((error) => {
    console.warn("failed to export human-face detection:", error);
  });
  return exportJob;
}

function saveDetections(detections) {
  // Queue writes so overlapping alarms cannot reuse a screenshot number.
  const save = detectionSaveQueue.then(async () => {
    const stored = await chrome.storage.local.get(DETECTION_LOG_KEY);
    const previous = stored[DETECTION_LOG_KEY] || {};
    const screenshots = Array.isArray(previous) ? previous : (previous.screenshots || []);
    const startedAt = Array.isArray(previous)
      ? (screenshots[0]?.timestampEpochMs || Date.now())
      : (previous.startedAt || Date.now());
    const now = Date.now();
    const entry = {
      screenshot: screenshots.length + 1,
      timeSeconds: Number(((now - startedAt) / 1000).toFixed(3)),
      timestamp: new Date(now).toISOString(),
      timestampEpochMs: now,
      detections,
    };
    screenshots.push(entry);
    await chrome.storage.local.set({
      [DETECTION_LOG_KEY]: { startedAt, screenshots },
    });
  });
  detectionSaveQueue = save.catch(() => {});
  return save;
}

function setStatus(status, tabId) {
  lastStatus = status;
  const target = tabId
    ? Promise.resolve([{ id: tabId }])
    : chrome.tabs.query({ active: true, currentWindow: true });
  target.then(([tab]) => {
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "STATUS", status }).catch(() => {});
  }).catch(() => {});
  console.log(`[Florence-2] ${status}`);
}

async function ensureOffscreen() {
  setStatus("STEP 3/10: checking inference document");
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) {
    setStatus("STEP 4/10: inference document already exists");
    return;
  }
  setStatus("STEP 4/10: creating inference document");
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS"], // needed to run WebGPU/inference JS off the main thread of the SW
    justification: "Run Florence-2 WebGPU inference"
  });
  setStatus("STEP 5/10: inference document created");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestInference(dataUrl, tabId) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    setStatus(`STEP 7/10: sending inference request (attempt ${attempt}/5)`, tabId);
    const result = await sendToOffscreen({ type: "INFER", dataUrl });
    if (result.response) return result.response;
    if (attempt < 5) {
      setStatus(`RETRY: offscreen inference listener not ready (${result.error || "no response"})`, tabId);
      await sleep(500);
    } else {
      throw new Error(result.error || "offscreen document returned no response after 5 attempts");
    }
  }
}

async function sendToOffscreen(message) {
  let lastError = "no response";
  for (let attempt = 1; attempt <= 10; attempt++) {
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve({ response, error: chrome.runtime.lastError?.message || null });
      });
    });
    if (result.response) return result;
    lastError = result.error || lastError;
    // createDocument() can resolve before offscreen.js has registered its
    // message listener. Give it time, then retry the exact same request.
    await sleep(300);
  }
  return { response: null, error: lastError };
}

async function captureAndInfer() {
  try {
    if (!detectionEnabled) return;
    if (!modelLoaded) {
      await ensureOffscreen();
      const probe = await sendToOffscreen({ type: "PING" });
      if (!probe.response?.modelLoaded) {
        setStatus("WAITING FOR MODEL: open Options and click Load Florence-2");
        return;
      }
      modelLoaded = true;
    }
    setStatus("STEP 1/10: selecting active tab");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      setStatus("STOPPED: no active tab");
      return;
    }
    setStatus(`STEP 2/10: active tab found (${tab.id})`, tab.id);

    // The alarm is not a user invocation, so activeTab cannot be relied on.
    // Pass the window id explicitly; the <all_urls> host permission covers
    // ordinary web pages for automatic captures.
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    setStatus("STEP 6/10: screenshot captured; sending to Florence-2", tab.id);
    await ensureOffscreen();

    const response = await requestInference(dataUrl, tab.id);
    if (!detectionEnabled) return;
    try {
      await saveDetections(response.labels || []);
    } catch (error) {
      // Storage is best-effort. Keep detection and the sidebar working if a
      // storage write fails.
      console.warn("failed to save detections locally:", error);
    }
    exportHumanFaceImage(dataUrl, response.labels || []);
    setStatus(`STEP 10/10: detection delivered (${response.labels?.length || 0} objects)`, tab.id);
    chrome.tabs.sendMessage(tab.id, { type: "DETECTIONS", labels: response.labels || [] }).catch(() => {});
  } catch (e) {
    setStatus(`ERROR: ${e?.message || e}`);
    console.warn("capture/infer failed:", e);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOGGLE_DETECTION") {
    detectionEnabled = msg.enabled === true;
    return Promise.resolve({ enabled: detectionEnabled });
  }
  if (msg.type === "GET_STATUS") return Promise.resolve({ status: lastStatus });
  if (msg.type === "MODEL_STATUS") {
    if (msg.status === "STEP 9/10: model, processor, and tokenizer ready") modelLoaded = true;
    if (msg.status?.startsWith("error:") || msg.status?.startsWith("ERROR")) modelLoaded = false;
    for (const port of optionPorts) {
      try { port.postMessage(msg); } catch {}
    }
    if (msg.status) setStatus(`MODEL: ${msg.status}`);
    return;
  }
  if (msg.type !== "STATUS") return;
  setStatus(msg.status);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "florence-options") return;
  optionPorts.add(port);
  port.onDisconnect.addListener(() => optionPorts.delete(port));
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "LOAD_MODEL") return;
    try {
      setStatus("MODEL: starting load from Options page");
      await ensureOffscreen();
      const result = await sendToOffscreen({ type: "LOAD_MODEL" });
      if (result.error || !result.response?.ok) {
        port.postMessage({ type: "MODEL_RESULT", ok: false, error: result.error || result.response?.error || "model did not load" });
      } else {
        port.postMessage({ type: "MODEL_RESULT", ok: true });
      }
    } catch (e) {
      port.postMessage({ type: "MODEL_RESULT", ok: false, error: e?.message || String(e) });
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("tick", { periodInMinutes: CAPTURE_INTERVAL_MS / 60000 });
  chrome.runtime.openOptionsPage();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "tick" && detectionEnabled) captureAndInfer();
});

// Also run once on startup for immediate feedback. Keep the rejection visible
// in the service-worker inspector; otherwise the page overlay stays on
// “waiting” with no indication that initialization failed.
// The model is loaded explicitly from options.html. This prevents inference
// requests from racing the offscreen document during extension startup.

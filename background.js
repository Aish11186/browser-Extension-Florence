// background.js — MV3 service worker
const OFFSCREEN_URL = "offscreen.html";
const CAPTURE_INTERVAL_MS = 4000; // tune for latency/resource tradeoff

let offscreenReady = false;
let lastStatus = "extension started";
let modelLoaded = false;
const optionPorts = new Set();

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
    if (!modelLoaded) {
      setStatus("WAITING FOR MODEL: open Options and click Load Florence-2");
      return;
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
      format: "jpeg",
      quality: 70,
    });
    setStatus("STEP 6/10: screenshot captured; sending to Florence-2", tab.id);
    await ensureOffscreen();

    const response = await requestInference(dataUrl, tab.id);
    setStatus(`STEP 10/10: detection delivered (${response.labels?.length || 0} objects)`, tab.id);
    chrome.tabs.sendMessage(tab.id, { type: "DETECTIONS", labels: response.labels || [] }).catch(() => {});
  } catch (e) {
    setStatus(`ERROR: ${e?.message || e}`);
    console.warn("capture/infer failed:", e);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
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
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tick") captureAndInfer(); });

// Also run once on startup for immediate feedback. Keep the rejection visible
// in the service-worker inspector; otherwise the page overlay stays on
// “waiting” with no indication that initialization failed.
// The model is loaded explicitly from options.html. This prevents inference
// requests from racing the offscreen document during extension startup.

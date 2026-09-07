// content.js — injects a small overlay showing detected classes
(function () {
  document.getElementById("florence-watcher-popup")?.remove();
  const box = document.createElement("div");
  box.id = "florence-watcher-popup";
  Object.assign(box.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    zIndex: 2147483647,
    background: "rgba(20,20,20,0.85)",
    color: "#fff",
    font: "13px/1.4 monospace",
    padding: "10px 12px",
    borderRadius: "8px",
    maxWidth: "320px",
    maxHeight: "220px",
    overflowY: "auto",
    pointerEvents: "auto",
    display: "block",
    visibility: "visible",
    opacity: "1",
    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
  });
  box.textContent = "Florence-2: waiting…";
  const statusLine = document.createElement("div");
  statusLine.textContent = "Florence-2: CHANGES ACTIVE - starting pipeline";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "ON";
  toggle.title = "Stop detections";
  Object.assign(toggle.style, {
    marginTop: "8px",
    padding: "4px 10px",
    border: "1px solid rgba(255,255,255,0.5)",
    borderRadius: "4px",
    background: "#238636",
    color: "#fff",
    font: "bold 12px monospace",
    cursor: "pointer",
  });
  box.append(statusLine, toggle);
  (document.body || document.documentElement).appendChild(box);
  let lastDetectionAt = 0;

  function setStatus(status) {
    statusLine.textContent = "Florence-2: " + status;
  }

  function setToggleState(enabled) {
    toggle.textContent = enabled ? "ON" : "OFF";
    toggle.title = enabled ? "Stop detections" : "Start detections";
    toggle.style.background = enabled ? "#238636" : "#6e7681";
  }

  toggle.addEventListener("click", () => {
    const enabled = toggle.textContent !== "ON";
    setToggleState(enabled);
    setStatus(enabled ? "detections running" : "detections stopped");
    chrome.runtime.sendMessage({ type: "TOGGLE_DETECTION", enabled }).catch(() => {});
  });

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
    if (response?.status) setStatus(response.status);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "DETECTION_STATE") {
      setToggleState(msg.enabled === true);
      return;
    }
    if (msg.type === "STATUS") {
      // A late model-status message must not overwrite a result that was just
      // delivered. Keep the detected classes visible for this scan cycle.
      if (Date.now() - lastDetectionAt < 3500) return;
      setStatus(msg.status);
      return;
    }
    if (msg.type !== "DETECTIONS") return;
    const labels = msg.labels || [];
    lastDetectionAt = Date.now();
    const classNames = labels.map((item) => {
      if (typeof item === "string") return item;
      return item?.label || item?.class || item?.name || JSON.stringify(item);
    });
    setStatus(labels.length
      ? "Florence-2 DETECTED (bottom-right)\nClasses: " + classNames.join(", ")
      : "scan complete - no detections");
  });
})();

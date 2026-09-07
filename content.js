// content.js — injects a small overlay showing detected classes
(function () {
  const box = document.createElement("div");
  box.id = "florence-watcher-popup";
  Object.assign(box.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    zIndex: 2147483647,
    background: "rgba(20,20,20,0.85)",
    color: "#fff",
    font: "12px/1.4 monospace",
    padding: "8px 10px",
    borderRadius: "8px",
    maxWidth: "260px",
    maxHeight: "160px",
    overflowY: "auto",
    pointerEvents: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
  });
  box.textContent = "Florence-2: waiting…";
  box.textContent = "Florence-2: CHANGES ACTIVE - starting pipeline";
  document.documentElement.appendChild(box);
  let lastDetectionAt = 0;

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
    if (response?.status) box.textContent = "Florence-2: " + response.status;
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATUS") {
      // A late model-status message must not overwrite a result that was just
      // delivered. Keep the detected classes visible for this scan cycle.
      if (Date.now() - lastDetectionAt < 3500) return;
      box.textContent = "Florence-2: " + msg.status;
      return;
    }
    if (msg.type !== "DETECTIONS") return;
    const labels = msg.labels || [];
    lastDetectionAt = Date.now();
    const classNames = labels.map((item) => {
      if (typeof item === "string") return item;
      return item?.label || item?.class || item?.name || JSON.stringify(item);
    });
    box.textContent = labels.length
      ? "Florence-2 DETECTED (bottom-right)\nClasses: " + classNames.join(", ")
      : "Florence-2: scan complete - no detections";
  });
})();

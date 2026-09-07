const button = document.getElementById("load");
const status = document.getElementById("status");
const progress = document.getElementById("progress");
const file = document.getElementById("file");
const port = chrome.runtime.connect({ name: "florence-options" });

function show(message, className = "") {
  status.textContent = message;
  status.className = className;
}

button.addEventListener("click", () => {
  button.disabled = true;
  progress.value = 0;
  file.textContent = "";
  show("Starting model load...");
  port.postMessage({ type: "LOAD_MODEL" });
});

port.onMessage.addListener((msg) => {
  if (msg.type === "MODEL_STATUS") {
    if (typeof msg.progress === "number") progress.value = Math.max(0, Math.min(100, msg.progress));
    if (msg.file) file.textContent = `File: ${msg.file}`;
    show(msg.status === "loading weights" ? `Loading weights: ${progress.value.toFixed(1)}%` : msg.status);
  }
  if (msg.type === "MODEL_RESULT") {
    button.disabled = false;
    if (msg.ok) {
      progress.value = 100;
      show("SUCCESS: Florence-2 loaded and ready for detection.", "success");
    } else {
      show(`FAILED: ${msg.error}`, "error");
    }
  }
});

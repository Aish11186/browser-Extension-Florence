// offscreen.js — runs in offscreen document (has DOM + WebGPU access)
const MODEL_ID = "onnx-community/Florence-2-base-ft"; // quantized ONNX build
const TASK = "<OD>"; // swap to "<DENSE_REGION_CAPTION>" for richer labels

let model, processor, tokenizer, ready = false;
let initPromise;
let Florence2ForConditionalGeneration, AutoProcessor, AutoTokenizer, RawImage;

function sendStatus(status, detail = {}) {
  chrome.runtime.sendMessage({ type: "MODEL_STATUS", status, ...detail }).catch(() => {});
}

async function init() {
  sendStatus("STEP 8/10: loading model (first run downloads model files)");
  try {
    sendStatus("STEP 8/10: loading Transformers.js library");
    const transformers = await import("./lib/transformers.bundle.js");
    ({ Florence2ForConditionalGeneration, AutoProcessor, AutoTokenizer, RawImage } = transformers);
    // Keep ONNX Runtime's WASM helpers inside the unpacked extension. The
    // default points at jsDelivr, which is not reliable from extension pages.
    transformers.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("lib/");
    sendStatus("STEP 8/10: Transformers.js library loaded");
    model = await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
      // Florence-2 is sensitive to using one dtype for every component.
      dtype: {
        embed_tokens: "fp16",
        vision_encoder: "fp16",
        encoder_model: "q4",
        decoder_model_merged: "q4",
      },
      device: "webgpu",
      progress_callback: (progress) => {
        sendStatus("loading weights", {
          progress: Number.isFinite(progress?.progress) ? progress.progress : 0,
          file: progress?.file || progress?.name || "model file",
          loaded: progress?.loaded,
          total: progress?.total,
        });
      },
    });
    sendStatus("STEP 8/10: model loaded; loading processor");
    processor = await AutoProcessor.from_pretrained(MODEL_ID);
    sendStatus("STEP 8/10: processor loaded; loading tokenizer");
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    ready = true;
    sendStatus("STEP 9/10: model, processor, and tokenizer ready");
    console.log("Florence-2 loaded on WebGPU");
  } catch (e) {
    sendStatus(`error: ${e?.message || e}`);
    throw e;
  }
}

function loadModel() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

async function runInference(dataUrl) {
  sendStatus("STEP 7/10: inference received; waiting for model readiness");
  await loadModel();
  sendStatus("STEP 7/10: model ready; decoding screenshot");
  const image = await RawImage.fromURL(dataUrl);

  sendStatus("STEP 7/10: screenshot decoded; constructing detection prompt");
  const prompts = processor.construct_prompts(TASK);
  const vision_inputs = await processor(image);
  const text_inputs = tokenizer(prompts);

  sendStatus("STEP 7/10: image processed; running Florence-2 generation");
  const generated_ids = await model.generate({
    ...text_inputs,
    ...vision_inputs,
    max_new_tokens: 128,
  });

  sendStatus("STEP 7/10: generation finished; decoding result");
  const generated_text = tokenizer.batch_decode(generated_ids, { skip_special_tokens: false })[0];
  const result = processor.post_process_generation(generated_text, TASK, image.size);

  // result[TASK] = { bboxes: [[x1,y1,x2,y2],...], labels: [...] }
  const labels = result?.[TASK]?.labels ?? [];
  const bboxes = result?.[TASK]?.bboxes ?? [];
  sendStatus(`STEP 9/10: detection parsed (${labels.length} objects)`);
  return labels.map((l, i) => ({ label: l, bbox: bboxes[i] }));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "LOAD_MODEL") {
    loadModel()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  if (msg.type === "PING") {
    sendResponse({ ready: true });
    return;
  }
  if (msg.type !== "INFER") return;
  runInference(msg.dataUrl)
    .then((labels) => sendResponse({ labels }))
    .catch((e) => {
      console.error(e);
      sendStatus(`ERROR during inference: ${e?.message || e}`);
      sendResponse({ labels: [] });
    });
  return true; // keep channel open for async response
});

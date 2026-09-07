"""Native Messaging host that writes Florence detection history to JSON."""

import json
import os
import struct
import sys
import tempfile
import time
from pathlib import Path


FILE_NAME = "detectionsflorence.json"


def read_message():
    length_bytes = sys.stdin.buffer.read(4)
    if not length_bytes:
        return None
    if len(length_bytes) != 4:
        raise RuntimeError("incomplete native message length")
    length = struct.unpack("<I", length_bytes)[0]
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        raise RuntimeError("incomplete native message payload")
    return json.loads(payload.decode("utf-8"))


def write_message(message):
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def output_path():
    downloads = Path.home() / "Downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    return downloads / FILE_NAME


def load_screenshots(path):
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open("r", encoding="utf-8") as stream:
        document = json.load(stream)
    screenshots = document.get("screenshots") if isinstance(document, dict) else None
    if not isinstance(screenshots, list):
        raise RuntimeError("detectionsflorence.json has an invalid format")
    return screenshots


def save_detection(message, started_at):
    path = output_path()
    screenshots = load_screenshots(path)
    screenshots.append({
        "screenshot": len(screenshots) + 1,
        "timeSeconds": round(time.time() - started_at, 3),
        "detections": message.get("detections") or [],
    })
    document = {"screenshots": screenshots}

    # Replace in the same directory so an interrupted write cannot corrupt the file.
    fd, temporary = tempfile.mkstemp(prefix="detectionsflorence-", suffix=".json", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(document, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    started_at = time.time()
    while True:
        message = read_message()
        if message is None:
            return
        request_id = message.get("requestId")
        try:
            if message.get("type") != "DETECTION":
                raise RuntimeError("unsupported native message type")
            save_detection(message, started_at)
            write_message({"ok": True, "requestId": request_id})
        except Exception as error:
            write_message({"ok": False, "requestId": request_id, "error": str(error)})


if __name__ == "__main__":
    main()

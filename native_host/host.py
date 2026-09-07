"""Native Messaging launcher for sanitisation.py."""

import json
import struct
import subprocess
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent
SCRIPT_PATH = PROJECT_DIR / "sanitisation.py"


def read_message():
    header = sys.stdin.buffer.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise RuntimeError("incomplete native message header")
    size = struct.unpack("<I", header)[0]
    payload = sys.stdin.buffer.read(size)
    if len(payload) != size:
        raise RuntimeError("incomplete native message")
    return json.loads(payload.decode("utf-8"))


def write_message(message):
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def main():
    while True:
        message = read_message()
        if message is None:
            return
        try:
            if message.get("type") != "RUN_SANITISATION":
                raise RuntimeError("unsupported native message type")
            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH)],
                cwd=PROJECT_DIR,
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or f"sanitisation.py exited with {result.returncode}")
            write_message({"ok": True, "output": result.stdout})
        except Exception as error:
            write_message({"ok": False, "error": str(error)})


if __name__ == "__main__":
    main()

import os
import re
from PIL import Image, ImageDraw

# =========================
# CONFIG
# =========================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_DIR = os.path.join(BASE_DIR, "images")          # Folder containing PNGs
COORD_FILE = os.path.join(BASE_DIR, "coordinates.txt")
OUTPUT_DIR = os.path.join(BASE_DIR, "sanitized")

os.makedirs(OUTPUT_DIR, exist_ok=True)


# =========================
# READ COORDINATES
# =========================

with open(COORD_FILE, "r") as f:
    text = f.read()

# Split into Image 1, Image 2, etc.
blocks = re.split(r"Image\s+(\d+)", text)

# blocks looks like:
# ['', '1', '\nbbox...', '2', '\nbbox...']

for i in range(1, len(blocks), 2):

    image_number = int(blocks[i])
    block = blocks[i + 1]

    # Find all bounding boxes
    bbox_matches = re.findall(
        r"bbox\s+\d+:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]",
        block
    )

    if not bbox_matches:
        print(f"No bounding boxes found for Image {image_number}")
        continue

    # =========================
    # FIND IMAGE
    # =========================

    image_path = os.path.join(
        IMAGE_DIR,
        f"{image_number}.png"
    )

    if not os.path.exists(image_path):
        print(f"Image not found: {image_path}")
        continue

    # Open image
    image = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(image)

    # =========================
    # DRAW BLACK BOXES
    # =========================

    for bbox in bbox_matches:

        x1, y1, x2, y2 = map(float, bbox)

        # Convert Florence coordinates to integer pixels
        x1 = int(round(x1))
        y1 = int(round(y1))
        x2 = int(round(x2))
        y2 = int(round(y2))

        # Clamp coordinates to image boundaries
        x1 = max(0, min(x1, image.width))
        x2 = max(0, min(x2, image.width))
        y1 = max(0, min(y1, image.height))
        y2 = max(0, min(y2, image.height))

        # Draw solid black rectangle
        draw.rectangle(
            [x1, y1, x2, y2],
            fill="black"
        )

        print(
            f"Image {image_number}: "
            f"Black box [{x1}, {y1}, {x2}, {y2}]"
        )

    # =========================
    # SAVE SANITIZED IMAGE
    # =========================

    output_path = os.path.join(
        OUTPUT_DIR,
        f"{image_number}.png"
    )

    image.save(output_path)

    print(f"Saved → {output_path}\n")

print("Done!")

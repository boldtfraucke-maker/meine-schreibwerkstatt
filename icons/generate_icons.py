"""Erzeugt das Homescreen-Icon (Pfotenabdruck) in allen benötigten Größen.
Einmalig lokal ausgeführt, kein Teil der Laufzeit-App."""
from PIL import Image, ImageDraw
import os

PINE = (47, 75, 60, 255)      # --pine
PINE_DARK = (33, 54, 42, 255) # --pine-dark
CREAM = (243, 239, 228, 255)  # Pfotenfarbe, passend zu --bg

SIZE = 1024

def make_master(rounded=True, padding_ratio=0.0):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = int(SIZE * padding_ratio)
    box = [pad, pad, SIZE - pad, SIZE - pad]
    radius = int((SIZE - 2 * pad) * 0.22) if rounded else 0
    if rounded:
        draw.rounded_rectangle(box, radius=radius, fill=PINE)
    else:
        draw.rectangle(box, fill=PINE)

    cx, cy = SIZE * 0.5, SIZE * 0.445

    # Großes Zehenballen-Oval (Haupt-Pad), unten
    pad_w, pad_h = SIZE * 0.34, SIZE * 0.27
    pad_cy = cy + SIZE * 0.14
    draw.ellipse(
        [cx - pad_w / 2, pad_cy - pad_h / 2, cx + pad_w / 2, pad_cy + pad_h / 2],
        fill=CREAM,
    )

    # Vier Zehen-Kreise, gleichmäßiger Bogen mit klarem Abstand zueinander und zum Ballen
    toe_r = SIZE * 0.065
    toe_y = cy - SIZE * 0.10
    toe_positions = [
        (cx - SIZE * 0.235, toe_y),
        (cx - SIZE * 0.08, toe_y),
        (cx + SIZE * 0.08, toe_y),
        (cx + SIZE * 0.235, toe_y),
    ]
    for tx, ty in toe_positions:
        draw.ellipse([tx - toe_r, ty - toe_r, tx + toe_r, ty + toe_r], fill=CREAM)

    return img


def save_sized(master, size, path, background=None):
    resized = master.resize((size, size), Image.LANCZOS)
    if background is not None:
        canvas = Image.new("RGBA", (size, size), background)
        canvas.alpha_composite(resized)
        resized = canvas
    resized.save(path)


if __name__ == "__main__":
    out_dir = os.path.dirname(os.path.abspath(__file__))

    # Standard-Icon (abgerundetes Quadrat, für die meisten Zwecke)
    master = make_master(rounded=True, padding_ratio=0.0)
    for size in [512, 192]:
        save_sized(master, size, os.path.join(out_dir, f"icon-{size}.png"))

    # Maskable-Icon für Android: mehr Sicherheitsabstand zum Rand, volles Quadrat gefüllt
    maskable_master = make_master(rounded=False, padding_ratio=0.0)
    save_sized(maskable_master, 512, os.path.join(out_dir, "icon-maskable-512.png"))

    # Apple Touch Icon: kein Alpha-Kanal, eigener Hintergrund, keine Rundung (iOS rundet selbst)
    apple_master = make_master(rounded=False, padding_ratio=0.0)
    apple_rgb = Image.new("RGB", (SIZE, SIZE), PINE[:3])
    apple_rgb.paste(apple_master, (0, 0), apple_master)
    apple_rgb.resize((180, 180), Image.LANCZOS).save(os.path.join(out_dir, "apple-touch-icon.png"))

    # Favicons
    favicon_master = make_master(rounded=True, padding_ratio=0.04)
    save_sized(favicon_master, 32, os.path.join(out_dir, "favicon-32.png"))
    save_sized(favicon_master, 16, os.path.join(out_dir, "favicon-16.png"))

    print("Icons erzeugt in", out_dir)

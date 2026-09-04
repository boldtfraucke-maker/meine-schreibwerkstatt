"""Erzeugt alle Icon-Größen aus der Haupt-Grafik (icon-buch-hundepfote-feder.png).
Einmalig lokal ausführen, wenn die Grafik ausgetauscht wird. Kein Teil der
Laufzeit-App."""
from PIL import Image
import os

SRC = "icon-buch-hundepfote-feder.png"
CREAM = (243, 239, 228, 255)  # passend zu manifest.json background_color #FAF8F1


def flatten_on_cream(img):
    canvas = Image.new("RGBA", img.size, CREAM)
    canvas.alpha_composite(img)
    return canvas.convert("RGB")


if __name__ == "__main__":
    out_dir = os.path.dirname(os.path.abspath(__file__))
    master = Image.open(os.path.join(out_dir, SRC)).convert("RGBA")

    # Standard-Icons: Transparenz und eingebaute abgerundete Ecken bleiben erhalten
    for size in [512, 192]:
        master.resize((size, size), Image.LANCZOS).save(
            os.path.join(out_dir, f"icon-{size}.png")
        )

    # Maskable-Icon: voller Hintergrund bis zum Rand, damit OS-Masken (z. B. Kreis)
    # keine transparenten Ecken als Löcher zeigen
    flatten_on_cream(master).save(os.path.join(out_dir, "icon-maskable-512.png"))

    # Apple Touch Icon: kein Alpha-Kanal, voller Hintergrund, iOS rundet selbst
    flatten_on_cream(master).resize((180, 180), Image.LANCZOS).save(
        os.path.join(out_dir, "apple-touch-icon.png")
    )

    # Favicons: Transparenz bleibt, nur verkleinert
    master.resize((32, 32), Image.LANCZOS).save(os.path.join(out_dir, "favicon-32.png"))
    master.resize((16, 16), Image.LANCZOS).save(os.path.join(out_dir, "favicon-16.png"))

    print("Icons erzeugt in", out_dir)

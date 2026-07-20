from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

INK = (37, 33, 27, 255)
PAPER = (246, 237, 218, 255)
RED = (166, 63, 50, 255)


def font(size, bold=False):
    candidates = [
        Path("C:/Windows/Fonts/georgiab.ttf" if bold else "C:/Windows/Fonts/georgia.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def centered_text(draw, xy, text, face, fill, spacing=0):
    if spacing <= 0:
        box = draw.textbbox((0, 0), text, font=face)
        draw.text((xy[0] - (box[2] - box[0]) / 2, xy[1] - (box[3] - box[1]) / 2 - box[1]), text, font=face, fill=fill)
        return
    widths = [draw.textlength(char, font=face) for char in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = xy[0] - total / 2
    for char, width in zip(text, widths):
        draw.text((x, xy[1]), char, font=face, fill=fill, anchor="lm")
        x += width + spacing


def ticket_mask(size=1024):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    left, right, top, bottom = 104, size - 104, 92, size - 92
    tooth = 34
    points = [(left, top + 10)]
    x = left
    high = True
    while x < right:
        points.append((min(x + tooth // 2, right), top if high else top + 19))
        points.append((min(x + tooth, right), top + 19 if high else top))
        x += tooth
        high = not high
    points.extend([(right, bottom - 10)])
    x = right
    high = True
    while x > left:
        points.append((max(x - tooth // 2, left), bottom if high else bottom - 19))
        points.append((max(x - tooth, left), bottom - 19 if high else bottom))
        x -= tooth
        high = not high
    draw.polygon(points, fill=255)
    notch = 58
    draw.ellipse((left - notch // 2, size // 2 - notch // 2, left + notch // 2, size // 2 + notch // 2), fill=0)
    draw.ellipse((right - notch // 2, size // 2 - notch // 2, right + notch // 2, size // 2 + notch // 2), fill=0)
    return mask


def make_app_icon():
    size = 1024
    mask = ticket_mask(size)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_mask = mask.filter(ImageFilter.GaussianBlur(24))
    shadow_layer = Image.new("RGBA", (size, size), (20, 16, 12, 105))
    shadow.paste(shadow_layer, (15, 25), shadow_mask)
    icon.alpha_composite(shadow)
    paper = Image.new("RGBA", (size, size), PAPER)
    icon.paste(paper, (0, 0), mask)

    draw = ImageDraw.Draw(icon)
    cx, cy = size // 2, size // 2 - 20
    draw.ellipse((cx - 225, cy - 225, cx + 225, cy + 225), outline=INK, width=28)
    draw.ellipse((cx - 191, cy - 191, cx + 191, cy + 191), outline=INK, width=9)
    centered_text(draw, (cx, cy - 6), "SS", font(236, bold=True), INK)
    draw.ellipse((cx + 174, cy - 181, cx + 224, cy - 131), fill=RED)
    draw.line((cx - 150, cy + 262, cx + 150, cy + 262), fill=RED, width=18)
    centered_text(draw, (cx, cy + 320), "STYLE STUB", font(46, bold=True), INK, spacing=10)

    icon_512 = icon.resize((512, 512), Image.Resampling.LANCZOS)
    icon_512.save(BUILD / "icon.png")
    icon_512.save(BUILD / "icon.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def make_tray_icon():
    size = 256
    tray = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tray)
    draw.ellipse((22, 22, 234, 234), fill=PAPER, outline=INK, width=18)
    draw.ellipse((42, 42, 214, 214), outline=INK, width=7)
    centered_text(draw, (128, 125), "SS", font(92, bold=True), INK)
    draw.ellipse((190, 42, 222, 74), fill=RED)
    tray.save(BUILD / "tray.png")
    tray.save(BUILD / "tray.ico", format="ICO", sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64)])


make_app_icon()
make_tray_icon()

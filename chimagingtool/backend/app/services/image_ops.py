import numpy as np, io
from PIL import Image

def percent_stretch(img, low=2, high=98):
    img = img.astype(np.float32)
    lo, hi = np.percentile(img, low), np.percentile(img, high)
    hi = max(hi, lo + 1e-6)
    out = np.clip((img - lo) / (hi - lo), 0, 1)
    return (out * 255).astype(np.uint8)

def png_bytes(rgb_u8):
    im = Image.fromarray(rgb_u8, "RGB")
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()

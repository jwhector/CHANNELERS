import fitz, os

src = r"x:\projects\CHANNELERS\docs\CHANNELERS vibes.pdf"
out = r"x:\projects\CHANNELERS\docs\_vibes_render"
os.makedirs(out, exist_ok=True)

doc = fitz.open(src)
print("pages:", doc.page_count)
for i, page in enumerate(doc):
    rect = page.rect
    zoom = min(1400 / rect.width, 2.0)
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)
    p = os.path.join(out, f"page_{i+1:02d}.png")
    pix.save(p)
    print(p, pix.width, "x", pix.height)

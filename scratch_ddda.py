import xml.etree.ElementTree as ET
import re

tree = ET.parse(r'c:\Users\lewis\Projects\makora-ide\ddda.svg')
root = tree.getroot()
paths = list(root.iter('{http://www.w3.org/2000/svg}path'))
print(f"Total paths in SVG: {len(paths)}")

# Paths 0, 1, 2, 3, 4 are the dragon body and internal details.
# Path 5 is the background rectangle inversion.
dragon_paths = paths[:5]

# Let's also find the bounding box of path 4 (the heart/chest glow)
p4_d = paths[4].get('d', '')
pts = re.findall(r'([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)', p4_d)
if pts:
    xs = [float(x) for x, y in pts]
    ys = [float(y) for x, y in pts]
    print(f"Heart/chest glow center: ({sum(xs)/len(xs):.2f}, {sum(ys)/len(ys):.2f}) (min_x={min(xs)}, max_x={max(xs)}, min_y={min(ys)}, max_y={max(ys)})")

# Build a clean SVG string containing the dragon paths
clean_svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">\n'
for i, p in enumerate(dragon_paths):
    clean_svg += f'  <path d="{p.get("d")}" fill="{p.get("fill")}" />\n'
clean_svg += '</svg>'

with open(r'C:\Users\lewis\.gemini\antigravity-ide\brain\7c8ea85b-16ce-458a-868f-f64df51183ee\scratch\ddda_clean.svg', 'w') as f:
    f.write(clean_svg)
print("Saved clean dragon SVG!")

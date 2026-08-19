import xml.etree.ElementTree as ET
import re

tree = ET.parse(r'c:\Users\lewis\Projects\makora-ide\ddda.svg')
root = tree.getroot()
paths = list(root.iter('{http://www.w3.org/2000/svg}path'))

# Let's inspect Path 5
p5_d = paths[5].get('d', '')
parts = p5_d.split('ZM')
print(f"Path 5 has {len(parts)} subpaths separated by ZM")

# Part 0 is the outer 256x256 box: "M 0.00 128.00 L 0.00 0.00 L 128.00 0.00 L 256.00 0.00 L 256.00 128.00 L 256.00 256.00 L 128.00 256.00 L 0.00 256.00 L 0.00 128.00 "
# Part 1..n is the dragon cutout!
dragon_cutout_d = "M" + "ZM".join(parts[1:])
print(f"Dragon cutout d length: {len(dragon_cutout_d)}")

# Let's save this single, complete, unified dragon silhouette!
cutout_svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">\n  <path d="{dragon_cutout_d.strip()}" fill="rgb(180,40,45)" />\n</svg>'
with open(r'c:\Users\lewis\Projects\makora-ide\src\assets\ddda_full_dragon.svg', 'w') as f:
    f.write(cutout_svg)

print("Saved ddda_full_dragon.svg successfully!")

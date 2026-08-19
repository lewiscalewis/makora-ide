import matplotlib.pyplot as plt
import xml.etree.ElementTree as ET
import re

tree = ET.parse(r'c:\Users\lewis\Projects\makora-ide\src\assets\ddda_full_dragon.svg')
root = tree.getroot()
path_elem = root.find('{http://www.w3.org/2000/svg}path')
d = path_elem.get('d')

# Let's parse commands
tokens = re.findall(r'([MLCZHVSTQAmclzhvstqa])|(-?[0-9]+\.?[0-9]*)', d)
# Let's extract points
coords = re.findall(r'([0-9]+\.[0-9]+)\s*,?\s*([0-9]+\.[0-9]+)', d)
xs = [float(x) for x, y in coords]
ys = [float(y) for x, y in coords]

fig, ax = plt.subplots(figsize=(6, 6))
ax.plot(xs, ys, 'r-', linewidth=1.5)
ax.fill(xs, ys, 'maroon', alpha=0.8)
ax.set_xlim(0, 256)
ax.set_ylim(256, 0) # Inverted Y for SVG
ax.set_title("Full Dragon's Dogma Dragon Silhouette")
plt.savefig(r'C:\Users\lewis\.gemini\antigravity-ide\brain\7c8ea85b-16ce-458a-868f-f64df51183ee\scratch\dragon_preview.png')
print("Saved preview to scratch/dragon_preview.png")

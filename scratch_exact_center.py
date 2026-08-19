import xml.etree.ElementTree as ET
import re

tree = ET.parse(r'c:\Users\lewis\Projects\makora-ide\src\assets\ddda_full_dragon.svg')
root = tree.getroot()
path_elem = root.find('{http://www.w3.org/2000/svg}path')
d = path_elem.get('d')

coords = re.findall(r'([0-9]+\.[0-9]+)\s*,?\s*([0-9]+\.[0-9]+)', d)
xs = [float(x) for x, y in coords]
ys = [float(y) for x, y in coords]

min_x, max_x = min(xs), max(xs)
min_y, max_y = min(ys), max(ys)
center_x = (min_x + max_x) / 2
center_y = (min_y + max_y) / 2
print(f"BBox X: [{min_x:.2f}, {max_x:.2f}] -> Center X = {center_x:.2f}")
print(f"BBox Y: [{min_y:.2f}, {max_y:.2f}] -> Center Y = {center_y:.2f}")

# Neck/Head is at (133, 50..70)
# Chest center is around (133, 115)
# In Three.js, geometry.center() sets center_x -> 0, center_y -> 0.
# With scale.set(0.048, -0.048, 0.048):
# Chest X relative to center = (133 - center_x) * 0.048
# Chest Y relative to center = -(115 - center_y) * 0.048
rel_chest_x = (133.0 - center_x) * 0.048
rel_chest_y = -(115.0 - center_y) * 0.048
print(f"Calculated Heart relative position: X = {rel_chest_x:.3f}, Y = {rel_chest_y:.3f}")

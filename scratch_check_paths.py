import xml.etree.ElementTree as ET

tree = ET.parse(r'c:\Users\lewis\Projects\makora-ide\src\assets\ddda_clean.svg')
root = tree.getroot()
paths = list(root.iter('{http://www.w3.org/2000/svg}path'))
for i, p in enumerate(paths):
    print(f"Path {i}: fill={p.get('fill')}, len={len(p.get('d', ''))}")

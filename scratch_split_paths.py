import xml.etree.ElementTree as ET

tree = ET.parse(r'c:\Users\lewis\Projects\makora-ide\ddda.svg')
root = tree.getroot()
paths = list(root.iter('{http://www.w3.org/2000/svg}path'))

for i, p in enumerate(paths[:5]):
    single_svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">\n  <path d="{p.get("d")}" fill="{p.get("fill")}" />\n</svg>'
    with open(rf'c:\Users\lewis\Projects\makora-ide\scratch\path_{i}.svg', 'w') as f:
        f.write(single_svg)
print("Saved all 5 single path SVGs!")

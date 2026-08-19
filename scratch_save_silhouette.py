import xml.etree.ElementTree as ET

tree = ET.parse(r'c:\Users\lewis\Projects\makora-ide\ddda.svg')
root = tree.getroot()
paths = list(root.iter('{http://www.w3.org/2000/svg}path'))

# Let's create an SVG with just Path 0 (the complete continuous outer dragon silhouette)
path0_svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">\n  <path d="{paths[0].get("d")}" fill="rgb(46,17,20)" />\n</svg>'
with open(r'c:\Users\lewis\Projects\makora-ide\src\assets\ddda_silhouette.svg', 'w') as f:
    f.write(path0_svg)
print("Saved ddda_silhouette.svg")

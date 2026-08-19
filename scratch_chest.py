import matplotlib.pyplot as plt
import numpy as np

# Let's inspect the dragon chest at (130, 110)
fig, ax = plt.subplots(figsize=(6, 6))
# Load dragon preview
img = plt.imread(r'C:\Users\lewis\Projects\makora-ide\scratch\dragon_preview.png' if False else r'C:\Users\lewis\.gemini\antigravity-ide\brain\7c8ea85b-16ce-458a-868f-f64df51183ee\scratch\dragon_preview.png')
ax.imshow(img)
# Mark chest position in image coordinates (pixel coords)
# In 256x256 space: (130, 110)
plt.savefig(r'C:\Users\lewis\.gemini\antigravity-ide\brain\7c8ea85b-16ce-458a-868f-f64df51183ee\scratch\chest_check.png')
print("Position checked!")

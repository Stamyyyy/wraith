# Copyright (c) 2026 Stam. All rights reserved. See LICENSE.

import struct

sizes = [16, 24, 32, 48, 64, 128, 256]
images = []
for s in sizes:
    with open(f"icon-{s}.png", "rb") as f:
        images.append((s, f.read()))

out = bytearray()
# ICONDIR
out += struct.pack("<HHH", 0, 1, len(images))

header_size = 6
entry_size = 16
offset = header_size + entry_size * len(images)

entries = bytearray()
data = bytearray()
for s, png in images:
    w = 0 if s == 256 else s
    h = 0 if s == 256 else s
    entries += struct.pack(
        "<BBBBHHII",
        w, h,
        0,  # color count
        0,  # reserved
        1,  # planes
        32,  # bitcount
        len(png),
        offset,
    )
    data += png
    offset += len(png)

out += entries
out += data

with open("../build/icon.ico", "wb") as f:
    f.write(out)

print("wrote build/icon.ico,", len(out), "bytes,", len(images), "sizes:", sizes)

#!/usr/bin/env python3
"""pack-zip.py —— 打 Windows 绿色包。

为什么不用 macOS 自带的 zip：它对**非 ASCII 文件名不写 UTF-8 标志位**（flag bit 11），
Windows 资源管理器解出来就是乱码（实测「达观智能审核平台.exe」变成 Φ╛╛Φºé…）。
Python 的 zipfile 遇到非 ASCII 名会自动置位，Windows 11 / 10 (1903+) 都能正确显示。

用法：python3 pack-zip.py <源目录> <输出的 zip>
"""
import os
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]
if not os.path.isdir(src):
    sys.exit('源目录不存在: ' + src)
if os.path.exists(out):
    os.remove(out)

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, dirs, files in os.walk(src):
        for name in files:
            p = os.path.join(root, name)
            z.write(p, os.path.relpath(p, src))

# 自证：非 ASCII 名必须带 UTF-8 标志，否则 Windows 上就是乱码
bad = [i.filename for i in zipfile.ZipFile(out).infolist()
       if not i.flag_bits & 0x800 and any(ord(c) > 127 for c in i.filename)]
if bad:
    sys.exit('✗ 有 %d 个非 ASCII 条目没标 UTF-8：%s' % (len(bad), bad[:3]))
print('  ✓ %s（UTF-8 文件名已自证）' % os.path.basename(out))

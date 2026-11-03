#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""设计-组件更新提示-裸值扫描 —— 规格件自身的令牌闭合与裸值计数（D3 臂）。

为什么要有它：D3 要求「令牌唯一真源：裸 hex、裸 px 计数为 0（例外登记）；引用不得成环」。
本件是**规格**，不是样式表；它的风险不是"写了 CSS"，而是三件：
  ① 引用了 tokens.css 里不存在的令牌名（实现者照抄就白屏 / 落到字面值）
  ② 规范性段落里直接写死颜色或尺寸（那就成了第二真源，下一轮改令牌它不跟）
  ③ 拿 L1 原始层（--p-*）当组件取值（跨层引用，语义层形同虚设）

口径：
  · 令牌名集合只从 assets/tokens.css 解析，脚本里不维护第二份名单
  · 豁免段：§7「令牌缺口」与「附A 现状取证」—— 这两段的任务就是**记录**现有裸值，
    把它们算成违规等于要求文档撒谎；其余段落一律 0
  · 裸 hex：全篇为 0（没有豁免段）
  · 裸 px：豁免段之外为 0

用法：
  python3 设计-组件更新提示-裸值扫描-20261028.py [规格.md] [tokens.css]
退出码：0 干净 / 1 有违规 / 3 读不到文件
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = HERE if os.path.exists(os.path.join(HERE, 'assets', 'tokens.css')) else os.path.dirname(HERE)
MD = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith('.md') else os.path.join(HERE, '设计-组件更新提示-20261028.md')
TOKENS = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].endswith('.css') else os.path.join(ROOT, 'assets', 'tokens.css')

INSTANCE_ID = 'D-UPD-20261028-01'

TOKEN_REF = re.compile(r'(?<![\w-])(--[a-z][\w-]*)')
WILDCARD = re.compile(r'--[a-z][\w-]*\*')
HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
PX = re.compile(r'(?<![\w.-])(\d+(?:\.\d+)?)px\b')
H2 = re.compile(r'^## (?!#)')


def defined_tokens(path):
    src = open(path, encoding='utf-8').read()
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    return set(m.group(1) for m in re.finditer(r'(--[\w-]+)\s*:', src))


def exempt_map(lines):
    """返回每行是否处于豁免段（§7 / 附A）。"""
    flags = [False] * len(lines)
    in_exempt = False
    for i, line in enumerate(lines):
        if H2.match(line):
            head = line.strip()
            in_exempt = head.startswith('## 7') or head.startswith('## 附A')
        flags[i] = in_exempt
    return flags


def main():
    if not os.path.exists(MD):
        print('✗ 读不到规格件：' + MD)
        return 3
    if not os.path.exists(TOKENS):
        print('✗ 读不到令牌源：' + TOKENS)
        return 3

    toks = defined_tokens(TOKENS)
    text = open(MD, encoding='utf-8').read()
    lines = text.split('\n')
    exempt = exempt_map(lines)

    bad = 0
    print('组件更新提示·规格件扫描｜' + os.path.basename(MD))
    print('令牌源 ' + os.path.relpath(TOKENS, ROOT) + '｜已定义令牌 ' + str(len(toks)) + ' 个')

    # ① 令牌闭合（§7/附A 豁免：那两段写的是"候选名"与"现盘取证"，本来就不在 tokens.css 里）
    missing = []
    checked = set()
    skipped = 0
    for i, line in enumerate(lines):
        clean = WILDCARD.sub(' ', line)          # --space-* 这类通配不是令牌名
        for m in TOKEN_REF.finditer(clean):
            name = m.group(1)
            if exempt[i]:
                skipped += 1
                continue
            checked.add(name)
            if name not in toks:
                missing.append((i + 1, name, line.strip()[:60]))
    print('\n① 令牌引用闭合：规范性段落引用 ' + str(len(checked)) + ' 个不同名字，缺失 ' + str(len(missing)) + ' 个'
          + '（§7/附A 跳过 ' + str(skipped) + ' 处候选名/取证）')
    for ln, name, ctx in missing:
        print('   L%d  未定义 %s  ｜ %s' % (ln, name, ctx))
    bad += len(missing)

    # ② 跨层引用（规范性段落不许直接用 L1 --p-*）
    cross = []
    for i, line in enumerate(lines):
        if exempt[i]:
            continue
        for m in TOKEN_REF.finditer(WILDCARD.sub(' ', line)):
            name = m.group(1)
            if name.startswith('--p-'):
                cross.append((i + 1, name, line.strip()[:60]))
    print('\n② 跨层引用（规范性段落用 L1 --p-*）：' + str(len(cross)) + ' 处')
    for ln, name, ctx in cross:
        print('   L%d  %s  ｜ %s' % (ln, name, ctx))
    bad += len(cross)

    # ③ 裸 hex（全篇）
    hexes = []
    for i, line in enumerate(lines):
        for m in HEX.finditer(line):
            hexes.append((i + 1, m.group(0)))
    print('\n③ 裸 hex（全篇）：' + str(len(hexes)) + ' 处')
    for ln, h in hexes:
        print('   L%d  %s' % (ln, h))
    bad += len(hexes)

    # ④ 裸 px（豁免段之外）
    pxs = []
    for i, line in enumerate(lines):
        if exempt[i]:
            continue
        for m in PX.finditer(line):
            pxs.append((i + 1, m.group(0), line.strip()[:60]))
    print('\n④ 裸 px（§7 与 附A 之外）：' + str(len(pxs)) + ' 处')
    for ln, p, ctx in pxs:
        print('   L%d  %s  ｜ %s' % (ln, p, ctx))
    bad += len(pxs)

    # ⑤ 实例 ID 逐字
    has_id = INSTANCE_ID in text
    print('\n⑤ 实例 ID 逐字（' + INSTANCE_ID + '）：' + ('在' if has_id else '缺'))
    if not has_id:
        bad += 1

    print('\n判定：' + ('干净（0 处）' if bad == 0 else '有违规 %d 处 —— 必须为 0' % bad))
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

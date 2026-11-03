#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""设计-组件更新提示-对比度 —— 按 tokens.css 现解析值，算本轮新增元素上每一对前景/背景的对比度（D4 臂）。

为什么要有它：D4 要求「正文 4.5:1、大字 3:1、非文本与状态 3:1；computed 值不许四舍五入」。
本轮新增的每一处颜色都必须是**已有令牌**（不许新造色值），所以判定必须落在"这个令牌压在哪个底上"，
而不是落在截图取色上 —— 截图会带显示器 ICC，直读偏（见 tokens.css 头注）。

口径：
  · 值只从 assets/tokens.css 读，脚本里不写任何颜色字面量（否则就是第二个真源）
  · 半透明前景先合成到它真实所在的底，再算（WCAG 实际感知值）
  · 输出保留 2 位小数但**判定用未舍入值**
  · 只判本件新增元素用到的组合；既有欠账（白字压 --color-brand 等）不在本臂内

用法：python3 设计-组件更新提示-对比度-20261028.py [tokens.css]
退出码：0 全过 / 1 有低于阈值 / 3 读不到令牌
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = HERE if os.path.exists(os.path.join(HERE, 'assets', 'tokens.css')) else os.path.dirname(HERE)
TOKENS = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith('.css') else os.path.join(ROOT, 'assets', 'tokens.css')


def parse_tokens(path):
    src = open(path, encoding='utf-8').read()
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    out = {}
    for m in re.finditer(r'(--[\w-]+)\s*:\s*([^;]+);', src):
        out[m.group(1)] = m.group(2).strip()
    return out


def resolve(name, toks, depth=0):
    if depth > 8:
        raise ValueError('var() 引用成环：' + name)
    v = toks.get(name)
    if v is None:
        raise KeyError('令牌不存在：' + name)
    m = re.match(r'^var\((--[\w-]+)\)$', v)
    if m:
        return resolve(m.group(1), toks, depth + 1)
    return v


def parse_color(v):
    v = v.strip()
    if v.startswith('#'):
        h = v[1:]
        if len(h) == 3:
            h = ''.join(c * 2 for c in h)
        if len(h) == 8:
            a = int(h[6:8], 16) / 255
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    m = re.match(r'rgba?\(([^)]+)\)', v)
    if m:
        parts = [p.strip() for p in re.split(r'[,\s/]+', m.group(1)) if p.strip()]
        r, g, b = (float(p) for p in parts[:3])
        a = float(parts[3]) if len(parts) > 3 else 1.0
        return (r, g, b, a)
    raise ValueError('不认识的颜色写法：' + v)


def over(fg, bg):
    r, g, b, a = fg
    return (r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a), 1.0)


def lum(c):
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(fg, bg):
    la, lb = lum(fg), lum(bg)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def tok(name, toks):
    return parse_color(resolve(name, toks))


# 本轮新增元素上的每一对（前景令牌, 底令牌, 阈值, 说明）
# 阈值：正文/小字 4.5；非文本（焦点环）3
PAIRS = [
    # 卡片更新徽标 / 行内「有更新」标签（同一枚 chip，两处同值）
    ('--color-warning', '--color-warning-surface', 4.5, '徽标字 12/500 压徽标底'),
    ('--color-warning', '--surface-sunken-2', 4.5, '行内标签字（万一底色未渲染，兜底量）'),
    ('--color-warning', '--surface-page', 4.5, '徽标字压白（卡片封面最浅处）'),
    # 行内「更新」按钮（.btn 基座 + 品牌浅底）
    ('--color-brand-ink', '--color-brand-surface', 4.5, '「更新」14/500 静止'),
    ('--color-brand-ink', '--color-brand-surface-2', 4.5, '「更新」14/500 悬停'),
    # 版本对比三档
    ('--color-text-tertiary', '--surface-sunken-2', 4.5, 'v2（已装配版本）12'),
    ('--color-text-body', '--surface-sunken-2', 4.5, 'v4（最新版本）12/500'),
    # 更新后 / 确认态
    ('--color-text-secondary', '--surface-sunken-2', 4.5, '「已更新到 v4」12'),
    ('--color-text-secondary', '--surface-page', 4.5, '确认态「取消」14（行底转白）'),
    ('--color-text-body', '--surface-page', 4.5, '确认态影响句 12（行底转白）'),
    # 抽屉筛选行
    ('--color-text-tertiary', '--surface-page', 4.5, '「只看有更新的 N 个」12'),
    ('--color-brand-ink', '--surface-page', 4.5, '「显示全部」12'),
    # 焦点环（D5）：压在两种行底上
    ('--color-focus-ring', '--surface-sunken-2', 3.0, '焦点环压常态行底（非文本）'),
    ('--color-focus-ring', '--surface-page', 3.0, '焦点环压确认态行底 / 抽屉白面（非文本）'),
    # 更新中的进度条填充（非文本）
    ('--color-brand', '--surface-sunken-2', 3.0, '进度条填充压行底（非文本）'),
]

# 只报不判（INFO）：用于回答「这个底色形状看不看得出来」，不构成 WCAG 阈值
INFO = [
    ('--color-warning-surface', '--surface-sunken-2', '徽标底 vs 常态行底（形状可见度）'),
    ('--color-warning-surface', '--surface-page', '徽标底 vs 抽屉白面'),
    ('--color-warning-surface', '--p-blue-25', '徽标底 vs 封面渐变浅端'),
    ('--color-warning-surface', '--p-blue-75', '徽标底 vs 封面渐变深端'),
    ('--color-brand-surface', '--surface-sunken-2', '「更新」底 vs 行底（形状可见度）'),
    ('--color-brand-surface-2', '--surface-sunken-2', '「更新」悬停底 vs 行底'),
]


def main():
    if not os.path.exists(TOKENS):
        print('✗ 读不到 ' + TOKENS)
        return 3
    toks = parse_tokens(TOKENS)
    bad = 0
    print('组件更新提示·对比度｜令牌源 ' + os.path.relpath(TOKENS, ROOT))
    print(f"{'令牌对':52s}{'实测':>8s}{'阈值':>7s}  判定")
    for fg_name, bg_name, need, note in PAIRS:
        bg = tok(bg_name, toks)
        if bg[3] < 1:
            bg = over(bg, tok('--surface-page', toks))
        fg = over(tok(fg_name, toks), bg)
        r = ratio(fg, bg)
        ok = r >= need
        if not ok:
            bad += 1
        label = fg_name + ' on ' + bg_name + '（' + note + '）'
        print(f'{label:52s}{r:8.2f}{need:7.1f}  {"PASS" if ok else "FAIL"}')
    print()
    print('INFO（只报不判：底色形状可见度，不构成 WCAG 阈值）')
    for fg_name, bg_name, note in INFO:
        bg = tok(bg_name, toks)
        fg = tok(fg_name, toks)
        if fg[3] < 1:
            fg = over(fg, bg)
        r = ratio(fg, bg)
        print(f'  {fg_name} / {bg_name}：{r:.2f}  {note}')
    print()
    print('判定：' + ('全过' if bad == 0 else f'{bad} 对低于阈值'))
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""设计-组件卡-对比度 —— 按 tokens.css 现解析值，算组件卡上每一对前景/背景的对比度（D4 臂）。

为什么要有它：D4 要求「正文 4.5:1、大字 3:1、非文本与状态 3:1；computed 值不许四舍五入」。
组件卡的颜色全部来自令牌，令牌本身带 rgba（半透明），靠眼睛/靠截图取色都会偏 ——
必须**从 tokens.css 解析 → 解 var() 别名 → 把 rgba 合成到它真实所在的底 → 再算**。

口径：
  · 值只从 assets/tokens.css 读，脚本里不写任何颜色字面量（否则就是第二个真源）
  · 半透明前景按"合成到它的底"算（WCAG 的实际感知值）
  · 输出保留 2 位小数但**判定用未舍入值**（四舍五入到 4.50 可能实际是 4.496）

用法：python3 设计-组件卡-对比度-20261028.py [tokens.css]
退出码：0 全过 / 1 有低于阈值 / 3 读不到令牌
"""
import re
import sys
import os

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
    """把 fg（可半透明）合成到不透明 bg 上"""
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


# 组件卡上的每一对（前景令牌, 底令牌, 阈值, 说明）
# 阈值：正文/小字 4.5；非文本（图标、点、焦点环）3
PAIRS = [
    ('--ink-0', '--bg', 4.5, '卡标题 20/600'),
    ('--ink-2', '--bg', 4.5, '卡描述 14/400'),
    ('--ink-3', '--bg', 4.5, '元信息 12/400'),
    ('--ink-2', '--sub-2', 4.5, '禁用态开关字（压在开关底上）'),
    ('--ok-on-tint', '--ok-bg', 4.5, '启用态开关字（压在开关底上）'),
    ('--warn', '--warn-bg', 4.5, '未发布态开关字（压在开关底上）'),
    ('--ink-3', '--canvas', 4.5, '空态说明压在画布上'),
    ('--brand-ink', '--bg', 4.5, '「配置」静止态'),
    ('--brand-ink', '--brand-bg', 4.5, '「配置」悬停态'),
    ('--brand-ink', '--brand-bg-2', 4.5, '「配置」按下态'),
    ('--ink', '--sub-2', 3.0, '⋮ 悬停底（非文本图标）'),
    ('--focus-ring', '--bg', 3.0, '焦点环（WCAG 1.4.11）'),
    ('--c-page', '--bg', 3.0, '类型点 页面类'),
    ('--c-cap', '--bg', 3.0, '类型点 能力类'),
    ('--c-data', '--bg', 3.0, '类型点 数据类'),
    ('--c-cfg', '--bg', 3.0, '类型点 配置类'),
    ('--c-slate', '--bg', 3.0, '类型点 未分类'),
]


def main():
    if not os.path.exists(TOKENS):
        print('✗ 读不到 ' + TOKENS)
        return 3
    toks = parse_tokens(TOKENS)
    bad = 0
    print('组件卡对比度｜令牌源 ' + os.path.relpath(TOKENS, ROOT))
    print(f"{'令牌对':46s}{'实测':>8s}{'阈值':>7s}  判定")
    for fg_name, bg_name, need, note in PAIRS:
        bg = tok(bg_name, toks)
        if bg[3] < 1:
            bg = over(bg, parse_color(resolve('--bg', toks)))
        fg = over(tok(fg_name, toks), bg)
        r = ratio(fg, bg)
        ok = r >= need
        if not ok:
            bad += 1
        label = fg_name + ' on ' + bg_name + '（' + note + '）'
        print(f'{label:46s}{r:8.2f}{need:7.1f}  {"PASS" if ok else "FAIL"}')
    print()
    print('判定：' + ('全过' if bad == 0 else f'{bad} 对低于阈值'))
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

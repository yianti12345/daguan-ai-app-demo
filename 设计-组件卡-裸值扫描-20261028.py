#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""设计-组件卡-裸值扫描 —— 组件卡规则集里的**裸 hex / 裸 px** 计数（D3 臂）。

为什么要有它：D3 要求「令牌唯一真源，裸 hex、裸 px 计数为 0」。
组件卡的规则散在两处（assets/sys.css 的 .page-components 段、components.html 的页内 <style>），
没有一条命令在数它们 —— 改一轮风格就多出十几个 16px/38px，没人发现，下一轮再改一遍就是第三份值。

口径（刻意窄，只判组件卡）：
  · 文件：assets/sys.css、components.html
  · 只算**选择器命中组件卡**的规则（SELECTORS 里列出的），.kcard 应用卡一律不算
  · 裸 hex：#rgb / #rrggbb / #rrggbbaa
  · 裸 px：声明里出现的数字 + px（0px 也算 —— 它同样是"没用令牌"的写法）
  · 例外白名单：EXCEPT 里逐条登记（每条必须写明为什么必须字面），命中即扣除并打印

用法：
  python3 设计-组件卡-裸值扫描-20261028.py            # 闸：有裸值 rc=1
  python3 设计-组件卡-裸值扫描-20261028.py --report   # 只报告，恒 rc=0（改前读数用）
退出码：0 干净 / 1 有裸值 / 3 读不到源文件
"""
import re
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = HERE if os.path.exists(os.path.join(HERE, 'assets', 'sys.css')) else os.path.dirname(HERE)

FILES = ['assets/sys.css', 'components.html']

# 组件卡规则集的选择器特征（命中任一即纳入扫描）
SELECTORS = [
    '.crow', '.ccard', '.cc-hd', '.cc-body', '.cc-sw', '.cc-ft', '.cc-meta', '.cc-dot',
    '.cl-tt', '.cl-desc', '.cl-ops', '.k-more', '.kbtn',
]
# 应用卡（.kcard 一族）不归本闸管 —— 它有自己的一套（NOBORDER / 封面尺寸）
EXCLUDE = ['.kcard', '.kc-']

# 例外：必须写成字面值的声明（键＝文件:选择器片段，值＝理由）
EXCEPT = {
    # box-shadow 里的 1px 环：0 spread 的 1px 环是"收边"，不是尺寸；
    # 目标态是把它抽成 --sh-card-ring 令牌（见规范件 §2.3），抽出后本行删除。
    'sys.css:box-shadow': '1px 收边环待抽成 --sh-card-ring（规范件 §2.3 已列）',
}

HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
PX = re.compile(r'(?<![\w.-])(\d+(?:\.\d+)?)px\b')
COMMENT = re.compile(r'/\*.*?\*/', re.S)
RULE = re.compile(r'([^{}]+)\{([^{}]*)\}')


def load(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def scan(path):
    raw = load(path)
    # 行号：先按注释替换成等长空白，保证 offset→line 不变
    text = COMMENT.sub(lambda m: re.sub(r'[^\n]', ' ', m.group(0)), raw)
    hits = []
    for m in RULE.finditer(text):
        sel = ' '.join(m.group(1).split())
        if not any(s in sel for s in SELECTORS):
            continue
        if any(x in sel for x in EXCLUDE):
            continue
        body = m.group(2)
        base = m.start(2)
        for dm in re.finditer(r'([-\w]+)\s*:\s*([^;]+);?', body):
            prop, val = dm.group(1), dm.group(2)
            off = base + dm.start()
            line = text.count('\n', 0, off) + 1
            for h in HEX.finditer(val):
                hits.append(('hex', path, line, sel, prop, h.group(0)))
            for p in PX.finditer(val):
                hits.append(('px', path, line, sel, prop, p.group(0)))
    return hits


def main():
    report = '--report' in sys.argv
    all_hits = []
    missing = []
    for rel in FILES:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            missing.append(rel)
            continue
        all_hits.extend(scan(p))
    if missing:
        print('✗ 读不到：' + '、'.join(missing))
        return 3

    ex_name = [k for k in EXCEPT]
    kept = []
    for h in all_hits:
        kind, path, line, sel, prop, val = h
        why = EXCEPT.get('sys.css:' + prop) if path.endswith('sys.css') else None
        if why:
            continue
        kept.append(h)

    for kind, path, line, sel, prop, val in kept:
        print(f'  {kind:3s} {path}:{line}  {sel[:52]}  {prop}:{val}')
    print()
    print(f'组件卡规则集：裸 hex {sum(1 for h in kept if h[0]=="hex")} 处 ｜ 裸 px {sum(1 for h in kept if h[0]=="px")} 处'
          f' ｜ 登记例外 {len(all_hits)-len(kept)} 处（{", ".join(ex_name) if ex_name else "无"}）')
    n = len(kept)
    if report:
        print('模式：--report（只报告，不判）')
        return 0
    print('判定：' + ('干净（0 处）' if n == 0 else f'有裸值 {n} 处 —— 改后必须是 0'))
    return 0 if n == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""将拆字结果转为倒排索引：组件 -> 包含该组件的所有字。

用法: python3 scripts/invert_index.py [source/chaizi-all-expanded.txt]
"""

import os
import sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CIXING_DIR = os.path.join(PROJECT_DIR, 'lib', 'ChineseCixing')
sys.path.insert(0, CIXING_DIR)

from cixing import ChineseCixing

_cixing = ChineseCixing()
_stroke_cache = {}

def stroke_count(ch):
    """获取汉字笔画数，返回 (笔画数, 码点) 用于排序。"""
    if ch not in _stroke_cache:
        strokes = _cixing.get_strokes(ch)
        count = len(strokes[0]) if strokes else 99
        _stroke_cache[ch] = (count, ord(ch))
    return _stroke_cache[ch]

if len(sys.argv) > 1:
    INPUT_FILE = sys.argv[1]
else:
    INPUT_FILE = os.path.join(PROJECT_DIR, 'data', 'chaizi-all-expanded.txt')

OUTPUT_FILE = INPUT_FILE.rsplit('.', 1)[0] + '-inverted.txt'


def main():
    index = {}
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.strip().split()
            if not parts:
                continue
            char = parts[0]
            for comp in parts[1:]:
                if comp not in index:
                    index[comp] = []
                if char not in index[comp]:
                    index[comp].append(char)

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for comp in sorted(index.keys()):
            # 按笔画数排序，笔画相同则按码点排序
            chars_sorted = sorted(index[comp], key=stroke_count)
            chars = ' '.join(chars_sorted)
            f.write(comp + ' ' + chars + '\n')

    print(f"共 {len(index)} 个组件，结果文件: {OUTPUT_FILE}")


if __name__ == '__main__':
    main()

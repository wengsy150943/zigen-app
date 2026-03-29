#!/usr/bin/env python3
"""递归拆字脚本：将拆字数据递归展开，保留所有中间层级并去重。

用法: python3 scripts/recursive_decompose.py [source/chaizi-ft.txt]
"""

import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_DIR, 'data')

if len(sys.argv) > 1:
    INPUT_FILE = sys.argv[1]
else:
    INPUT_FILE = os.path.join(PROJECT_DIR, 'source', 'chaizi-ft.txt')

# 输出到 data/ 目录，文件名基于输入文件名
import re
INPUT_BASENAME = os.path.basename(INPUT_FILE)  # e.g. chaizi-ft.txt
OUTPUT_FILE = os.path.join(DATA_DIR, INPUT_BASENAME.rsplit('.', 1)[0] + '-expanded.txt')


def parse_chaizi(filepath):
    """解析拆字文件，返回 {字: [[组件1, 组件2, ...], [变体2], ...]}"""
    char_decomp = {}
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split('\t')
            char = parts[0]
            variants = []
            for variant_str in parts[1:]:
                components = variant_str.split()
                if components:
                    variants.append(components)
            if variants:
                char_decomp[char] = variants
    return char_decomp


def get_all_levels(variant, char_decomp):
    """逐层展开一个拆分变体，返回所有中间层级的字符串列表。"""
    current = list(variant)
    expanded_chars = set()
    levels = [' '.join(current)]

    while True:
        next_level = []
        changed = False
        for comp in current:
            if comp in char_decomp and comp not in expanded_chars:
                next_level.extend(char_decomp[comp][0])
                expanded_chars.add(comp)
                changed = True
            else:
                next_level.append(comp)
        if not changed:
            break
        s = ' '.join(next_level)
        if s not in levels:
            levels.append(s)
        current = next_level

    return levels


def main():
    char_decomp = parse_chaizi(INPUT_FILE)
    print(f"共读取 {len(char_decomp)} 个字的拆字数据")

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for char, variants in char_decomp.items():
            all_components = []
            seen = set()
            for variant in variants:
                for level_str in get_all_levels(variant, char_decomp):
                    for comp in level_str.split():
                        if comp not in seen:
                            seen.add(comp)
                            all_components.append(comp)
            f.write(char + ' ' + ' '.join(all_components) + '\n')

    print(f"共输出 {len(char_decomp)} 行，结果文件: {OUTPUT_FILE}")


if __name__ == '__main__':
    main()

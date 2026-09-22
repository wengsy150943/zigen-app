#!/usr/bin/env python3
"""生成网页版(web/)使用的拆字数据 decomp.js。

从 source/chaizi-jt.txt 解析出正向拆解映射 {字: [[部件, ...], [变体2, ...]]}，
输出为浏览器可直接 <script> 引入、Node 亦可 require 的 JS 文件。

用法: python3 scripts/gen_web_data.py [source/chaizi-jt.txt]
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

if len(sys.argv) > 1:
    INPUT_FILE = sys.argv[1]
else:
    INPUT_FILE = os.path.join(PROJECT_DIR, 'source', 'chaizi-jt.txt')

OUTPUT_FILE = os.path.join(PROJECT_DIR, 'web', 'data', 'decomp.js')

MAX_VARIANTS = 8      # 每字保留的拆分变体上限（控制数据体积）
MAX_COMPONENTS = 8    # 单个变体的部件上限（超出则丢弃该变体）


def parse_chaizi(filepath):
    decomp = {}
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or '\t' not in line:
                continue
            parts = line.split('\t')
            char = parts[0]
            variants = []
            for variant_str in parts[1:]:
                comps = variant_str.split()
                if 1 < len(comps) <= MAX_COMPONENTS:
                    variants.append(comps)
                if len(variants) >= MAX_VARIANTS:
                    break
            if variants:
                decomp[char] = variants
    return decomp


def main():
    decomp = parse_chaizi(INPUT_FILE)
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    body = [
        '/* 由 scripts/gen_web_data.py 从 source/chaizi-jt.txt 生成，请勿手改。',
        ' * 格式: 字 -> [[部件, ...], [变体2, ...]]',
        ' * 数据源: 漢語拆字字典 (https://github.com/kfcd/chaizi) CC BY 3.0 */',
        'var DECOMP_DATA = ' + json.dumps(decomp, ensure_ascii=False, separators=(',', ':')),
        ';',
        'if (typeof module !== "undefined" && module.exports) { module.exports = DECOMP_DATA; }',
        '',
    ]
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(body))

    print(f"共解析 {len(decomp)} 个字")
    print(f"输出: {OUTPUT_FILE} ({os.path.getsize(OUTPUT_FILE) / 1024:.0f} KB)")


if __name__ == '__main__':
    main()
#!/usr/bin/env python3
"""将倒排索引 txt 转为 JSON，供 Electron 前端使用。

用法: python3 scripts/gen_json.py
输出: all.json, jt.json, ft.json, strokes.json, data.json 到 data/ 目录
"""

import os
import json
import sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CIXING_DIR = os.path.join(PROJECT_DIR, 'lib', 'ChineseCixing')
DATA_DIR = os.path.join(PROJECT_DIR, 'data')
sys.path.insert(0, CIXING_DIR)
from cixing import ChineseCixing


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    configs = [
        ('chaizi-all-expanded-inverted.txt', 'all.json'),
        ('chaizi-ft-expanded-inverted.txt', 'ft.json'),
        ('chaizi-jt-expanded-inverted.txt', 'jt.json'),
    ]

    print("生成倒排索引 JSON ...")
    json_data = {}
    for txt_name, json_name in configs:
        input_path = os.path.join(DATA_DIR, txt_name)
        output_path = os.path.join(DATA_DIR, json_name)
        d = {}
        with open(input_path, 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split()
                if not parts: continue
                d[parts[0]] = parts[1:]
        d.pop('□', None)
        key = json_name.replace('.json', '')
        json_data[key] = d
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
        print(f"  {json_name}: {len(d)} components, {os.path.getsize(output_path) / 1024:.0f} KB")

    # 生成笔画数映射
    print("生成笔画数映射 ...")
    cixing = ChineseCixing()
    all_chars = set()
    for txt_name, _ in configs:
        with open(os.path.join(SCRIPT_DIR, txt_name), 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split()
                if parts: all_chars.add(parts[0]); all_chars.update(parts[1:])
    all_chars.discard('□')

    stroke_map = {}
    for ch in all_chars:
        s = cixing.get_strokes(ch)
        sr = s[0] if s else ''
        stroke_map[ch] = len(sr) if sr != ch else 99999

    json_data['strokes'] = stroke_map
    sp = os.path.join(DATA_DIR, 'strokes.json')
    with open(sp, 'w', encoding='utf-8') as f:
        json.dump(stroke_map, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  strokes.json: {len(stroke_map)} chars, {os.path.getsize(sp) / 1024:.0f} KB")

    # 生成合并的 data.json
    dp = os.path.join(DATA_DIR, 'data.json')
    with open(dp, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, ensure_ascii=False)
    print(f"  data.json: {os.path.getsize(dp) / 1024 / 1024:.1f} MB")
    print("完成！")


if __name__ == '__main__':
    main()

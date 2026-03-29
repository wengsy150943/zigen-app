# Spec 1: 从拆字源文件生成倒排索引表

## 概述

将汉字拆字数据（`chaizi-ft.txt` / `chaizi-jt.txt`）经过递归展开、倒排索引构建、笔画排序，最终生成可供前端检索使用的倒排索引 JSON 数据。

## 数据流

```
chaizi-ft.txt / chaizi-jt.txt     (原始拆字数据)
        │
        ▼
  recursive_decompose.py           (递归展开所有中间层级)
        │
        ▼
chaizi-*-expanded.txt              (展开后的拆字数据)
        │
        ▼
  cat jt + ft → all               (合并简体+繁体)
        │
        ▼
  invert_index.py                  (构建倒排索引，按笔画排序)
        │
        ▼
chaizi-*-expanded-inverted.txt     (倒排索引 TXT)
        │
        ▼
  gen_json.py                      (转换为 JSON)
        │
        ▼
all.json / jt.json / ft.json / strokes.json / data.json
```

## 阶段 1: 递归展开 (`recursive_decompose.py`)

### 输入

文件格式：每行 `字<TAB>拆分方式1<TAB>拆分方式2...`
- 拆分方式内部用空格分隔组件
- 一个字可以有多个拆分变体（多 TAB 分隔）
- 示例：`万<TAB>一 勹<TAB>一 刀`

### 处理逻辑

1. 解析文件，构建 `{字: [[组件列表], ...]}` 映射
2. 对每个字的每个拆分变体，逐层递归展开：
   - 遍历当前层级的每个组件
   - 如果组件本身在拆分字典中且未被展开过，则展开为子组件
   - 记录每一层级的展开结果
   - 直到没有组件可以进一步展开为止
3. 收集所有层级中出现的所有组件，去重
4. 每个字输出一行：`字 组件1 组件2 ...`（空格分隔，单行）

### 输出

文件：`chaizi-ft-expanded.txt` / `chaizi-jt-expanded.txt`

示例对比：
```
输入:  万 一 勹 / 一 刀
输出:  万 一 勹 丿 ㇆ 刀    （勹 被递归展开为 丿 ㇆）
输入:  珍 玉 人 彡 / 玉 人 彡 王 丶 丿 乀
输出:  珍 玉 人 彡 王 丶 丿 乀 一 土 十 丨
```

### 规模

- ft: 17952 个字 → 17936 行
- jt: 17952 个字 → 14563 行

## 阶段 2: 合并 (`cat`)

将简体和繁体的展开结果拼接：
```bash
cat chaizi-jt-expanded.txt chaizi-ft-expanded.txt > chaizi-all-expanded.txt
```
输出：32499 行（有少量重复字）

## 阶段 3: 构建倒排索引 (`invert_index.py`)

### 输入

`chaizi-*-expanded.txt`，格式为 `字 组件1 组件2 ...`

### 处理逻辑

1. 遍历每行，对于字后面的每个组件，将其加入该组件的倒排列表
2. 构建映射：`{组件: [字1, 字2, ...]}`
3. 去掉无效组件 `□`
4. 对每个组件下的字按**笔画数升序**排序，笔画相同则按 Unicode 码点排序
5. 笔画数通过 `ChineseCixing.get_strokes()` 获取
   - 如果笔画结果与原字相同（字不在字库中），标记为 99999 排到最后

### 输出

文件：`chaizi-*-expanded-inverted.txt`

格式：每行 `组件 字1 字2 ...`，按组件名排序

示例：
```
一 丁 七 万 丈 三 上 下 丌 不 丐 丑 丒 丏 丗 丘 丙 业 ...
口 中 史 叭 叭 叮 叱 叽 叮 叭 叫 叩 召 叭 叮 叮 叽 ...
```

### 规模

- all: 2573 个组件
- ft: 2359 个组件
- jt: 2165 个组件

## 阶段 4: 转换 JSON (`gen_json.py`)

### 输入

三个倒排索引 TXT 文件 + `ChineseCixing` 笔画库

### 处理逻辑

1. 分别读取 all/ft/jt 倒排索引 TXT，转为 `{组件: [字1, 字2, ...]}` 的 JSON
2. 扫描所有文件中出现的字，使用 `ChineseCixing.get_strokes()` 获取笔画数
   - 笔画结果与原字相同 → 标记为 99999（未知笔画数）
3. 生成 `strokes.json`：`{字: 笔画数}` 的映射
4. 生成 `data.json`：合并 all/jt/ft/strokes 为一个 JSON 文件

### 输出文件

| 文件 | 内容 | 用途 |
|------|------|------|
| `all.json` | 全部倒排索引 (2572 组件) | 全模式检索 |
| `jt.json` | 简体倒排索引 (2165 组件) | 简体模式检索 |
| `ft.json` | 繁体倒排索引 (2359 组件) | 繁体模式检索 |
| `strokes.json` | 笔画数映射 (20552 字) | 结果排序 |
| `data.json` | 上述四项合并 (5.1MB) | 前端一次性加载 |

### 依赖

- Python 3
- `ChineseCixing`（项目内 `ChineseCixing/` 目录）
- `pypinyin`（ChineseCixing 依赖）

## 一键执行

```bash
cd chaizi

# 1. 递归展开
python3 recursive_decompose.py chaizi-jt.txt
python3 recursive_decompose.py chaizi-ft.txt
cat chaizi-jt-expanded.txt chaizi-ft-expanded.txt > chaizi-all-expanded.txt

# 2. 构建倒排索引
python3 invert_index.py chaizi-all-expanded.txt
python3 invert_index.py chaizi-ft-expanded.txt
python3 invert_index.py chaizi-jt-expanded.txt

# 3. 生成 JSON
python3 gen_json.py
```

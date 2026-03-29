# 字根反查 (ZiGen)

根据汉字字根（拆字组件）反查对应汉字，支持谜材检索。

## 功能

- **单字检索**：输入字根（如 `口 木 一`），查找包含这些字根的所有汉字
- **模式切换**：全部 / 简体 / 繁体
- **偏旁点选**：按笔画/偏旁/其他分类点选字根
- **谜材检索**：导入谜材词语（成语、地名等），根据字根匹配含对应字的词语
- **谜材管理**：导入/导出/删除谜材分组，数据持久化到文件

## 技术栈

- **前端**：纯 HTML + CSS + JS（无框架）
- **桌面端**：Electron（内置 HTTP 服务，解决 file:// CORS 限制）
- **数据处理**：Python 脚本（拆字、递归展开、倒排索引、JSON 生成）

## 目录结构

```
zigen-app/
├── app/                        # Electron 应用
│   ├── package.json
│   ├── main.js                 # 主进程：HTTP 服务 + 谜材 API
│   └── index.html              # 前端页面
├── scripts/                    # Python 数据处理脚本
│   ├── recursive_decompose.py  # 递归展开拆字
│   ├── invert_index.py         # 构建倒排索引
│   └── gen_json.py             # 生成 JSON 数据
├── data/                       # 索引数据（生成产物）
│   ├── data.json               # 合并的完整数据
│   ├── all.json / jt.json / ft.json / strokes.json
│   └── chaizi-*-expanded(-inverted).txt  # 中间文件
├── caizi-data/                 # 谜材数据（JSON 文件，持久化）
├── source/                     # 源数据
│   ├── chaizi-ft.txt           # 繁体拆字数据
│   └── chaizi-jt.txt           # 简体拆字数据
├── specs/                      # 技术规范
│   ├── SPEC-build.md           # 索引生成流程
│   └── SPEC-app.md             # 应用功能规范
└── lib/ChineseCixing           # 笔画数查询库（软链接）
```

## 快速开始

### 1. 安装依赖

```bash
cd app && npm install
```

### 2. 准备数据

索引数据已预生成在 `data/` 目录。如需重新生成：

```bash
# 递归展开
python3 scripts/recursive_decompose.py source/chaizi-ft.txt
python3 scripts/recursive_decompose.py source/chaizi-jt.txt
# 合并为 all
cat data/chaizi-ft-expanded.txt data/chaizi-jt-expanded.txt | sort -u > data/chaizi-all-expanded.txt
# 构建倒排索引
python3 scripts/invert_index.py data/chaizi-ft-expanded.txt
python3 scripts/invert_index.py data/chaizi-jt-expanded.txt
python3 scripts/invert_index.py data/chaizi-all-expanded.txt
# 生成 JSON
python3 scripts/gen_json.py
```

### 3. 启动应用

```bash
cd app && npm start
```

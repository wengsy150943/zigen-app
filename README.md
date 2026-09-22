# 汉字拆字检索器

根据汉字字根（拆字组件）反查对应汉字，支持谜材检索。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能

- **单字检索**：输入字根（如 `口 木 一`），查找包含这些字根的所有汉字
- **模式切换**：全部 / 简体 / 繁体
- **偏旁点选**：按笔画/偏旁/其他分类点选字根，支持笔画数筛选
- **谜材检索**：导入谜材词语（成语、地名等），根据字根匹配含对应字的词语
- **谜材管理**：导入/导出/删除谜材分组，支持拖拽和文件选择
- **离合动画工坊**（`web/`，独立网页版）：把谜面拆字 → 合并 → 生成**透明背景的两行动画**（APNG / GIF / SVG），
  直接双击 `web/index.html` 就能用（纯 HTML/CSS/JS，无框架、无构建、无 CDN）

## 技术栈

- **桌面端**：Neutralino.js（轻量跨平台桌面框架）
- **前端**：纯 HTML + CSS + JS（无框架）
- **数据处理**：Python 脚本（拆字、递归展开、倒排索引、JSON 生成）

## 目录结构

```
zigen-app/
├── zigen-nl/                    # Neutralino 桌面应用
│   ├── neutralino.config.json   # Neutralino 配置
│   └── resources/               # 前端资源
│       ├── index.html           # 主页面
│       ├── all.json / jt.json / ft.json  # 倒排索引数据
│       ├── strokes.json         # 笔画数映射
│       └── js/neutralino.js     # Neutralino 客户端库
├── scripts/                     # Python 数据处理脚本
│   ├── recursive_decompose.py   # 递归展开拆字
│   ├── invert_index.py          # 构建倒排索引
│   ├── gen_json.py              # 生成 JSON 数据
│   └── gen_web_data.py          # 生成网页版拆字库 web/data/decomp.js
├── web/                         # 离合动画工坊（独立网页版，双击 index.html 可用）
│   ├── index.html               # 页面结构 + 样式（三步引导）
│   ├── app.js                   # 交互与状态推导
│   ├── studio.js / engine.js    # 制作流程（可 Node 测）+ 确定性时间轴
│   ├── apng.js / gif.js / svg.js# 零依赖编码器与渲染
│   ├── data/decomp.js           # 拆字库（由 scripts/gen_web_data.py 生成）
│   └── test/                    # 六套测试（Node 直跑）
├── data/                        # 索引数据（生成产物）
│   ├── data.json                # 合并的完整数据
│   ├── all.json / jt.json / ft.json / strokes.json
│   └── chaizi-*-expanded(-inverted).txt  # 中间文件
├── caizi-data/                  # 谜材数据（JSON 文件）
├── source/                      # 源数据
│   ├── chaizi-ft.txt            # 繁体拆字数据
│   └── chaizi-jt.txt            # 简体拆字数据
└── specs/                       # 技术规范
    ├── SPEC-build.md            # 索引生成流程
    └── SPEC-app.md              # 应用功能规范
```

## 快速开始

### 1. 安装 Neutralino CLI

```bash
npm install -g @neutralinojs/neu
```

### 2. 下载运行时

```bash
cd zigen-nl
neu update        # 下载 Neutralino 运行时到 bin/
```

### 3. 启动应用

```bash
cd zigen-nl
neu run
```

### 4. 打包分发

```bash
cd zigen-nl
neu build        # 产出多平台可执行文件到 dist/
```

### 重新生成索引数据

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
# 生成 JSON（同时更新 zigen-nl/resources/ 下的数据）
python3 scripts/gen_json.py
```

## 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。

## 致谢

本项目使用了以下开源资源：

- **[漢語拆字字典](https://github.com/kfcd/chaizi)** by [開放詞典](https://github.com/kfcd)  
  拆字映射表数据源，采用 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/deed.zh) 许可证

- **[ChineseCixing](https://github.com/liuhuanyong/ChineseCixing)** by [liuhuanyong](https://github.com/liuhuanyong)  
  汉字笔画数查询接口

感谢以上项目的作者和贡献者！

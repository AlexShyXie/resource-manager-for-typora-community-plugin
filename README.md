# Resource Manager（资源管理）for typora-community-plugin

[English](README.en.md) | 简体中文

将 [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) 的 `resource_manager` 插件移植到 [typora-community-plugin](https://github.com/typora-community-plugin/typora-community-plugin) 生态。功能与原版一致：

扫描 Typora **当前打开的文件夹**（挂载目录）里所有的 Markdown 和本地资源文件（图片等），给出两份清单：

1. **未被引用的资源**（多余文件）：磁盘上存在，但没有被任何 `.md` 引用（含 `images/`、`assets/` 等子目录）
2. **被引用但缺失的资源**（丢失文件）：`.md` 里引用了，本地文件不存在

支持的操作：图片预览开关、在资源管理器中定位文件、删除（进回收站）、导出 JSON 报告。

## 安装（手动）

1. 关闭 Typora
2. 将整个 `resource-manager` 文件夹复制到：
   - 全局：`C:\Users\<你>\.typora\community-plugins\plugins\resource-manager\`
   - 或仅当前笔记库：`<笔记库>\.typora\plugins\resource-manager\`
3. 打开 Typora → 设置（文件 → 偏好设置 → 插件/社区插件）→ **已安装插件** → 勾选 `Resource Manager` 启用

> 需要 typora-community-plugin ≥ 2.8.2、Typora ≥ 1.5.0。

## 使用

- 命令面板（`F1`）→ `Scan mounted folder for unused/missing resources`
- 或快捷键 `Ctrl+Alt+R`（可在 设置 → 快捷键 中修改）
- 扫描期间右下角通知显示进度；结果以弹窗展示（两个表格）
- 删除文件 = 移入系统回收站（可恢复，非永久删除），默认有二次确认（可勾选"不再提醒"）
- 底部 `导出报告` 生成 JSON 到自选位置

## 识别规则（与原版一致）

- Markdown 图片语法 `![alt](uri)` 与 HTML `<img src="...">`（均可在设置中开关）
- 网络图（`http/https/ftp`）与内嵌图（`data:`、`blob:`）不参与本地存在性检测
- `uri` 中的 `<>` 包裹、URL 百分号编码（如 `%20` 空格）、`?query` 后缀会被解码/剥离后解析
- 以 `/` 或 `\` 开头的引用按**相对 md 所在目录**解析（Typora 的 root-relative 语义，与原版一致）
- 同名引用按**大小写不敏感**匹配（Windows 文件系统行为）

## 设置项

设置 → 已安装插件 → Resource Manager：

| 项 | 说明 | 默认值 |
| --- | --- | --- |
| 资源扩展名 | 参与扫描的资源文件扩展名（空格/逗号分隔） | `jpg jpeg png gif svg bmp webp ico tiff jfif avif` |
| Markdown 扩展名 | 被解析的文档扩展名 | `md markdown mdown mmd rmarkdown mkd mdwn mdtxt rmd mdtext` |
| 忽略的目录名 | 遍历时跳过的目录（按目录名） | `.git .idea node_modules .typora` |
| Markdown / HTML 语法开关 | 图片语法识别范围 | 均开启 |

## 与 obgnail 原版的差异

| 原版 | 本移植版 | 原因 |
| --- | --- | --- |
| `fs.remove` 永久删除 | `fs.trash` 移入回收站 | 更安全；core 的跨平台回收站 API |
| 引用比较大小写敏感 | 大小写不敏感 | Windows 下 `IMG.png`/`img.png` 是同一文件，避免误报"缺失" |
| 引用 vault 外绝对路径直接判缺失 | 先 `fs.exists` 复核再判定 | 减少误报 |
| 资源扩展名默认含空扩展名、`.gif!large`、音视频 | 默认纯图片格式 | 更保守；需要时可在设置中自行添加 |
| 导出 json / yaml / toml | 仅 JSON | 单文件零依赖，砍掉 YAML/TOML 序列化器 |
| 支持与 `asset_root_redirect` 插件联动（front matter `typora-root-url`） | 不支持 | tcp 生态无对应插件 |
| fast-table 支持列排序 | 无排序 | 表格为自绘 DOM，保持可审计的体量 |

## 安全边界（实现上的自我约束）

- **零后台组件**：无监听进程、无定时器、无文件监视；只在你触发命令时才读目录
- **只读扫描**：扫描本身不写任何文件；删除走回收站且需确认；导出需手动选路径
- 单文件 `main.js`（约 760 行，无依赖、无打包混淆），可直接审计
- 不跟随符号链接（防目录环），遍历深度上限 40，扫描超时 180 秒（超时自动中止并提示）

## 文件结构

```
resource-manager/
├── manifest.json   # 插件元数据
├── main.js         # 全部逻辑（ES Module，从 core 全局对象取 API）
├── style.css       # 弹窗与表格样式
└── README.md       # 本文件
```

移植来源：obgnail/typora_plugin（MIT License）。图片提取正则来自该仓库（注释注明）。

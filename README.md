# Resource Manager for typora-community-plugin

[English](README.en.md) | 简体中文

将 [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) 的 `resource_manager` 插件移植到 [typora-community-plugin](https://github.com/typora-community-plugin/typora-community-plugin) 生态。功能与原版一致：

## 功能概览

基于 Typora **当前打开的文件夹**（挂载目录）工作，提供三个命令（F1 命令面板均可触发）：

- **扫描挂载文件夹**（`scan-folder`，快捷键 `Ctrl+Alt+R`）：给出两份清单
  1. **未被引用的资源**（多余文件）：磁盘上存在，但没有被任何 Markdown 文档引用
  2. **被引用但缺失的资源**（丢失文件）：文档里引用了，本地文件不存在
- **列出被多篇笔记引用的资源**（`find-shared`）：被 **2 篇及以上** Markdown 引用的资源清单（同一篇笔记内重复引用只计一次），按引用笔记数降序排列，支持预览与导出 JSON。**不按文件是否存在过滤**——被多篇引用但磁盘缺失的条目同样列出，路径后附"缺失"徽章（文字色跟随主题，浅色/深色主题均清晰可读；两个命令各司其职：查缺失问题用上面的扫描命令，本命令只负责引用关系；导出的 JSON 中缺失条目带 `exists: false`）
- **检查当前文件的附件引用**（`check-current`）：立足**当前打开的 md**——列出它引用的每个本地附件，标注"仅本文引用"（删除/移动/替换不影响其他笔记）或"被其他 N 篇笔记引用"（附具体清单）；引用了但磁盘缺失的附件照常列出并附"缺失"徽章。适用于改动当前笔记图片前的影响评估；导出 JSON 分 `shared` / `exclusive` 两段（当前文件必须已保存在挂载文件夹内，未保存/在库外/非 md/位于忽略目录时会给出对应提示）

扫描范围：

- **递归遍历所有子目录**，不限 `images/`、`assets/` 等特定目录；仅按目录名跳过忽略名单（默认 `.git`、`.idea`、`.typora`、`node_modules`）
- **Markdown 文档**（提取引用的来源）：默认 `md`、`markdown`、`mdown` 等 10 种扩展名
- **资源文件**（被管理的对象）：默认 `jpg`、`png`、`gif`、`svg` 等 12 种图片扩展名
- 两类扩展名均可在设置中增删（如加入 `mp3`、`mp4`）

支持的操作：图片预览开关、在资源管理器中定位文件、删除（进回收站）、导出 JSON 报告。

### 识别规则与安全边界

- Markdown 图片语法 `![alt](uri)`、HTML `<img src="...">` 与 Obsidian 风格 Wikilink `![[图片]]` / `[[图片]]`（均可在设置中开关）
- Wikilink 目标会剥离 `|别名`、`|尺寸`、`#锚点` 后缀，且**不做 URL 解码**（Wikilink 文件名可合法包含 `%`）；目标文件名含 `[` `]` 时同样可识别（Windows 合法文件名字符）
- 无扩展名的 Wikilink（如 `![[cat]]`、`![[cat|300]]`）会按已知资源扩展名在全库补全匹配，同名候选全部计为已引用；若补全不到任何资源，则视为普通笔记链接，不参与统计（避免把断链笔记灌进缺失清单）
- 未写路径的 Wikilink 按文件名在整个库内回退匹配（保守策略，避免误删）；**写了路径**的 Wikilink 按 vault 根相对（Obsidian 语义）优先解析、md 相对兜底，两者都找不到才计入缺失——路径写错不会被其他目录的同名文件掩盖
- 网络图（`http/https/ftp`）与内嵌图（`data:`、`blob:`）**不参与**本地存在性检测
- `uri` 中的 `<>` 包裹、URL 百分号编码（如 `%20` 空格）、`?query` 后缀会被解码/剥离后解析；含裸 `%` 无法解码时回退用原串解析（宁可报缺失也不误判为未引用）；`#` 既可能是 SVG 锚点（`icon.svg#part`）也可能是字面文件名，先按原串匹配扩展名，失败后再剥掉 `#` 尾部重试
- 以 `/` 或 `\` 开头的引用按**相对 md 所在目录**解析（Typora 的 root-relative 语义，与原版一致）
- 同名引用按**大小写不敏感**匹配（Windows 文件系统行为）

- **零后台组件**：无监听进程、无定时器、无文件监视；只在触发命令时才读目录
- **只读扫描**：扫描本身不写任何文件；删除走回收站且需确认；导出需手动选路径
- 不跟随符号链接（防目录环），遍历深度上限 40，扫描超时 180 秒（超时自动中止并提示）

## 安装

### 依赖前提
安装并启用 Typora Community Plugin Framework
项目地址：https://github.com/typora-community-plugin/typora-community-plugin

### 方式一：插件市场（推荐）

打开 Typora → 进入typora-community-plugin的偏好设置 → **插件市场**，搜索 `Resource Manager`，安装**并启用**。

### 方式二：手动安装

1. 从 [Releases](https://github.com/AlexShyXie/resource-manager-for-typora-community-plugin/releases) 下载最新的 `plugin.zip` 并解压
2. 将解压出的文件放入 `resource-manager` 文件夹，复制到：
   - 全局：`C:\Users\<你>\.typora\community-plugins\plugins\resource-manager\`
   - 或仅当前笔记库：`<笔记库>\.typora\plugins\resource-manager\`
3. 打开 Typora → 进入typora-community-plugin的偏好设置 → **已安装插件** → 勾选 `Resource Manager` 启用

> 需要 typora-community-plugin ≥ 2.8.2、Typora ≥ 1.5.0。

## 使用

- 命令面板（`F1`）→ `Scan mounted folder for unused/missing resources`
- 或快捷键 `Ctrl+Alt+R`（可在 设置 → 快捷键 中修改）
- 扫描期间右下角通知显示进度；结果以弹窗展示（两个表格）
- 删除文件 = 移入系统回收站（可恢复，非永久删除），默认有二次确认（可勾选"不再提醒"）
- 底部 `导出报告` 生成 JSON 到自选位置

## 设置项

设置 → 已安装插件 → Resource Manager：

| 项 | 说明 | 默认值 |
| --- | --- | --- |
| 资源扩展名 | 参与扫描的资源文件扩展名（空格/逗号分隔） | `jpg jpeg png gif svg bmp webp ico tiff jfif avif` |
| Markdown 扩展名 | 被解析的文档扩展名 | `md markdown mdown mmd rmarkdown mkd mdwn mdtxt rmd mdtext` |
| 忽略的目录名 | 遍历时跳过的目录（按目录名） | `.git .idea node_modules .typora` |
| Markdown / HTML / Wikilink 语法开关 | 图片语法识别范围 | 均开启 |

## 与 obgnail 原版的差异

| 原版 | 本移植版 | 原因 |
| --- | --- | --- |
| `fs.remove` 永久删除 | `fs.trash` 移入回收站 | 更安全；core 的跨平台回收站 API |
| 引用比较大小写敏感 | 大小写不敏感 | Windows 下 `IMG.png`/`img.png` 是同一文件，避免误报"缺失" |
| 不支持 wikilink | 支持 `![[...]]` / `[[...]]`（含无扩展名补全、basename 全库回退、带路径根相对解析） | Obsidian 迁移/混用库常见写法，不识别会导致误报"未引用"而诱导误删 |
| 资源扩展名默认含空扩展名、`.gif!large`、音视频 | 默认纯图片格式 | 更保守；需要时可在设置中自行添加 |
| 导出 json / yaml / toml | 仅 JSON | 单文件零依赖，砍掉 YAML/TOML 序列化器 |
| 支持与 `asset_root_redirect` 插件联动（front matter `typora-root-url`） | 不支持 | tcp 生态无对应插件 |
| fast-table 支持列排序 | 无排序 | 表格为自绘 DOM，保持可审计的体量 |



移植来源：obgnail/typora_plugin（MIT License）。项目仅在windows 10上进行测试使用。

/**
 * Resource Manager — port for typora-community-plugin
 *
 * Ported from obgnail/typora_plugin `plugin/resource_manager.js` (MIT).
 * Rewritten for the typora-community-plugin runtime:
 *   - window[Symbol.for("typora-plugin-core@v2")] instead of obgnail's BasePlugin
 *   - core `fs`/`path` adapters instead of fs-extra (works on win/linux/mac)
 *   - core `Modal` + hand-rolled tables instead of fast-window/fast-table
 *   - `fs.trash()` (recycle bin) instead of permanent `fs.remove()`
 *
 * Single command (command palette: F1 / Ctrl+Alt+R):
 *   scan-folder — scan the whole mounted folder (vault), exactly like
 *   the original obgnail plugin:
 *        • resources not referenced by any Markdown (unused / 多余)
 *        • references whose local file does not exist (missing / 缺失)
 */

const core = window[Symbol.for("typora-plugin-core@v2")];
const { Plugin, PluginSettings, SettingTab, I18n, Modal, Notice, fs, path } = core;

/* --------------------------------------------------------------------------
 * i18n (embedded; I18n auto-picks locale from Typora settings, falls back to en)
 * ------------------------------------------------------------------------ */
const LOCALES = {
  en: {
    pluginName: "Resource Manager",
    cmdScanFolder: "Scan mounted folder for unused/missing resources",
    titleUnused: "Resources not referenced by any Markdown",
    titleMissing: "Referenced resources missing on disk",
    colNo: "No.",
    colPreview: "Preview",
    colPath: "Path",
    colOps: "Operations",
    colRefBy: "Referenced by",
    opLocate: "Locate",
    opDelete: "Delete",
    previewOn: "Show previews",
    previewOff: "Hide previews",
    export: "Export report",
    close: "Close",
    confirmDelete: "Move this file to the recycle bin?",
    noReminder: "Do not ask again",
    deleted: "Deleted (moved to recycle bin)",
    scanEmpty: "Nothing to scan: no mounted folder",
    scanning: "Scanning… {n} files",
    allClean: "All resources are referenced and all references exist.",
    exportCancelled: "Export cancelled",
    exported: "Report saved",
    reportTitle: "Resource report",
    msgJsBridge: "This action requires Typora's JSBridge (unavailable here)",
    statScanned: "scanned {n} resources / {m} markdown files",
    emptyUnused: "No unused resources.",
    emptyMissing: "No missing references.",
    errScan: "Scan failed",
    errDelete: "Delete failed",
    settings: {
      grammarMd: { name: "Markdown image syntax", desc: "Detect `![alt](uri)`" },
      grammarHtml: { name: "HTML image syntax", desc: "Detect `<img src=\"uri\">`" },
      resourceExts: {
        name: "Resource extensions",
        desc: "Space/comma separated, with or without leading dot. Files with these extensions are treated as managed resources (images by default).",
      },
      markdownExts: {
        name: "Markdown extensions",
        desc: "Files with these extensions are parsed for references.",
      },
      ignoreFolders: {
        name: "Ignored folder names",
        desc: "Folders with these names are skipped during traversal (not nested paths).",
      },
    },
  },
  "zh-cn": {
    pluginName: "资源管理",
    cmdScanFolder: "扫描挂载文件夹（未引用/缺失资源）",
    titleUnused: "未被任何 Markdown 引用的资源（多余文件）",
    titleMissing: "被引用但在本地不存在的资源（缺失文件）",
    colNo: "#",
    colPreview: "预览",
    colPath: "路径",
    colOps: "操作",
    colRefBy: "引用来源",
    opLocate: "定位",
    opDelete: "删除",
    previewOn: "显示预览",
    previewOff: "关闭预览",
    export: "导出报告",
    close: "关闭",
    confirmDelete: "将该文件移入回收站？",
    noReminder: "不再提醒",
    deleted: "已删除（移入回收站）",
    scanEmpty: "没有可扫描的挂载文件夹",
    scanning: "扫描中… 已处理 {n} 个文件",
    allClean: "所有资源均被引用，所有引用均存在。",
    exportCancelled: "已取消导出",
    exported: "报告已保存",
    reportTitle: "资源报告",
    msgJsBridge: "此操作依赖 Typora 的 JSBridge（当前环境不可用）",
    statScanned: "共扫描 {n} 个资源 / {m} 个 Markdown 文件",
    emptyUnused: "没有未引用的资源。",
    emptyMissing: "没有缺失的引用。",
    errScan: "扫描失败",
    errDelete: "删除失败",
    settings: {
      grammarMd: { name: "Markdown 图片语法", desc: "识别 `![alt](uri)`" },
      grammarHtml: { name: "HTML 图片语法", desc: "识别 `<img src=\"uri\">`" },
      resourceExts: {
        name: "资源扩展名",
        desc: "空格或逗号分隔，是否带点均可。这些扩展名的文件视为被管理的资源（默认为常见图片格式，可自行加入 mp3/mp4 等）。",
      },
      markdownExts: {
        name: "Markdown 扩展名",
        desc: "这些扩展名的文件会被解析以提取引用。",
      },
      ignoreFolders: {
        name: "忽略的目录名",
        desc: "遍历时跳过这些名字的目录（按目录名匹配，不是路径）。",
      },
    },
  },
};
// alias so locale "zh" (some Typora builds report "zh", not "zh-cn") also matches
LOCALES["zh"] = LOCALES["zh-cn"];

/* defaults aligned with obgnail/typora_plugin settings.default.toml
 * (minus the empty-string extension and `.gif!large` corner cases;
 * audio/video extensions left out — add them in settings if needed) */
const DEFAULT_SETTINGS = {
  findMarkdownImages: true,
  findHtmlImages: true,
  resourceExts: ".jpg .jpeg .png .gif .svg .tiff .ico .webp .bmp .jfif .avif",
  markdownExts: ".md .markdown .mdown .mmd .rmarkdown .mkd .mdwn .mdtxt .rmd .mdtext",
  ignoreFolders: ".git .idea .typora node_modules",
};

const SCAN_TIMEOUT_MS = 180000; // same as upstream TIMEOUT
const MAX_DEPTH = 40; // hard safety net against symlink loops

/* --------------------------------------------------------------------------
 * small utils
 * ------------------------------------------------------------------------ */
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

/** unified comparison key: forward slashes + lower case
 *  (Windows FS is case-insensitive; MD references often mistype the case) */
const normKey = (p) => p.replace(/\\/g, "/").toLowerCase();

/** node path.resolve(base, rel) replacement built on core `path` */
const resolvePath = (baseDir, p) => (path.isAbsolute(p) ? p : path.join(baseDir, p));

/** file:// URL for <img src>; # and ? must be encoded (encodeURI leaves them) */
const toFileURL = (p) =>
  "file://" +
  encodeURI(p.replace(/\\/g, "/")).replace(/#/g, "%23").replace(/\?/g, "%3F");

const jsBridge = () => (typeof JSBridge !== "undefined" ? JSBridge : null);

const showInFinder = (p) => {
  // Typora renderer native API (same call as obgnail's utils.showInFinder)
  const bridge = jsBridge();
  if (bridge && typeof bridge.showInFinder === "function") {
    bridge.showInFinder(p);
  } else {
    console.warn("[resource-manager] JSBridge.showInFinder unavailable");
  }
};

/* --------------------------------------------------------------------------
 * image extraction — regexes ported verbatim from obgnail (they originate
 * from Typora's own File.editor.brush rules, see upstream comment)
 * ------------------------------------------------------------------------ */
// eslint-disable-next-line no-control-regex
const MD_IMG_REGEX = /(\!\[((?:\[[^\]]*\]|[^\[\]])*)\]\()(<?((?:\([^)]*\)|[^()])*?)>?[ \t]*((['"])((?:.|\n)*?)\6[ \t]*)?)(\)(?:\s*{([^{}\(\)]*)})?)/g;
const HTML_IMG_REGEX = /<img\s+[^>\n]*?src=(["'])([^"'\n]+)\1[^>\n]*>/gi;

const isNetworkUri = (uri) => /^(https?|ftp):\/\//.test(uri);
const isSpecialUri = (uri) => /^(blob|chrome-blob|moz-blob|data):[^/]/.test(uri);

function extractImageUris(text, { markdown, html }) {
  const uris = [];
  if (markdown) {
    for (const m of text.matchAll(MD_IMG_REGEX)) uris.push(m[4]);
  }
  if (html) {
    for (const m of text.matchAll(HTML_IMG_REGEX)) uris.push(m[2]);
  }
  return uris;
}

/** strip <>, url-decode, drop ?query, drop leading / or \ (same as upstream) */
function normalizeImageUri(uri) {
  try {
    uri = uri.replace(/^\s*<\s*/, "").replace(/\s*>\s*$/, "");
    uri = decodeURIComponent(uri).split("?")[0];
    return uri.replace(/^\s*([\\/])/, "");
  } catch (e) {
    console.warn("[resource-manager] bad image uri:", uri, e);
    return null;
  }
}

/* --------------------------------------------------------------------------
 * walker (replaces obgnail utils.walkDir: BFS, serial, no symlink chase)
 * ------------------------------------------------------------------------ */
async function walkDir(root, { ignoreFolders, onFile }) {
  const ignore = new Set(ignoreFolders);
  let scanned = 0;
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > MAX_DEPTH) continue;
    let names;
    try {
      names = await fs.list(dir);
    } catch (e) {
      console.warn("[resource-manager] cannot list dir:", dir, e);
      continue;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let isDir;
      try {
        isDir = await fs.isDirectory(full);
      } catch (e) {
        continue;
      }
      if (isDir) {
        if (!ignore.has(name)) queue.push({ dir: full, depth: depth + 1 });
      } else {
        scanned++;
        await onFile(full, name);
      }
    }
  }
  return scanned;
}

/* --------------------------------------------------------------------------
 * scanner
 * ------------------------------------------------------------------------ */
class ResourceScanner {
  constructor(settings) {
    this.settings = settings;
  }

  _extSet(key) {
    const raw = String(this.settings.get(key) || "");
    return new Set(
      raw.split(/[\s,]+/)
        .filter(Boolean)
        .map((e) => (e.startsWith(".") ? e.toLowerCase() : "." + e.toLowerCase()))
    );
  }

  _folderSet() {
    const raw = String(this.settings.get("ignoreFolders") || "");
    return raw.split(/[\s,]+/).filter(Boolean);
  }

  _grammarFlags() {
    return {
      markdown: !!this.settings.get("findMarkdownImages"),
      html: !!this.settings.get("findHtmlImages"),
    };
  }

  async _referencedImages(mdPath, resourceExts) {
    let text;
    try {
      text = await fs.readText(mdPath);
    } catch (e) {
      console.warn("[resource-manager] cannot read:", mdPath, e);
      return [];
    }
    const flags = this._grammarFlags();
    const mdDir = path.dirname(mdPath);
    const uris = extractImageUris(text, flags);
    const resolved = [];
    for (const uri of uris) {
      const img = normalizeImageUri(uri);
      if (!img || isNetworkUri(img) || isSpecialUri(img)) continue;
      if (!resourceExts.has(path.extname(img).toLowerCase())) continue;
      resolved.push(resolvePath(mdDir, img));
    }
    return resolved;
  }

  /**
   * @param {string} root          scan root = mounted folder (vault path)
   * @param {function} onProgress  optional (count) => void
   * @returns {unused: string[], missing: {path, refs: string[]}[], stats: {}}
   */
  async scan(root, onProgress) {
    const resourceExts = this._extSet("resourceExts");
    const markdownExts = this._extSet("markdownExts");
    const ignoreFolders = this._folderSet();

    const inFolder = new Map(); // normKey -> original path (case-insensitive compare)
    const mdFiles = [];

    await walkDir(root, {
      ignoreFolders,
      onFile: (full, name) => {
        const ext = path.extname(name).toLowerCase();
        if (resourceExts.has(ext)) inFolder.set(normKey(full), full);
        else if (markdownExts.has(ext)) mdFiles.push(full);
        if (onProgress) onProgress(inFolder.size + mdFiles.length);
      },
    });

    const referenced = new Map(); // normKey -> {path, refs: string[]}
    for (const mdPath of mdFiles) {
      const images = await this._referencedImages(mdPath, resourceExts);
      for (const img of images) {
        const key = normKey(img);
        let entry = referenced.get(key);
        if (!entry) {
          entry = { path: img, refs: [] };
          referenced.set(key, entry);
        }
        entry.refs.push(mdPath);
      }
    }

    const unused = [];
    for (const [key, orig] of inFolder) {
      if (!referenced.has(key)) unused.push(orig);
    }
    const missing = [];
    for (const [key, entry] of referenced) {
      if (inFolder.has(key)) continue;
      // reference resolved outside the vault (absolute path) may still
      // exist on disk — re-check before reporting, to avoid false alarms
      let exists = false;
      try { exists = await fs.exists(entry.path); } catch (e) { /* treat as missing */ }
      if (!exists) missing.push(entry);
    }

    return {
      root,
      scope: "folder",
      unused,
      missing,
      stats: {
        resources: inFolder.size,
        markdowns: mdFiles.length,
        referenced: referenced.size,
        unused: unused.length,
        missing: missing.length,
      },
    };
  }
}

/* --------------------------------------------------------------------------
 * report modal (replaces fast-window + fast-table)
 * ------------------------------------------------------------------------ */
class ReportModal extends Modal {
  constructor(result, i18n) {
    super({ className: "typ-resource-manager" });
    this.result = result;
    this.i18n = i18n;
    this.showPreview = true;
    this.suppressConfirm = false;
    this.root = result.root;
    this._build();
  }

  _rel(p) {
    try {
      return path.relative(this.root, p) || p;
    } catch (e) {
      return p;
    }
  }

  _build() {
    // note: Modal.setHeader builds its node via core's `html` template,
    // which does NOT escape — set via textContent afterwards for safety
    this.setHeader("resource-manager");
    this.header.textContent =
      this.i18n.t.reportTitle + " — " + this._rel(this.root);
    this.setBody((body) => this._renderBody(body));
    this.setFooter((footer) => this._renderFooter(footer));
    // drop the DOM node when closed: close() only hides it
    this.onClose(() => {
      this.containerEl.remove();
      if (this._onDispose) this._onDispose();
    });
  }

  _renderBody(body) {
    body.innerHTML = "";
    body.appendChild(this._section("rm-unused", this.i18n.t.titleUnused, this.result.unused.length, (table) => {
      for (const p of this.result.unused) {
        table.appendChild(this._unusedRow(p));
      }
    }, true));
    body.appendChild(this._section("rm-missing", this.i18n.t.titleMissing, this.result.missing.length, (table) => {
      for (const item of this.result.missing) {
        table.appendChild(this._missingRow(item));
      }
    }, false));
  }

  _section(cls, title, count, fillTable, hasOps) {
    const t = this.i18n.t;
    const section = document.createElement("div");
    section.className = "rm-section " + cls;
    const h = document.createElement("div");
    h.className = "rm-section-title";
    h.innerHTML = escapeHtml(title) + ' <span class="rm-count">' + count + "</span>";
    section.appendChild(h);

    if (count === 0) {
      const empty = document.createElement("div");
      empty.className = "rm-empty";
      empty.textContent = hasOps ? t.emptyUnused : t.emptyMissing;
      section.appendChild(empty);
      return section;
    }

    const table = document.createElement("table");
    table.className = "rm-table";
    const thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th>" + escapeHtml(t.colNo) + "</th>" +
      (hasOps ? "<th>" + escapeHtml(t.colPreview) + "</th>" : "") +
      "<th>" + escapeHtml(t.colPath) + "</th>" +
      (hasOps ? "<th>" + escapeHtml(t.colOps) + "</th>" : "<th>" + escapeHtml(t.colRefBy) + "</th>") +
      "</tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    tbody.className = hasOps ? "rm-unused-rows" : "rm-missing-rows";
    fillTable(tbody);
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  _unusedRow(p) {
    const t = this.i18n.t;
    const tr = document.createElement("tr");
    const idx = document.createElement("td");
    idx.className = "rm-idx";
    const preview = document.createElement("td");
    const img = document.createElement("img");
    img.className = "rm-preview";
    img.loading = "lazy";
    img.src = toFileURL(p);
    img.alt = p;
    preview.appendChild(img);
    const fileTd = document.createElement("td");
    fileTd.className = "rm-path";
    fileTd.title = p;
    fileTd.textContent = this._rel(p);
    const ops = document.createElement("td");
    ops.className = "rm-ops";
    const mkBtn = (label, fn) => {
      const b = document.createElement("button");
      b.className = "rm-btn";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    ops.appendChild(mkBtn(t.opLocate, () => this._locate(p)));
    ops.appendChild(mkBtn(t.opDelete, () => this._delete(p, tr)));
    tr.append(idx, preview, fileTd, ops);
    return tr;
  }

  _missingRow(item) {
    const tr = document.createElement("tr");
    const idx = document.createElement("td");
    idx.className = "rm-idx";
    const fileTd = document.createElement("td");
    fileTd.className = "rm-path";
    fileTd.title = item.path;
    fileTd.textContent = this._rel(item.path);
    const refTd = document.createElement("td");
    refTd.className = "rm-ref";
    refTd.title = item.refs.join("\n");
    refTd.textContent = item.refs.map((r) => this._rel(r)).join(", ");
    tr.append(idx, fileTd, refTd);
    return tr;
  }

  _renumber() {
    this.modal.querySelectorAll(".rm-unused-rows, .rm-missing-rows").forEach((tbody) => {
      tbody.querySelectorAll("tr").forEach((tr, i) => {
        tr.querySelector(".rm-idx").textContent = i + 1;
      });
    });
  }

  _updateCounts(delta) {
    const badge = this.modal.querySelector(".rm-unused .rm-count");
    if (badge) badge.textContent = Math.max(0, parseInt(badge.textContent || "0", 10) + delta);
  }

  _renderFooter(footer) {
    const t = this.i18n.t;
    footer.innerHTML = "";

    const stat = document.createElement("span");
    stat.className = "rm-stat";
    stat.textContent = t.statScanned
      .replace("{n}", this.result.stats.resources)
      .replace("{m}", this.result.stats.markdowns);
    footer.appendChild(stat);

    const spacer = document.createElement("span");
    spacer.className = "rm-spacer";
    footer.appendChild(spacer);

    const mk = (label, fn, primary) => {
      const b = document.createElement("button");
      b.className = "rm-btn rm-btn-footer" + (primary ? " rm-btn-primary" : "");
      b.textContent = label;
      b.addEventListener("click", fn);
      footer.appendChild(b);
      return b;
    };
    this._previewBtn = mk(t.previewOn, () => this._togglePreview());
    mk(t.export, () => this._export());
    mk(t.close, () => this.close(), true);
  }

  _togglePreview() {
    this.showPreview = !this.showPreview;
    this.modal.classList.toggle("rm-no-preview", !this.showPreview);
    this._previewBtn.textContent = this.showPreview ? this.i18n.t.previewOn : this.i18n.t.previewOff;
  }

  _locate(p) {
    showInFinder(p);
  }

  async _delete(p, tr) {
    const bridge = jsBridge();
    if (!bridge) return Notice.warning(this.i18n.t.msgJsBridge);
    const t = this.i18n.t;
    if (!this.suppressConfirm) {
      let resp = { response: 0, checkboxChecked: false };
      try {
        resp = await bridge.invoke("dialog.showMessageBox", {
          type: "warning",
          title: t.pluginName,
          message: t.confirmDelete + "\n" + path.basename(p),
          buttons: [t.opDelete, t.close],
          defaultId: 0,
          cancelId: 1,
          checkboxLabel: t.noReminder,
          normalizeAccessKeys: false,
        });
      } catch (e) {
        // dialog unavailable → fall back to window.confirm
        if (!window.confirm(t.confirmDelete + "\n" + path.basename(p))) return;
        resp = { response: 0, checkboxChecked: false };
      }
      if (resp.response === 1) return;
      if (resp.checkboxChecked) this.suppressConfirm = true;
    }
    try {
      await fs.trash(p); // recycle bin, NOT permanent removal
      // keep the model in sync so a later export stays correct
      const i = this.result.unused.indexOf(p);
      if (i !== -1) this.result.unused.splice(i, 1);
      this.result.stats.unused--;
      tr.remove();
      this._renumber();
      this._updateCounts(-1);
      Notice.success(t.deleted);
    } catch (e) {
      console.error("[resource-manager] delete failed:", p, e);
      Notice.error(t.errDelete + ": " + (e && e.message ? e.message : e));
    }
  }

  async _export() {
    const bridge = jsBridge();
    const t = this.i18n.t;
    const report = {
      plugin: "resource-manager",
      generatedAt: new Date().toISOString(),
      root: this.root,
      scope: this.result.scope,
      stats: this.result.stats,
      unused: this.result.unused.slice(),
      missing: this.result.missing.map((m) => ({ path: m.path, referencedBy: m.refs.slice() })),
    };
    const defaultName = "resource-report-" + new Date().toISOString().slice(0, 10) + ".json";
    let target = path.join(this.root, defaultName);
    if (bridge) {
      try {
        const picked = await bridge.invoke("dialog.showSaveDialog", {
          title: t.export,
          defaultPath: target,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (picked.canceled || !picked.filePath) return Notice.info(t.exportCancelled, 2000);
        target = picked.filePath;
      } catch (e) {
        console.warn("[resource-manager] save dialog failed, saving next to root:", e);
      }
    }
    try {
      await fs.writeText(target, JSON.stringify(report, null, 2));
      Notice.success(t.exported + ": " + target);
    } catch (e) {
      console.error("[resource-manager] export failed:", e);
      Notice.error("Export failed: " + (e && e.message ? e.message : e));
    }
  }

  onDispose(fn) {
    this._onDispose = fn;
  }
}

/* --------------------------------------------------------------------------
 * settings tab
 * ------------------------------------------------------------------------ */
class ResourceManagerSettingTab extends SettingTab {
  constructor(plugin) {
    super();
    this.plugin = plugin;
  }

  get name() {
    return this.plugin.i18n.t.pluginName;
  }

  show() {
    const { plugin } = this;
    const t = plugin.i18n.t.settings;
    this.addSettingTitle(plugin.i18n.t.pluginName);

    this.addSetting((setting) => {
      setting.addName(t.grammarMd.name);
      setting.addDescription(t.grammarMd.desc);
      setting.addCheckbox((checkbox) => {
        checkbox.checked = !!plugin.settings.get("findMarkdownImages");
        checkbox.onclick = () => plugin.settings.set("findMarkdownImages", checkbox.checked);
      });
    });
    this.addSetting((setting) => {
      setting.addName(t.grammarHtml.name);
      setting.addDescription(t.grammarHtml.desc);
      setting.addCheckbox((checkbox) => {
        checkbox.checked = !!plugin.settings.get("findHtmlImages");
        checkbox.onclick = () => plugin.settings.set("findHtmlImages", checkbox.checked);
      });
    });
    this.addSetting((setting) => {
      setting.addName(t.resourceExts.name);
      setting.addDescription(t.resourceExts.desc);
      setting.addTextArea((input) => {
        input.value = plugin.settings.get("resourceExts") || "";
        input.onchange = () => plugin.settings.set("resourceExts", input.value.trim());
      });
    });
    this.addSetting((setting) => {
      setting.addName(t.markdownExts.name);
      setting.addDescription(t.markdownExts.desc);
      setting.addTextArea((input) => {
        input.value = plugin.settings.get("markdownExts") || "";
        input.onchange = () => plugin.settings.set("markdownExts", input.value.trim());
      });
    });
    this.addSetting((setting) => {
      setting.addName(t.ignoreFolders.name);
      setting.addDescription(t.ignoreFolders.desc);
      setting.addTextArea((input) => {
        input.value = plugin.settings.get("ignoreFolders") || "";
        input.onchange = () => plugin.settings.set("ignoreFolders", input.value.trim());
      });
    });
    super.show();
  }

  hide() {
    this.containerEl.innerHTML = "";
    super.hide();
  }
}

/* --------------------------------------------------------------------------
 * plugin entry
 * ------------------------------------------------------------------------ */
class ResourceManagerPlugin extends Plugin {
  constructor(app, manifest, config) {
    super(app, manifest, config);
    this.i18n = new I18n({ resources: LOCALES });
    this.scanner = null; // created in onload(), once settings exist
    this._modal = null;
  }

  onload() {
    this.registerSettings(new PluginSettings(this.app, this.manifest, { version: 1 }));
    this.settings.setDefault(DEFAULT_SETTINGS);
    this.scanner = new ResourceScanner(this.settings, this.i18n);

    this.registerCommand({
      id: "scan-folder",
      title: this.i18n.t.cmdScanFolder,
      scope: "editor",
      hotkey: "Ctrl+Alt+R",
      callback: () => this._startScan(this.app.vault.path),
    });

    this.registerSettingTab(new ResourceManagerSettingTab(this));
  }

  onunload() {
    if (this._modal) {
      this._modal.close();
      this._modal = null;
    }
  }

  async _startScan(root) {
    if (!root) return Notice.warning(this.i18n.t.scanEmpty);
    const t = this.i18n.t;
    const notice = Notice.info(t.scanning.replace("{n}", 0), 0);
    let lastTick = 0;
    const tick = (n) => {
      if (n - lastTick >= 200) {
        lastTick = n;
        const content = notice.containerEl.querySelector(".typ-notice__content");
        if (content) content.textContent = t.scanning.replace("{n}", n);
      }
    };
    try {
      // note: Promise.race only stops *waiting* on timeout — the losing
      // promise's eventual rejection is still absorbed by race itself,
      // so no unhandled rejection can leak from here
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), SCAN_TIMEOUT_MS)
      );
      const result = await Promise.race([this.scanner.scan(root, tick), timeout]);
      notice.close();
      if (result.stats.unused === 0 && result.stats.missing === 0) {
        Notice.success(t.allClean);
        return;
      }
      this._modal = new ReportModal(result, this.i18n);
      this._modal.onDispose(() => { if (this._modal) this._modal = null; });
      this._modal.open();
    } catch (e) {
      notice.close();
      console.error("[resource-manager] scan failed:", e);
      Notice.error(t.errScan + ": " + (e && e.message ? e.message : e));
    }
  }
}

export default ResourceManagerPlugin;

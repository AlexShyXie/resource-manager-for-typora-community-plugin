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
 * Three commands (command palette: F1):
 *   scan-folder (Ctrl+Alt+R) — scan the whole mounted folder (vault),
 *   exactly like the original obgnail plugin:
 *        • resources not referenced by any Markdown (unused / 多余)
 *        • references whose local file does not exist (missing / 缺失)
 *   find-shared — list resources referenced by two or more Markdown
 *   files, whether or not they still exist on disk (多笔记引用)
 *   check-current — for every attachment of the CURRENT md, show which
 *   other notes cite it too (当前文件附件共享分析)
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
    titleShared: "Resources referenced by multiple notes",
    cmdFindShared: "List resources referenced by multiple notes",
    noShared: "No resource is referenced by more than one note.",
    missingTag: "missing⚠️",
    cmdCheckCurrent: "Check the current file's attachments against other notes",
    titleCurShared: "Attachments also referenced by other notes",
    titleCurExclusive: "Attachments referenced only by this note",
    emptyCurShared: "No attachment is shared with other notes.",
    emptyCurExclusive: "No attachment is exclusive to this note.",
    onlyCurrent: "only this note",
    noCurrentFile: "No file is open (or it has not been saved yet).",
    noCurrentRefs: "The current file references no local resources.",
    curNotMd: "The current file is not a Markdown file.",
    curOutsideVault: "The current file is outside the mounted folder.",
    curIgnored: "The current file is inside an ignored folder.",
    curTitle: "Attachments of the current file",
    statCurrent: "{n} attachments · {s} shared · {e} only here · {m} missing",
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
    emptyShared: "No resources referenced by multiple notes.",
    errScan: "Scan failed",
    errDelete: "Delete failed",
    settings: {
      grammarMd: { name: "Markdown image syntax", desc: "Detect `![alt](uri)`" },
      grammarHtml: { name: "HTML image syntax", desc: "Detect `<img src=\"uri\">`" },
      grammarWiki: { name: "Wikilink syntax (Obsidian-style)", desc: "Detect `![[image]]` embeds and `[[image]]` references" },
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
    titleShared: "被多篇笔记引用的资源",
    cmdFindShared: "列出被多篇笔记引用的资源",
    noShared: "没有被多篇笔记同时引用的资源。",
    missingTag: "缺失⚠️",
    cmdCheckCurrent: "检查当前文件的附件是否被其他笔记引用",
    titleCurShared: "被其他笔记引用的附件",
    titleCurExclusive: "仅本文引用的附件",
    emptyCurShared: "没有附件被其他笔记引用。",
    emptyCurExclusive: "没有仅本文引用的附件。",
    onlyCurrent: "仅本文",
    noCurrentFile: "当前没有打开的文件（或文件尚未保存）。",
    noCurrentRefs: "当前文件没有引用任何本地资源。",
    curNotMd: "当前文件不是 Markdown 文件。",
    curOutsideVault: "当前文件不在挂载文件夹内。",
    curIgnored: "当前文件位于忽略目录中。",
    curTitle: "当前文件的附件引用",
    statCurrent: "{n} 个附件 · {s} 个共享 · {e} 个仅本文 · {m} 个缺失",
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
    emptyShared: "没有被多篇笔记引用的资源。",
    errScan: "扫描失败",
    errDelete: "删除失败",
    settings: {
      grammarMd: { name: "Markdown 图片语法", desc: "识别 `![alt](uri)`" },
      grammarHtml: { name: "HTML 图片语法", desc: "识别 `<img src=\"uri\">`" },
      grammarWiki: { name: "Wikilink 语法（Obsidian 风格）", desc: "识别 `![[图片]]` 嵌入与 `[[图片]]` 引用" },
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
 * audio/video extensions left out — add them in settings if needed).
 * findWikilinkImages is an addition beyond upstream. */
const DEFAULT_SETTINGS = {
  findMarkdownImages: true,
  findHtmlImages: true,
  findWikilinkImages: true,
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

/** unified comparison key: forward slashes + NFC + lower case
 *  (Windows FS is case-insensitive; MD references often mistype the case;
 *  macOS stores filenames in NFD while md text is usually NFC) */
const normKey = (p) => p.replace(/\\/g, "/").normalize("NFC").toLowerCase();

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
 * image extraction — MD/HTML regexes ported verbatim from obgnail (they
 * originate from Typora's own File.editor.brush rules, see upstream comment)
 * ------------------------------------------------------------------------ */
// eslint-disable-next-line no-control-regex
const MD_IMG_REGEX = /(\!\[((?:\[[^\]]*\]|[^\[\]])*)\]\()(<?((?:\([^)]*\)|[^()])*?)>?[ \t]*((['"])((?:.|\n)*?)\6[ \t]*)?)(\)(?:\s*{([^{}\(\)]*)})?)/g;
const HTML_IMG_REGEX = /<img\s+[^>\n]*?src=(["'])([^"'\n]+)\1[^>\n]*>/gi;
// wikilink — NOT from upstream (it has no wikilink support); add-on here.
// group 1: optional "!" (embed) / group 2: target, possibly `path|alias|300`
// NOTE: the target charset only excludes newlines. Obsidian itself forbids
// `[`/`]` in filenames, but a Typora vault's files may legitimately contain
// them (e.g. browser-saved `shot[1].png`) — excluding them here would drop
// the reference and falsely mark the file as unused (unsafe-delete
// direction). The lazy `+?` still pairs `[[a]] [[b]]` correctly.
const WIKILINK_REGEX = /(!?)\[\[([^\n]+?)\]\]/g;

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

/** wikilink targets (raw, may still contain `|alias` / `#fragment`) */
function extractWikilinkTargets(text) {
  const targets = [];
  for (const m of text.matchAll(WIKILINK_REGEX)) targets.push(m[2]);
  return targets;
}

/** strip <>, url-decode, drop ?query, drop leading / or \ (same as upstream) */
function normalizeImageUri(uri) {
  try {
    uri = uri.replace(/^\s*<\s*/, "").replace(/\s*>\s*$/, "");
    uri = decodeURIComponent(uri).split("?")[0];
    return uri.replace(/^\s*([\\/])/, "");
  } catch (e) {
    // a bare `%` in the filename breaks decodeURIComponent. Return the raw
    // (undecoded) uri instead of dropping the reference entirely: a dropped
    // reference falsely marks the file as unused (the unsafe-delete
    // direction), an unresolvable one merely reports as missing.
    console.warn("[resource-manager] undecodable image uri, using raw:", uri, e);
    return uri.split("?")[0].replace(/^\s*([\\/])/, "");
  }
}

/** wikilink target: deliberately NOT url-decoded (wikilink filenames may
 *  legitimately contain `%`, which would break decodeURIComponent);
 *  just strip the `|alias` / `|300` suffix, `#fragment` and whitespace */
function normalizeWikilinkTarget(target) {
  return target.split("|")[0].split("#")[0].trim().replace(/^\s*([\\/])/, "");
}

/* --------------------------------------------------------------------------
 * walker (replaces obgnail utils.walkDir: BFS, serial, no symlink chase)
 * ------------------------------------------------------------------------ */
async function walkDir(root, { ignoreFolders, onFile, isAborted }) {
  const ignore = new Set(ignoreFolders);
  let scanned = 0;
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    // cooperative cancellation (scan timeout), checked per directory
    if (isAborted && isAborted()) return scanned;
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
      wikilink: !!this.settings.get("findWikilinkImages"),
    };
  }

  /**
   * Extract locally-resolvable resource paths referenced by one md file.
   * @param {Map} basenameIndex  normKey(basename) -> [abs paths in vault]
   * @param {Map} inFolder       normKey(full path) -> original path (disk)
   * @param {string} root        vault root (Obsidian wikilinks are root-relative)
   */
  async _referencedImages(mdPath, resourceExts, basenameIndex, inFolder, root) {
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
      // `#` is ambiguous: an SVG fragment identifier (`icon.svg#part`) or a
      // literal filename character (Typora writes those raw). Accept the
      // raw uri when its extension matches, else retry with the `#`-tail
      // stripped — dropping the reference would falsely mark the file as
      // unused (the unsafe-delete direction).
      let eff = img;
      if (!resourceExts.has(path.extname(eff).toLowerCase())) {
        const stripped = eff.split("#")[0];
        if (stripped === eff || !resourceExts.has(path.extname(stripped).toLowerCase())) continue;
        eff = stripped;
      }
      resolved.push(resolvePath(mdDir, eff));
    }
    if (flags.wikilink) {
      for (const raw of extractWikilinkTargets(text)) {
        const target = normalizeWikilinkTarget(raw);
        if (!target || isNetworkUri(target) || isSpecialUri(target)) continue;
        if (!/[\\/]/.test(target)) {
          // ---- bare filename (no path separators) ----
          // Obsidian-style vault-wide resolution: mark EVERY same-basename
          // candidate as referenced — conservative, avoids false "unused"
          // deletions. Extension-less links (`![[cat]]`, `![[cat|300]]`)
          // are completed against every known resource extension; links
          // that complete to nothing are treated as note references and
          // skipped (they would otherwise flood the missing report).
          const base = path.basename(target);
          if (!path.extname(base)) {
            let hit = false;
            for (const e of resourceExts) {
              const cands = basenameIndex.get(normKey(base + e));
              if (cands && cands.length) {
                resolved.push(...cands);
                hit = true;
              }
            }
            if (!hit) continue;
          } else {
            if (!resourceExts.has(path.extname(base).toLowerCase())) continue;
            const cands = basenameIndex.get(normKey(base));
            if (cands && cands.length) resolved.push(...cands);
            else resolved.push(resolvePath(mdDir, target)); // no candidate → reports as missing
          }
        } else {
          // ---- typed path ----
          // Wikilinks containing a path are vault-root-relative under
          // Obsidian semantics; hand-written Typora-style ones are usually
          // md-relative. Prefer whichever exists in the vault (root first);
          // when neither exists, record the md-relative resolution so the
          // broken link reports as missing instead of being masked by an
          // unrelated same-basename file elsewhere in the vault.
          const byRoot = resolvePath(root, target);
          const byMd = resolvePath(mdDir, target);
          resolved.push(inFolder.has(normKey(byRoot)) ? byRoot : byMd);
        }
      }
    }
    return resolved;
  }

  /**
   * @param {string} root          scan root = mounted folder (vault path)
   * @param {function} onProgress  optional (count) => void
   * @param {function} isAborted   optional () => boolean — cooperative cancel (timeout)
   * @returns {{root, scope, unused, missing, shared, stats}} where shared
   *          lists {path, refs, exists} of resources cited by 2+ distinct
   *          md files regardless of on-disk existence (or null when
   *          aborted mid-scan)
   */
  async scan(root, onProgress, isAborted) {
    const resourceExts = this._extSet("resourceExts");
    const markdownExts = this._extSet("markdownExts");
    const ignoreFolders = this._folderSet();

    const inFolder = new Map(); // normKey -> original path (case-insensitive compare)
    const basenameIndex = new Map(); // normKey(basename) -> [abs paths] (wikilink fallback)
    const mdFiles = [];

    await walkDir(root, {
      ignoreFolders,
      isAborted,
      onFile: (full, name) => {
        const ext = path.extname(name).toLowerCase();
        if (resourceExts.has(ext)) {
          inFolder.set(normKey(full), full);
          const base = normKey(path.basename(name));
          let bucket = basenameIndex.get(base);
          if (!bucket) basenameIndex.set(base, (bucket = []));
          bucket.push(full);
        } else if (markdownExts.has(ext)) mdFiles.push(full);
        if (onProgress) onProgress(inFolder.size + mdFiles.length);
      },
    });

    const referenced = new Map(); // normKey -> {path, refs: string[]}
    for (const mdPath of mdFiles) {
      if (isAborted && isAborted()) return null; // timed out; the race already rejected
      const images = await this._referencedImages(mdPath, resourceExts, basenameIndex, inFolder, root);
      for (const img of images) {
        const key = normKey(img);
        let entry = referenced.get(key);
        if (!entry) {
          entry = { path: img, refs: [] };
          referenced.set(key, entry);
        }
        // the same md may cite the same image twice (md syntax + wikilink,
        // or a repeated link) — dedupe so "referenced by" stays readable
        if (!entry.refs.includes(mdPath)) entry.refs.push(mdPath);
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

    // resources referenced by 2+ DISTINCT md files — payload of the
    // find-shared command. refs are already deduped per md, so length =
    // number of distinct notes. Existence on disk is deliberately NOT a
    // filter here: find-shared reports reference RELATIONSHIPS, and a file
    // cited by two notes that is ALSO missing is exactly the kind of entry
    // worth surfacing (missing detection itself is owned by the
    // scan-folder command). Keep the on-disk casing when the file exists.
    const shared = [];
    for (const [key, entry] of referenced) {
      if (entry.refs.length > 1) {
        const disk = inFolder.get(key);
        shared.push({ path: disk || entry.path, refs: entry.refs.slice(), exists: !!disk });
      }
    }
    shared.sort((a, b) => b.refs.length - a.refs.length || String(a.path).localeCompare(String(b.path)));

    return {
      root,
      scope: "folder",
      unused,
      missing,
      shared,
      // live Map references for the current-file view (scanCurrent) —
      // internal use, never serialized by the JSON export
      references: referenced, // normKey -> {path, refs}: every resolved reference
      disk: inFolder, // normKey -> on-disk path (original casing)
      stats: {
        resources: inFolder.size,
        markdowns: mdFiles.length,
        referenced: referenced.size,
        unused: unused.length,
        missing: missing.length,
        shared: shared.length,
        sharedMissing: shared.reduce((n, s) => n + (s.exists ? 0 : 1), 0),
      },
    };
  }

  /**
   * Current-file view for the check-current command: run the full-vault
   * scan once, then slice `referenced` by the current md. Every local
   * resource the note cites lands in exactly one bucket:
   *   shared    — also cited by other notes (refs lists THOSE notes only)
   *   exclusive — cited by this note alone (refs is empty)
   * Existence on disk is reported, not filtered (missing entries carry
   * a neutral "missing" badge in the modal), consistent with the
   * find-shared semantics.
   * @param {string} mdPath path of the open md (case need not match the
   *                        walker's disk casing — compared via normKey)
   */
  async scanCurrent(root, mdPath, onProgress, isAborted) {
    const base = await this.scan(root, onProgress, isAborted);
    if (!base) return null; // aborted mid-scan
    const curKey = normKey(mdPath);
    const shared = [];
    const exclusive = [];
    for (const [key, entry] of base.references) {
      const i = entry.refs.findIndex((r) => normKey(r) === curKey);
      if (i < 0) continue;
      const others = entry.refs.filter((_, j) => j !== i);
      const disk = base.disk.get(key);
      const item = { path: disk || entry.path, refs: others, exists: !!disk };
      (others.length ? shared : exclusive).push(item);
    }
    shared.sort((a, b) => b.refs.length - a.refs.length || String(a.path).localeCompare(String(b.path)));
    exclusive.sort((a, b) => String(a.path).localeCompare(String(b.path)));
    return {
      root,
      currentFile: mdPath,
      shared,
      exclusive,
      stats: {
        resources: base.stats.resources,
        markdowns: base.stats.markdowns,
        refs: shared.length + exclusive.length,
        shared: shared.length,
        exclusive: exclusive.length,
        missing: shared.concat(exclusive).filter((s) => !s.exists).length,
      },
    };
  }
}

/* --------------------------------------------------------------------------
 * report modal (replaces fast-window + fast-table)
 * ------------------------------------------------------------------------ */
class ReportModal extends Modal {
  constructor(result, i18n, options = {}) {
    super({ className: "typ-resource-manager" });
    this.result = result;
    this.i18n = i18n;
    this.mode = options.mode || "report"; // "report" | "shared"
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
    const t = this.i18n.t;
    const headTitle = this.mode === "shared" ? t.titleShared
      : this.mode === "current" ? t.curTitle
      : t.reportTitle;
    const headTail = this.mode === "current" ? this._rel(this.result.currentFile) : this._rel(this.root);
    this.header.textContent = headTitle + " — " + headTail;
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
    if (this.mode === "current") {
      const t = this.i18n.t;
      body.appendChild(this._section("rm-cur-shared", t.titleCurShared, this.result.shared.length, (table) => {
        for (const item of this.result.shared) {
          table.appendChild(this._sharedRow(item));
        }
      }, { preview: true, ops: false, emptyKey: "emptyCurShared", tbodyCls: "rm-cur-shared-rows" }));
      body.appendChild(this._section("rm-cur-exclusive", t.titleCurExclusive, this.result.exclusive.length, (table) => {
        for (const item of this.result.exclusive) {
          table.appendChild(this._sharedRow(item, t.onlyCurrent));
        }
      }, { preview: true, ops: false, emptyKey: "emptyCurExclusive", tbodyCls: "rm-cur-exclusive-rows" }));
      return;
    }
    if (this.mode === "shared") {
      body.appendChild(this._section("rm-shared", this.i18n.t.titleShared, this.result.shared.length, (table) => {
        for (const item of this.result.shared) {
          table.appendChild(this._sharedRow(item));
        }
      }, { preview: true, ops: false, emptyKey: "emptyShared", tbodyCls: "rm-shared-rows" }));
      return;
    }
    body.appendChild(this._section("rm-unused", this.i18n.t.titleUnused, this.result.unused.length, (table) => {
      for (const p of this.result.unused) {
        table.appendChild(this._unusedRow(p));
      }
    }, { preview: true, ops: true, emptyKey: "emptyUnused", tbodyCls: "rm-unused-rows" }));
    body.appendChild(this._section("rm-missing", this.i18n.t.titleMissing, this.result.missing.length, (table) => {
      for (const item of this.result.missing) {
        table.appendChild(this._missingRow(item));
      }
    }, { preview: false, ops: false, emptyKey: "emptyMissing", tbodyCls: "rm-missing-rows" }));
  }

  _section(cls, title, count, fillTable, opts = {}) {
    const t = this.i18n.t;
    const { preview = false, ops = false, emptyKey, tbodyCls } = opts;
    const section = document.createElement("div");
    section.className = "rm-section " + cls;
    const h = document.createElement("div");
    h.className = "rm-section-title";
    h.innerHTML = escapeHtml(title) + ' <span class="rm-count">' + count + "</span>";
    section.appendChild(h);

    if (count === 0) {
      const empty = document.createElement("div");
      empty.className = "rm-empty";
      empty.textContent = emptyKey ? t[emptyKey] : ops ? t.emptyUnused : t.emptyMissing;
      section.appendChild(empty);
      return section;
    }

    const table = document.createElement("table");
    table.className = "rm-table";
    const thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th>" + escapeHtml(t.colNo) + "</th>" +
      (preview ? '<th class="rm-preview">' + escapeHtml(t.colPreview) + "</th>" : "") +
      "<th>" + escapeHtml(t.colPath) + "</th>" +
      (ops ? "<th>" + escapeHtml(t.colOps) + "</th>" : "<th>" + escapeHtml(t.colRefBy) + "</th>") +
      "</tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    tbody.className = tbodyCls || (ops ? "rm-unused-rows" : "rm-missing-rows");
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
    // th and td carry `rm-preview` so the whole column collapses under
    // .rm-no-preview (see style.css); the img itself stays classless so
    // the `.rm-preview img` rules (max-width/max-height) keep applying
    const preview = document.createElement("td");
    preview.className = "rm-preview";
    const img = document.createElement("img");
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

  _sharedRow(item, emptyRefText) {
    const t = this.i18n.t;
    const tr = document.createElement("tr");
    if (!item.exists) tr.className = "rm-row-missing";
    const idx = document.createElement("td");
    idx.className = "rm-idx";
    // same preview cell convention as unused rows (class on td, not the
    // img); a missing file has nothing to preview — show a dash instead
    // of a broken-image icon
    const preview = document.createElement("td");
    preview.className = "rm-preview";
    if (item.exists) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = toFileURL(item.path);
      img.alt = item.path;
      preview.appendChild(img);
    } else {
      preview.textContent = "—";
      preview.title = t.missingTag;
    }
    const fileTd = document.createElement("td");
    fileTd.className = "rm-path";
    fileTd.title = item.path;
    // show the distinct-note count next to the path, e.g. "cat.png  (3)";
    // rows with no other citing notes (check-current exclusive) carry no
    // count — the "only this note" text sits in the ref column instead
    fileTd.textContent = this._rel(item.path) + (item.refs.length ? "  (" + item.refs.length + ")" : "");
    if (!item.exists) {
      const tag = document.createElement("span");
      tag.className = "rm-missing-tag";
      tag.textContent = t.missingTag;
      fileTd.appendChild(tag);
    }
    const refTd = document.createElement("td");
    refTd.className = "rm-ref";
    refTd.title = item.refs.join("\n");
    refTd.textContent = item.refs.length
      ? item.refs.map((r) => this._rel(r)).join(", ")
      : (emptyRefText || "");
    tr.append(idx, preview, fileTd, refTd);
    return tr;
  }

  _renumber() {
    this.modal.querySelectorAll(".rm-unused-rows, .rm-missing-rows, .rm-shared-rows, .rm-cur-shared-rows, .rm-cur-exclusive-rows").forEach((tbody) => {
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
    const statText = this.mode === "current"
      ? t.statCurrent
          .replace("{n}", this.result.stats.refs)
          .replace("{s}", this.result.stats.shared)
          .replace("{e}", this.result.stats.exclusive)
          .replace("{m}", this.result.stats.missing)
      : t.statScanned
          .replace("{n}", this.result.stats.resources)
          .replace("{m}", this.result.stats.markdowns);
    stat.textContent = statText;
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
    // label states the ACTION the click performs (convention), not the
    // current state: previews visible → "Hide previews" / 关闭预览
    this._previewBtn = mk(this.showPreview ? t.previewOff : t.previewOn, () => this._togglePreview());
    mk(t.export, () => this._export());
    mk(t.close, () => this.close(), true);
  }

  _togglePreview() {
    this.showPreview = !this.showPreview;
    this.modal.classList.toggle("rm-no-preview", !this.showPreview);
    this._previewBtn.textContent = this.showPreview ? this.i18n.t.previewOff : this.i18n.t.previewOn;
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
    let report;
    let namePrefix;
    if (this.mode === "current") {
      report = {
        plugin: "resource-manager",
        generatedAt: new Date().toISOString(),
        root: this.root,
        currentFile: this.result.currentFile,
        scope: "current-file",
        stats: this.result.stats,
        shared: this.result.shared.map((s) => ({ path: s.path, exists: s.exists, referencedBy: s.refs.slice() })),
        exclusive: this.result.exclusive.map((s) => ({ path: s.path, exists: s.exists })),
      };
      namePrefix = "current-attachments-";
    } else if (this.mode === "shared") {
      report = {
        plugin: "resource-manager",
        generatedAt: new Date().toISOString(),
        root: this.root,
        scope: "shared-references",
        stats: {
          resources: this.result.stats.resources,
          markdowns: this.result.stats.markdowns,
          shared: this.result.shared.length,
          sharedMissing: this.result.shared.filter((s) => !s.exists).length,
          references: this.result.shared.reduce((n, s) => n + s.refs.length, 0),
        },
        shared: this.result.shared.map((s) => ({ path: s.path, exists: s.exists, referencedBy: s.refs.slice() })),
      };
      namePrefix = "shared-references-";
    } else {
      report = {
        plugin: "resource-manager",
        generatedAt: new Date().toISOString(),
        root: this.root,
        scope: this.result.scope,
        stats: this.result.stats,
        unused: this.result.unused.slice(),
        missing: this.result.missing.map((m) => ({ path: m.path, referencedBy: m.refs.slice() })),
      };
      namePrefix = "resource-report-";
    }
    const defaultName = namePrefix + new Date().toISOString().slice(0, 10) + ".json";
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
      setting.addName(t.grammarWiki.name);
      setting.addDescription(t.grammarWiki.desc);
      setting.addCheckbox((checkbox) => {
        checkbox.checked = !!plugin.settings.get("findWikilinkImages");
        checkbox.onclick = () => plugin.settings.set("findWikilinkImages", checkbox.checked);
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
    this.scanner = new ResourceScanner(this.settings);

    this.registerCommand({
      id: "scan-folder",
      title: this.i18n.t.cmdScanFolder,
      scope: "editor",
      hotkey: "Ctrl+Alt+R",
      callback: () => this._startScan(this.app.vault.path),
    });

    this.registerCommand({
      id: "find-shared",
      title: this.i18n.t.cmdFindShared,
      scope: "editor",
      // palette-only on purpose: keeps Ctrl+Alt+R unambiguous
      callback: () => this._startScan(this.app.vault.path, { mode: "shared" }),
    });

    this.registerCommand({
      id: "check-current",
      title: this.i18n.t.cmdCheckCurrent,
      scope: "editor",
      callback: () => this._startCurrentScan(),
    });

    this.registerSettingTab(new ResourceManagerSettingTab(this));
  }

  onunload() {
    if (this._modal) {
      this._modal.close();
      this._modal = null;
    }
  }

  /**
   * check-current entry: resolve the open file (core exposes it as
   * `app.workspace.activeFile` — `File.filePath ?? File.bundle.filePath`,
   * null for an unsaved draft), validate it belongs to the scan universe,
   * then reuse the _startScan machinery with mode "current".
   */
  _startCurrentScan() {
    const t = this.i18n.t;
    const root = this.app.vault.path;
    if (!root) return Notice.warning(t.scanEmpty);
    const cur = this.app.workspace && this.app.workspace.activeFile;
    if (!cur) return Notice.warning(t.noCurrentFile);
    if (!this.scanner._extSet("markdownExts").has(path.extname(cur).toLowerCase())) {
      return Notice.warning(t.curNotMd);
    }
    const rel = path.relative(root, cur);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return Notice.warning(t.curOutsideVault);
    }
    // ancestor folder names must not hit the ignore list — the walker
    // would never index the file, silently producing an empty view
    const ignore = this.scanner._folderSet();
    if (rel.split(/[\\/]+/).slice(0, -1).some((seg) => ignore.has(seg))) {
      return Notice.warning(t.curIgnored);
    }
    this._startScan(root, { mode: "current", currentFile: cur });
  }

  async _startScan(root, opts = {}) {
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
    // cooperative abort: the flag flips when the timer fires so the walker
    // actually stops reading directories — Promise.race alone only stops
    // *waiting*, the scan would keep burning IO in the background. The
    // losing promise's eventual rejection is still absorbed by the race
    // itself, so no unhandled rejection can leak.
    let timedOut = false;
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("timeout"));
      }, SCAN_TIMEOUT_MS);
    });
    try {
      const scanTask = opts.mode === "current"
        ? this.scanner.scanCurrent(root, opts.currentFile, tick, () => timedOut)
        : this.scanner.scan(root, tick, () => timedOut);
      const result = await Promise.race([scanTask, timeout]);
      notice.close();
      if (!result) return; // aborted mid-scan; the timeout path already notified
      if (opts.mode === "current") {
        if (result.stats.refs === 0) {
          Notice.success(t.noCurrentRefs);
          return;
        }
      } else if (opts.mode === "shared") {
        if (result.stats.shared === 0) {
          Notice.success(t.noShared);
          return;
        }
      } else if (result.stats.unused === 0 && result.stats.missing === 0) {
        Notice.success(t.allClean);
        return;
      }
      this._modal = new ReportModal(result, this.i18n, { mode: opts.mode || "report" });
      this._modal.onDispose(() => { if (this._modal) this._modal = null; });
      this._modal.open();
    } catch (e) {
      notice.close();
      console.error("[resource-manager] scan failed:", e);
      Notice.error(t.errScan + ": " + (e && e.message ? e.message : e));
    } finally {
      clearTimeout(timer);
    }
  }
}

export default ResourceManagerPlugin;

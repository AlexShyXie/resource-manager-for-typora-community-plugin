# Resource Manager for typora-community-plugin

English | [简体中文](README.md)

A port of the `resource_manager` plugin from [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) to the [typora-community-plugin](https://github.com/typora-community-plugin/typora-community-plugin) ecosystem. Functionality is identical to the original:

## Overview

Works on the **currently opened folder** (mounted folder) of Typora and provides three commands (all triggerable from the `F1` command palette):

1. **Scan mounted folder** (`scan-folder`, hotkey `Ctrl+Alt+R`): produces two lists
   - **Unreferenced resources** (redundant files): exist on disk, but are not referenced by any Markdown document
   - **Referenced but missing resources** (lost files): referenced in a document, but do not exist locally
2. **List resources referenced by multiple notes** (`find-shared`): a list of resources referenced by **2 or more** Markdown documents (multiple references within the same note count only once), sorted by referencing-note count in descending order, with preview and JSON export. **No filtering by file existence** — resources referenced by multiple notes but missing on disk are listed as well, with a "missing" badge appended after the path (badge text color follows the theme, clearly readable in both light and dark themes). (The two commands have separate duties: use the scan command above to find missing-file issues, while this command only reports reference relationships; in the exported JSON, missing entries carry `exists: false`)
3. **Check current file's attachment references** (`check-current`): based on the **currently opened md file** — lists every local attachment it references, marked either as "referenced only by this note" (deleting/moving/replacing it won't affect other notes) or "referenced by N other notes" (with the specific list attached); attachments referenced but missing on disk are listed as usual, also with a "missing" badge. Useful for impact assessment before modifying images in the current note; the exported JSON is split into `shared` / `exclusive` sections (the current file must be saved inside the mounted folder; dedicated notifications are shown if it is unsaved, outside the vault, not an md file, or located in an ignored directory)

Scan scope:

- **Recursively traverses all subdirectories** — not limited to specific directories like `images/` or `assets/`; only folders whose names are in the ignore list are skipped (default: `.git`, `.idea`, `.typora`, `node_modules`)
- **Markdown documents** (source of references): 10 extensions by default (`md`, `markdown`, `mdown`, etc.)
- **Resource files** (managed objects): 12 image extensions by default (`jpg`, `png`, `gif`, `svg`, etc.)
- Both extension lists are configurable in settings (e.g. add `mp3`, `mp4`)

Supported operations: toggle image preview, reveal file in file explorer, delete (to recycle bin), export JSON report; text inside the panel (paths, reference lists, summary lines) can be selected and copied directly — no need to export JSON first.

### Detection Rules & Security Boundaries

- Markdown image syntax `![alt](uri)`, HTML `<img src="...">`, and Obsidian-style Wikilink `![[image]]` / `[[image]]` (all toggleable in settings)
- Wikilink targets have `|alias`, `|size`, and `#anchor` suffixes stripped, and are **not URL-decoded** (Wikilink filenames may legally contain `%`); target filenames containing `[` `]` are also recognized (both are legal filename characters on Windows)
- Extension-less Wikilinks (e.g. `![[cat]]`, `![[cat|300]]`) are completed by matching against all known resource extensions across the vault; every same-named candidate counts as referenced. If no resource matches, the link is treated as a plain note link and excluded from statistics (so broken note links don't flood the missing list)
- Path-less Wikilinks fall back to matching by filename across the entire vault (a conservative strategy to avoid wrong deletions); Wikilinks **with a path** are resolved first as vault-root-relative (Obsidian semantics), then as md-relative fallback — only when both fail is the link counted as missing. A wrong path is therefore never masked by same-named files in other directories
- Web images (`http/https/ftp`) and embedded images (`data:`, `blob:`) are **excluded** from local existence checks
- `<>` wrapping in `uri`, URL percent-encoding (e.g. `%20` for space), and `?query` suffixes are decoded/stripped before parsing; if a bare `%` cannot be decoded, the original string is used instead (better to report "missing" than falsely "unreferenced"); `#` may be either an SVG fragment (e.g. `icon.svg#part`) or a literal part of the filename — the extension is first matched against the original string, and the `#` suffix is stripped and retried only if that fails
- References starting with `/` or `\` are resolved **relative to the directory of the md file** (Typora's root-relative semantics, same as the original)
- Same-named references are matched **case-insensitively** (Windows file system behavior)
- **Zero background components**: no listener processes, no timers, no file watchers; directories are only read when you trigger the command
- **Read-only scanning**: scanning itself writes no files; deletion goes to the recycle bin and requires confirmation; export requires manually choosing a path
- Does not follow symbolic links (prevents directory loops), traversal depth limit of 40, scan timeout of 180 seconds (automatically aborts with a notification on timeout)

## Installation

### Prerequisites

Install and enable the Typora Community Plugin Framework.

Project: https://github.com/typora-community-plugin/typora-community-plugin

### Option 1: Community Plugin Marketplace (Recommended)

Open Typora → go to the typora-community-plugin preferences → **Marketplace**, search for `Resource Manager`, then install **and enable** it.

### Option 2: Manual Installation

1. Download the latest `plugin.zip` from [Releases](https://github.com/AlexShyXie/resource-manager-for-typora-community-plugin/releases) and extract it
2. Put the extracted files into a `resource-manager` folder and copy it to:
   - Global: `C:\Users\<you>\.typora\community-plugins\plugins\resource-manager\`
   - Or current vault only: `<vault>\.typora\plugins\resource-manager\`
3. Open Typora → go to the typora-community-plugin preferences → **Installed Plugins** → check `Resource Manager` to enable it

> Requires typora-community-plugin ≥ 2.8.2, Typora ≥ 1.5.0.

## Usage

- Command palette (`F1`) → `Scan mounted folder for unused/missing resources`
- Or shortcut `Ctrl+Alt+R` (modifiable in Settings → Hotkeys)
- A notification in the bottom-right corner shows progress during scanning; results are displayed in a popup (two tables)
- Deleting a file moves it to the system recycle bin (recoverable, not permanent deletion), with a confirmation dialog by default (you can check "Don't ask again")
- Click `Export Report` at the bottom to generate a JSON file at a location of your choice

## Settings

Settings → Installed Plugins → Resource Manager:

| Option                                    | Description                                                  | Default                                                     |
| ----------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Resource extensions                       | File extensions included in the scan (space/comma separated) | `jpg jpeg png gif svg bmp webp ico tiff jfif avif`           |
| Markdown extensions                       | Document extensions to parse                                 | `md markdown mdown mmd rmarkdown mkd mdwn mdtxt rmd mdtext`  |
| Ignored directories                       | Directories skipped during traversal (by directory name)     | `.git .idea node_modules .typora`                            |
| Markdown / HTML / Wikilink syntax toggles | Scope of image syntax detection                              | All enabled                                                  |

## Differences from obgnail's Original

| Original                                                                          | This Port                                                                                                                         | Reason                                                                                                                            |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fs.remove` permanent deletion                                                     | `fs.trash` move to recycle bin                                                                                                    | Safer; core's cross-platform recycle bin API                                                                                      |
| Case-sensitive reference comparison                                                | Case-insensitive                                                                                                                  | On Windows, `IMG.png`/`img.png` are the same file; avoids false "missing" reports                                                 |
| No wikilink support                                                                | Supports `![[...]]` / `[[...]]` (with extension-less completion, vault-wide basename fallback, and root-relative path resolution) | Common in Obsidian-migrated / mixed-tool vaults; without it, wikilink-referenced images are falsely reported as "unused", tempting wrong deletions |
| Default resource extensions include empty extensions, `.gif!large`, audio/video    | Default is image formats only                                                                                                     | More conservative; can be added in settings if needed                                                                             |
| Export json / yaml / toml                                                          | JSON only                                                                                                                         | Single-file zero-dependency; dropped YAML/TOML serializers                                                                        |
| Integration with the `asset_root_redirect` plugin (front matter `typora-root-url`) | Not supported                                                                                                                     | No equivalent plugin in the tcp ecosystem                                                                                         |
| fast-table with column sorting                                                     | No sorting                                                                                                                        | Tables are hand-drawn DOM, keeping the codebase auditable                                                                         |

Ported from: obgnail/typora_plugin (MIT License). Tested on Windows 10 only.

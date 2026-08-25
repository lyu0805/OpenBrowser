# Fork 构建与发版指南（Windows）

> 记录 chimyves/OpenBrowser fork 在 LFS 配额耗尽背景下恢复"内核打包 → CI 构建 → Release 发版"完整链路的方案。
> 2026-08-25 验证通过：CI run [32883797145](https://github.com/chimyves/OpenBrowser/actions/runs/32883797145)，产物见 [v1.0.4 Release](https://github.com/chimyves/OpenBrowser/releases/tag/v1.0.4)。

## 背景：为什么 fork 拿不到内核

- 源仓库（lyu0805/OpenBrowser）的内核以 **Git LFS** 存储：git 仓库只有 ~134 字节的指针文件，真实二进制（windows-x64 共 2248 文件、1.83 GB）在 GitHub LFS 侧存储。
- 源仓库 **LFS 配额已耗尽**（"This repository exceeded its LFS budget"）：任何 `git lfs pull`、以及原 CI 的 `actions/checkout lfs:true` 都会失败。
- GitHub fork 不复制 LFS 对象，因此本 fork 从一开始就不可能通过 LFS 拿到内核。
- 官方内核下载源 `download.wayfern.com` **只保留最新版**（149.0.7827.114 的直链已 404，现仅提供 151.x）。

## 内核出处

| 平台 | 内核 | 出处 |
| --- | --- | --- |
| Windows x64 | Wayfern 149.0.7827.114 | Donut Browser（donutbrowser.com）的反检测 Chromium 构建，版本清单 `https://donutbrowser.com/wayfern.json`，仓库 `kernels/meta/wayfern.json` 是其快照 |
| macOS arm64 | Wayfern（同源 mac 包） | 同上 |
| macOS x64 | openbrowser_148（Chromium 148 定制构建） | 无公开下载点（清单中 macos-x64 为 null） |
| Linux x64 | Chrome for Testing | Google 官方（googlechromelabs），`npm run prepare:linux-kernel` 下载 |

项目自身**不编译内核**，只做"获取预编译内核 → 校验 → 打包"，且产品策略为运行时零下载（`ensureIntegrated` 永不联网取内核）。

## 关键校验：CDP companion 标记

`browser-kernel.js` 的 `INTEGRATED_KERNEL_CDP_MARKERS` 在 chrome.dll 的**固定文件偏移**上校验 Wayfern 补丁字节（149 版：`0x37e6551` 处 6×NOP、`0x41fddd0` 处 `b0 01 c3`）。`prepare:bundled-kernel` 与打包硬校验 `assertKernelPackagePolicy` 都依赖它。

**推论：升级到 Wayfern 151 不是换下载地址就行**——偏移随版本位移，需要在新版 chrome.dll 里重新定位补丁字节并更新标记常量、`kernel.json` 版本、meta 快照。这是内核升级的实际工作量所在。

## 内核来源（本 fork 的做法）

从本机已安装的官方 Release 版恢复：

```
robocopy "D:\Program Files\OpenBrowser\runtime\resources\app\kernels\windows-x64" ^
          "D:\Projects\OpenBrowser\Browserapp\kernels\windows-x64" /E
robocopy "D:\Program Files\OpenBrowser\runtime\resources\app\kernels\meta" ^
          "D:\Projects\OpenBrowser\Browserapp\kernels\meta" /E
```

（Git Bash 下需 `MSYS_NO_PATHCONV=1` 前缀避免 `/E` 被转义成路径。）

恢复后：

- **不要提交内核到 git**——LFS 配额耗尽，1.8 GB 二进制提交会撑爆仓库；保持其仅存在于本地工作区（`git status` 会显示这些文件被修改，属预期）。
- 手动下载最新版内核（仅适合做运行时自定义内核，不适合做打包种子）：读 `donutbrowser.com/wayfern.json` 取 `downloads["windows-x64"]`。

## 本地打包（可选，CI 已可替代）

```
cd Browserapp
npm install                                  # electron 43.1.1 + rcedit；缺失的运行时会自动下载
node scripts/ensure-host-runtime.js          # 仅在 electron dist 缺失时需要
npm run prepare:bundled-kernel               # 校验内核种子（存在性 + CDP 标记）
npm run package:portable                     # 打包（Git Bash 下：export PATH="/c/Program Files (x86)/NSIS:$PATH"）
```

产物：`Browserapp/dist/OpenBrowser-Windows-x86_64-with-kernel.zip`（便携包）与 `.exe`（NSIS 安装包，需本机装 NSIS：`winget install NSIS.NSIS`）。无内核变体：`OPENBROWSER_PACKAGE_VARIANT=without-kernel`。

便携版与安装包内容完全一致（安装包=便携目录打进 NSIS），区别仅是快捷方式/注册表卸载项/安装位置；两者共用 `%APPDATA%\openbrowser` 数据目录，**不可同时运行**。

## CI 构建（推荐发版方式）

工作流：`.github/workflows/build-windows-fork.yml`（存在于 `rpa-result-channel` 分支与 `main`——`workflow_dispatch` 要求默认分支也有该文件）。

与上游 `build-installers.yml` 的 Windows job 逐字相同，仅替换内核来源一步：不从 LFS 拉，而是从本 fork 的 **`kernel-seed` 预发布资产**（`windows-x64-kernel.zip`，1.05 GB，Wayfern 149.0.7827.114）下载并用 `Expand-Archive` 覆盖指针占位（不能用 GNU tar：不认 zip 且把盘符路径当远程主机）。

### 发版流程

```
# 1. 改代码，推送到 rpa-result-channel
# 2. 触发构建（或去 Actions 页面手动 Run workflow）
gh workflow run build-windows-fork.yml --repo chimyves/OpenBrowser \
   --ref rpa-result-channel -f release_tag=v1.0.5
# 3. 约 20–40 分钟后产物自动出现在对应 Release（--clobber 覆盖同名资产）
```

### kernel-seed 的维护

内核种子是 149 的唯一稳定来源（官网已下架 149）。仅当升级内核版本时需要重新制作：

```
cd Browserapp/kernels
powershell Compress-Archive windows-x64 -DestinationPath windows-x64-kernel.zip
gh release upload kernel-seed windows-x64-kernel.zip --clobber --repo chimyves/OpenBrowser
```

## 其他注意事项

- **应用内"检查更新"指向源仓库**（`main.js` 的 `UPDATE_REPOSITORY = 'lyu0805/OpenBrowser'`）。如需自检 fork 的 Release，需改该常量及 `UPDATE_ASSETS` 文件名映射。
- **版本号区分**：fork 构建的 `package.json` 版本与源仓库相同时（如 1.0.4）容易混淆，建议发版前递增。
- macOS dmg / Linux 包：本 fork 工作流只做 Windows。mac 内核（openbrowser_148）无公开来源，Linux 可用官方 CFT，如需扩展参照上游 `build-installers.yml` 对应 job。

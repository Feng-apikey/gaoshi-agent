import type { Page, Locator } from "playwright";
import { sleep, humanClick, withIdleMouseMove, waitForUploadComplete } from "./humanize.ts";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import * as path from "node:path";
import { getDB } from "../storage/db.ts";
import { materials } from "../storage/schema.ts";
import { eq } from "drizzle-orm";

// Module-level path cache populated by validateMaterials (in index.ts),
// consumed here to avoid hitting the DB on every upload call.
const _knownPaths = new Map<string, string>();
export function cacheMaterialPath(id: string, absPath: string): void {
  _knownPaths.set(id, absPath);
}
export function clearPathCache(): void {
  _knownPaths.clear();
}

// ── DOM helpers ──

export async function fillField(page: Page, loc: Locator, text: string): Promise<void> {
  await humanClick(page, loc);
  await sleep(400);
  // 区分 contenteditable vs 普通 input:
  //   - 普通 input/textarea: Control+a 全选 + Delete 清空 + paste (覆盖语义)
  //   - contenteditable (TipTap/ProseMirror 等富文本): 不能 Control+a — 选区可能
  //     包含用户已插入的 <table>/<img>/<a> 等结构,粘贴会破坏它们。
  //     用 Control+End 移到末尾,直接 paste (append 语义),保留已有结构。
  const isCE = await loc.evaluate((el) => (el as HTMLElement).isContentEditable).catch(() => false);
  if (isCE) {
    await page.keyboard.press("Control+End");
    await sleep(100);
  } else {
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await sleep(150);
  }
  // Reuse the humanize pasteText for consistency (clipboard + Ctrl+V)
  const { pasteText } = await import("./humanize.ts");
  await pasteText(page, text);
  await sleep(700);
}

/**
 * Try to click the first visible button matching any of the given patterns.
 * Returns true if a button was found and clicked.
 */
export async function clickButton(page: Page, patterns: RegExp[], sleepMs = 2000): Promise<boolean> {
  for (const name of patterns) {
    try {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await humanClick(page, btn);
        await sleep(sleepMs);
        return true;
      }
    } catch {}
  }
  return false;
}

// ── OS file dialog upload (拟人化 5 段时序) ──

/**
 * Build the PowerShell script for uploadFile Stage 3 (clipboard + Ctrl+V).
 *
 * Exported for unit tests so the clipboard integrity checks can run without
 * needing an actual OS file dialog as foreground. Tests pass `skipTitleCheck:
 * true` to bypass the foreground-window guard and exercise the SetText/GetText
 * round-trip in isolation.
 *
 * Guard details:
 *   - Reads the foreground window's title BEFORE setting the clipboard.
 *   - If title doesn't look like a file dialog (zh: 打开/选择/上传, en: Open/
 *     Choose/Browse/File), it emits `GAOSHI_ABORT` and restores the user's
 *     clipboard WITHOUT writing the path. This prevents the path from being
 *     pasted into whatever window happens to have focus (e.g. Mavis chat
 *     input) when the OS dialog fails to materialize.
 *   - Forces the dialog to foreground before SendKeys to defend against
 *     focus drift between SetText and Ctrl+V.
 *
 * Implementation notes:
 *   - The script must be passed via `powershell -EncodedCommand` (UTF-16LE
 *     Base64) because cmd.exe's `"..."` argument parsing strips literal `"`
 *     characters from `powershell -Command "..."` arguments. With
 *     EncodedCommand the entire script is one base64 token, no quoting.
 *   - PS script order: Add-Type (3x) → save $prev → sleep → title check →
 *     SetForegroundWindow → SetText → SendKeys x3 → restore $prev. $prev
 *     must be set BEFORE the abort branch that references it.
 */
export function buildUploadCmd(
  absPath: string,
  opts: { dialogWait: number; shortWait: number; skipTitleCheck?: boolean } = { dialogWait: 300, shortWait: 200 },
): string {
  const psQuoted = absPath.replace(/'/g, "''");
  // C# WinApi type as a single-quoted PS string (preserves `"` literally
  // inside the single quotes).
  const winApiType = opts.skipTitleCheck
    ? ""
    : `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public class WinApi { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount); }'; `;
  const titleGuard = opts.skipTitleCheck
    ? ""
    : `$hwnd = [WinApi]::GetForegroundWindow(); $title = New-Object System.Text.StringBuilder 256; [WinApi]::GetWindowText($hwnd, $title, 256) | Out-Null; $cls = New-Object System.Text.StringBuilder 256; [WinApi]::GetClassName($hwnd, $cls, 256) | Out-Null; $titleStr = $title.ToString(); $clsStr = $cls.ToString(); $isFileDialog = $titleStr -match '(打开|Open|选择|上传|Choose|Browse|File)'; if (-not $isFileDialog) { Write-Output "GAOSHI_ABORT hwnd=$([int64]$hwnd) title='$titleStr' class='$clsStr' wait=${opts.dialogWait}ms"; if ([string]::IsNullOrEmpty($prev)) { [System.Windows.Clipboard]::Clear() } else { [System.Windows.Clipboard]::SetText($prev) }; return }; [WinApi]::SetForegroundWindow($hwnd) | Out-Null; `;
  return (
    `Add-Type -AssemblyName System.Windows.Forms; ` +
    `Add-Type -AssemblyName PresentationCore; ` +
    winApiType +
    `$prev = [System.Windows.Clipboard]::GetText(); ` +
    `Start-Sleep -Milliseconds ${opts.dialogWait}; ` +
    titleGuard +
    `[System.Windows.Clipboard]::SetText('${psQuoted}'); ` +
    `[System.Windows.Forms.SendKeys]::SendWait('%n'); ` +
    `Start-Sleep -Milliseconds ${opts.shortWait}; ` +
    `[System.Windows.Forms.SendKeys]::SendWait('^v'); ` +
    `Start-Sleep -Milliseconds ${opts.shortWait}; ` +
    `[System.Windows.Forms.SendKeys]::SendWait('%o'); ` +
    `if ([string]::IsNullOrEmpty($prev)) { [System.Windows.Clipboard]::Clear() } ` +
    `else { [System.Windows.Clipboard]::SetText($prev) }`
  );
}

/**
 * Wrap a PowerShell script for `powershell -EncodedCommand`. The script is
 * encoded as UTF-16LE Base64 so cmd.exe's argument parsing cannot strip
 * literal `"` characters from the script body.
 */
export function encodedPowerShellCmd(script: string): string {
  const b64 = Buffer.from(script, "utf16le").toString("base64");
  return `powershell -NoProfile -EncodedCommand ${b64}`;
}

/**
 * Escape special SendKeys characters. SendKeys 把以下字符当控制符:
 *   + ^ % ~ ( ) { }  —— 这些必须用 {} 包起来才能当字面字符
 *
 * 重要:反斜杠 `\` 在 SendKeys 里就是字面键,**不要做任何"转义"**。
 * 之前 `replace(/\\/g, "\\\\")` 是错的——会把 `D:\path` 变成 `D:\\path`,
 * 对话框收到字面两个反斜杠,Windows 文件系统找不到这个路径,文件名确认失败。
 *
 * `'` 在 SendKeys 里没有特殊语义,但 PowerShell 单引号字符串里需要双写转义。
 *
 * 当前状态: **已不再被生产路径调用**。uploadFile() 改用剪贴板 + Ctrl+V,
 * 路径经剪贴板字面传输,SendKeys 只发 ^v / %o / %n 控制序列,完全不发送路径。
 * 保留导出供回归测试 + 应急回退用(如果未来需要直接用 SendKeys 注入字符)。
 */
export function escapeSendKeys(s: string): string {
  return s
    .replace(/[+^%~(){}]/g, "{$&}")
    .replace(/'/g, "''");
}

/**
 * Resolve materialId → absolute file path. Reuses the cache populated by
 * index.ts validateMaterials; falls back to materials table; final fallback
 * to data/<id> on disk.
 */
/**
 * Click a platform-specific upload zone then inject the file via the OS
 * dialog. Convenience wrapper for the common case where the caller only
 * needs to pass a hardcoded selector.
 */
export async function uploadFile(
  page: Page,
  zoneSelector: string,
  materialId: string,
  knownPath?: string,
): Promise<void> {
  const absPath = resolveMaterialPath(materialId, knownPath);
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(absPath);
  const uploadEl = page.locator(zoneSelector).first();
  await withIdleMouseMove(page, () => humanClick(page, uploadEl));
  await injectFileViaOSDialog(page, absPath, isVideo);
}

export function resolveMaterialPath(materialId: string, knownPath?: string): string {
  if (knownPath && existsSync(knownPath)) return knownPath;
  // Self-healing cache: hit → verify file still exists; if not, drop the stale
  // entry and fall through to the DB so a rename/move after the draft was
  // validated still resolves correctly. The DB read back-fills the cache.
  const cached = _knownPaths.get(materialId);
  if (cached) {
    if (existsSync(cached)) return cached;
    _knownPaths.delete(materialId);
  }
  try {
    const db = getDB();
    const row = db.select().from(materials).where(eq(materials.id, materialId)).get() as any;
    if (row?.path && existsSync(row.path)) {
      _knownPaths.set(materialId, row.path);
      return row.path;
    }
  } catch {}
  const fallback = path.resolve(process.cwd(), "data", materialId);
  if (existsSync(fallback)) return fallback;
  throw new Error(`素材文件不存在：${materialId}`);
}



/**
 * Drive the OS file dialog for an already-open upload zone.
 *
 * Caller MUST click the platform-specific upload element first. This helper
 * only handles the cross-platform parts:
 *
 *   - ensure Edge is foreground (Alt+Tab if CDP bringToFront was ignored)
 *   - PowerShell: clipboard.SetText(absPath) → SendKeys('%n' + '^v' + '%o')
 *     (走 OS 文件对话框,路径经剪贴板绕开 SendKeys 字符处理争议)
 *   - bringToFront + DOM 探测上传完成
 *
 * 为什么用剪贴板 + Ctrl+V,不用 SendKeys 直接注入路径?
 *   SendKeys 对 `\` 等字符的处理在 Windows 不同版本/不同实现下有差异,
 *   实际推送中观察到对话框里出现 D:\\path 这种带转义反斜杠。
 *   剪贴板是 OS 唯一可靠的"传字符串到原生控件"通道。
 */
export async function injectFileViaOSDialog(
  page: Page,
  absPath: string,
  isVideo: boolean,
): Promise<void> {
  // **串行约束**: Edge 必须在 click 之前到前台,否则 CDP click 不是 user gesture,
  // Windows 不让 native file dialog 弹起。
  await page.bringToFront();  // CDP request (可能被忽略)
  await sleep(800 + Math.floor(Math.random() * 400));  // 等焦点稳定

  // 等 OS dialog 物化（PowerShell 冷启动 + Windows 文件对话框初始化）
  await sleep(800 + Math.floor(Math.random() * 400));

  // 剪贴板 + Ctrl+V (page 操作全停, mouse 抖动不包)
  // - 保存用户原剪贴板内容,操作后恢复(避免污染用户剪贴板)
  // - PS 单引号字符串里 `'` 需要双写,`\` 不需要转义(剪贴板是字面)
  // - **关键**:SendKeys 是 OS 全局,Ctrl+V 会贴到任何有焦点的窗口。
  //   必须在 SetText 前确认前台是文件对话框,否则 ^v 会泄漏到 Mavis 输入框等
  //   用户当前焦点位置。检测到非对话框 → abort,不污染剪贴板。
  const dialogWait = 300 + Math.floor(Math.random() * 200);   // 300-500ms
  const shortWait = 200 + Math.floor(Math.random() * 200);   // 200-400ms
  const psCmd = buildUploadCmd(absPath, { dialogWait, shortWait });
  const fullCmd = encodedPowerShellCmd(psCmd);
  await new Promise<void>((resolve, reject) => {
    exec(fullCmd, { windowsHide: true, timeout: 15000 },
      (err, stdout, stderr) => {
        if (typeof stdout === "string" && stdout.includes("GAOSHI_ABORT")) {
          const stderrTail = stderr ? ` | stderr: ${stderr.trim().slice(0, 500)}` : "";
          return reject(new Error(`文件对话框未打开 (GAOSHI_ABORT 焦点守护中止): ${stdout.trim()}${stderrTail}`));
        }
        err ? reject(err) : resolve();
      }
    );
  });

  // Stage 4: 抢回焦点到浏览器
  await page.bringToFront();
  await sleep(300 + Math.floor(Math.random() * 300));   // 300-600ms

  // Stage 5: 等这次上传完成 (mouse 抖动可包, page 已重获焦点)
  // waitForUploadComplete 内部用 DOM 探测 "重新上传/已上传/上传成功" 文案,
  // 不再用 networkidle (分片上传不等就 timeout, 视频 silently 失败)。
  await withIdleMouseMove(page, () => waitForUploadComplete(page, isVideo));
}

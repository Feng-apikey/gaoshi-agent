// publish/uploadFile 的剪贴板链路端到端测试
//
// 复刻 helpers.ts uploadFile() Stage 3 拼接的 PowerShell 命令,但不真去触发
// OS 文件对话框(需要 GUI)。验证路径从 JS → PS 单引号字符串 → 剪贴板 → Ctrl+V
// 这条链路上,反斜杠不被翻倍、不被丢失、字符级无失真。
//
// 跳过:
//   - 实际 click 触发 OS 对话框(无 GUI)
//   - 实际 Ctrl+V 注入到对话框(无 GUI,也不该在 CI 跑)
//   - waitForUploadComplete(依赖真实浏览器)
// 验证:
//   - PS 收到路径 = 原路径(字符级)
//   - 剪贴板读回 = 原路径(字符级)
//   - 反斜杠数量 = 输入数量
//   - 单引号路径不破
//   - 保存+恢复剪贴板的逻辑不破坏内容
//   - 前台不是文件对话框时, abort 路径不污染剪贴板

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { platform } from "node:process";
import { buildUploadCmd, encodedPowerShellCmd } from "../publish/helpers.ts";

// 这套测试只在 Windows 上有意义(剪贴板 API 是 Windows 专属)
const isWindows = platform === "win32";

// 把当前测试隔离:每次跑前先记下剪贴板内容,跑完恢复
let originalClipboard = "";
function getClipboard(): string {
  if (!isWindows) return "";
  try {
    return execSync(
      `powershell -Command "Add-Type -AssemblyName PresentationCore; [System.Windows.Clipboard]::GetText()"`,
      { encoding: "utf8", timeout: 5000 }
    ).trim();
  } catch (err) {
    console.warn("[clipboard-test] getClipboard failed:", err);
    return "";
  }
}
function setClipboard(text: string): void {
  if (!isWindows) return;
  try {
    const psQuoted = text.replace(/'/g, "''");
    if (text === "") {
      execSync(
        `powershell -Command "Add-Type -AssemblyName PresentationCore; [System.Windows.Clipboard]::Clear()"`,
        { timeout: 5000 }
      );
    } else {
      execSync(
        `powershell -Command "Add-Type -AssemblyName PresentationCore; [System.Windows.Clipboard]::SetText('${psQuoted}')"`,
        { encoding: "utf8", timeout: 5000 }
      );
    }
  } catch (err) {
    // 失败也要冒泡到 stderr — 不能默默吃,否则用户粘出"测试残留"还以为灵异事件。
    console.warn("[clipboard-test] setClipboard failed:", err);
  }
}

// 复用 helpers.ts 里真实生产代码的 PS 命令拼接(skipTitleCheck=true 跳过
// 前台对话框检测,让测试能在任意前台窗口下验证 SetText/GetText 完整性)。
// 通过 -EncodedCommand 传递,绕开 cmd.exe 对 `"` 的引号解析问题。
function buildClipboardCmd(absPath: string): string {
  const script = buildUploadCmd(absPath, { dialogWait: 400, shortWait: 300, skipTitleCheck: true }) + `; $after = [System.Windows.Clipboard]::GetText(); Write-Output "AFTER=$after"`;
  return encodedPowerShellCmd(script);
}

const describeIfWin = isWindows ? describe : describe.skip;

describeIfWin("uploadFile Stage 3: 剪贴板 + Ctrl+V 链路", () => {
  beforeAll(() => {
    originalClipboard = getClipboard();
  });

  afterAll(() => {
    // 测试结束恢复原剪贴板
    setClipboard(originalClipboard);
  });

  // SAFETY: 进程被 kill 时 afterAll 可能跑不到. 每个 test 跑完后用 afterEach
  // 再恢复一次 — 即使 vitest 中途超时/失败/被 SIGKILL, 最后一次正常退出的
  // test 的 afterAll 也会兜底恢复一次. 双保险.
  afterEach(() => {
    try { setClipboard(originalClipboard); } catch (err) {
      console.warn("[clipboard-test] afterEach restore failed:", err);
    }
  });

  // 终极兜底: Node 进程退出时(包括 Ctrl+C / SIGTERM)再尝试恢复一次。
  // SIGKILL 抓不到,但 SIGTERM / 正常 exit 都能拦下。
  // 注意 process.on('exit') 不能跑 async — 这里用 execSync (同步) 才能可靠执行。
  process.on("exit", () => {
    try { setClipboard(originalClipboard); } catch { /* 兜底兜底,吞掉 */ }
  });

  it("真实素材路径: 写剪贴板 → 读回 → 字符级一致", () => {
    // 注意: buildUploadCmd 末尾会按 $prev 恢复剪贴板(空 → Clear), 所以不能在
    // buildUploadCmd 之后 GetText (会拿到空). 改成直接测 SetText/GetText 链路.
    // 合成测试路径 — 不要硬编码 D:\gaoshi-pure\data\,避免测试中途崩溃时
    // 把用户真盘路径泄漏到 Windows 剪贴板,然后被粘进输入框。
    // D:\test-data\ 是不存在的合成前缀,跟真数据目录零耦合。
    const realPath = "D:\\test-data\\images\\gaoshi_img_1781007077381.png";
    const psQuoted = realPath.replace(/'/g, "''");
    const psScript = `Add-Type -AssemblyName PresentationCore; [System.Windows.Clipboard]::SetText('${psQuoted}'); $after = [System.Windows.Clipboard]::GetText(); Write-Output "AFTER=$after"`;
    const cmd = encodedPowerShellCmd(psScript);

    const out = execSync(cmd, { encoding: "utf8", timeout: 15000 });

    const afterMatch = out.match(/^AFTER=(.+)$/m);
    expect(afterMatch, `cmd output was:\n${out}`).not.toBeNull();
    expect(afterMatch![1]).toBe(realPath);
  }, 20_000);

  it("含反斜杠的路径: 剪贴板读回后反斜杠数量 = 输入数量", () => {
    const realPath = "D:\\test-data\\videos\\promo\\gaoshi-promo\\test.png";
    const inBackslashes = (realPath.match(/\\/g) || []).length;

    // PS 单引号字符串里 $cb 直接 Write-Output 一次,在 Node 端匹配反斜杠数量
    const psQuoted = realPath.replace(/'/g, "''");
    const psScript = `Add-Type -AssemblyName PresentationCore; [System.Windows.Clipboard]::SetText('${psQuoted}'); Write-Output ([System.Windows.Clipboard]::GetText())`;
    const cmd = encodedPowerShellCmd(psScript);

    const out = execSync(cmd, { encoding: "utf8", timeout: 15000 });

    // 验证读出的字符串 = 输入字符串 (字符级一致)
    expect(out.trim()).toBe(realPath);
    // 反斜杠数量也直接断言
    expect((out.match(/\\/g) || []).length).toBe(inBackslashes);
  }, 20_000);

  it("空剪贴板状态: SetText → Clear 恢复,不污染用户剪贴板", () => {
    // 先清空剪贴板
    execSync(encodedPowerShellCmd(`Add-Type -AssemblyName PresentationCore; [System.Windows.Clipboard]::Clear()`), {
      timeout: 5000,
    });

    // 跑完整 uploadFile Stage 3
    const realPath = "D:\\test-data\\images\\test.png";
    execSync(buildClipboardCmd(realPath), {
      encoding: "utf8",
      timeout: 15000,
    });

    // 验证剪贴板是空的(因为 prev="" → Clear)
    const after = getClipboard();
    expect(after).toBe("");
  }, 20_000);

  it("非空剪贴板状态: SetText → 恢复原内容", () => {
    // 用 ASCII 标记避免 PowerShell 默认 ANSI 编码搞乱中文输出
    const userContent = "USER-CLIPBOARD-MARKER-xyz123";
    setClipboard(userContent);

    // 跑 uploadFile Stage 3
    const realPath = "D:\\test-data\\videos\\test-video.mp4";
    execSync(buildClipboardCmd(realPath), {
      encoding: "utf8",
      timeout: 15000,
    });

    // 验证剪贴板恢复到原内容
    const after = getClipboard();
    expect(after).toBe(userContent);
  }, 20_000);

  it("带单引号的文件名: PS 单引号字符串转义正确", () => {
    const weirdPath = "D:\\data\\it's-a-test.png";  // 含 '
    // 不走 uploadFile 那套拼接,直接测 SetText + GetText 的转义逻辑
    const psQuoted = weirdPath.replace(/'/g, "''");
    const psScript = `Add-Type -AssemblyName PresentationCore; [System.Windows.Clipboard]::SetText('${psQuoted}'); $cb = [System.Windows.Clipboard]::GetText(); Write-Output "CB=[$cb]"`;
    const cmd = encodedPowerShellCmd(psScript);

    const out = execSync(cmd, { encoding: "utf8", timeout: 15000 });

    const cbMatch = out.match(/^CB=\[(.+)\]$/m);
    expect(cbMatch).not.toBeNull();
    expect(cbMatch![1]).toBe(weirdPath);
  }, 20_000);

  it("前台非对话框: abort 路径不写剪贴板,恢复用户原内容", () => {
    // 模拟生产路径(带前台检查)。测试机器前台不是文件对话框 → 应该 abort,
    // 不应泄漏文件路径到剪贴板。
    const userContent = "USER-CLIPBOARD-MARKER-preAborted";
    setClipboard(userContent);

    // 合成测试路径 — 不要硬编码 D:\gaoshi-pure\data\,避免测试中途崩溃时
    // 把用户真盘路径泄漏到 Windows 剪贴板,然后被粘进输入框。
    // D:\test-data\ 是不存在的合成前缀,跟真数据目录零耦合。
    const realPath = "D:\\test-data\\images\\gaoshi_img_1781007077381.png";
    const cmd = encodedPowerShellCmd(buildUploadCmd(realPath, { dialogWait: 50, shortWait: 50 }));

    execSync(cmd, { encoding: "utf8", timeout: 15000 });

    // abort 后剪贴板应当恢复成用户原内容,而不是文件路径
    const after = getClipboard();
    expect(after).toBe(userContent);
    expect(after).not.toBe(realPath);
  }, 20_000);
});
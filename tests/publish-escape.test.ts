import { describe, it, expect } from "vitest";
import { escapeSendKeys } from "../publish/helpers.ts";

// ═══════════════════════════════════════════
// escapeSendKeys — 给 PowerShell SendKeys 注入的字面字符串准备
//
// SendKeys 字符语义:
//   + ^ % ~ ( ) { }  → 控制符,必须用 {} 包起来当字面
//   \                  → 字面键,**不要做任何转义**
//   '                  → PowerShell 单引号字符串里需要双写
//
// 历史 bug: .replace(/\\/g, "\\\\") 把单反斜杠翻倍成双反斜杠,
// SendKeys 注入到 Windows 文件对话框后字面就是 "D:\\path\\...",
// Windows 文件系统找不到这个路径,文件名确认失败。
//
// 当前状态: uploadFile() 已改用剪贴板 + Ctrl+V,本函数不再被生产路径调用。
// 保留作为应急回退方案,测试继续保护它不被改坏。
// ═══════════════════════════════════════════

describe("escapeSendKeys", () => {
  describe("反斜杠 (核心 bug fix)", () => {
    it("不翻倍单个反斜杠", () => {
      const input = `D:\\test-data\\images\\sub\\fixture_1781007077381.png`;
      const out = escapeSendKeys(input);
      // 输入 4 个反斜杠,输出必须仍然是 4 个
      expect((out.match(/\\/g) || []).length).toBe(4);
    });

    it("不翻倍多个反斜杠 (深度路径)", () => {
      const input = "D:\\a\\b\\c\\d\\e\\f.png";
      expect((escapeSendKeys(input).match(/\\/g) || []).length).toBe(6);
    });

    it("输出字符串等于输入字符串 (无任何特殊字符的路径)", () => {
      const input = `D:\\test-data\\images\\sub\\fixture_1781007077381.png`;
      // 不含 SendKeys 特殊字符时,escape 必须是恒等
      expect(escapeSendKeys(input)).toBe(input);
    });

    it("输出字符串能直接送到 SendKeys 后,在 Windows 文件对话框里命中真实路径", () => {
      const absPath = "D:\\test-data\\images\\sub\\fixture_1781007077381.png";
      const escaped = escapeSendKeys(absPath);
      // 直接拼到 PowerShell 单引号字符串里 — 必须一字不差
      const psCmd = `[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`;
      // 验证 psCmd 里 SendKeys 收到的字面字符串 === 磁盘真实路径
      const m = psCmd.match(/SendWait\('(.+)'\)$/);
      expect(m).not.toBeNull();
      expect(m![1]).toBe(absPath);
    });
  });

  describe("SendKeys 控制符必须用 {} 包起来", () => {
    it.each([
      ["+", "{+}"],
      ["^", "{^}"],
      ["%", "{%}"],
      ["~", "{~}"],
      ["(", "{(}"],
      [")", "{)}"],
      ["{", "{{}"],
      ["}", "{}}"],
    ])("%s → %s", (char, expected) => {
      expect(escapeSendKeys(char)).toBe(expected);
    });
  });

  describe("单引号", () => {
    it("单引号 → 双写 (PowerShell 转义)", () => {
      expect(escapeSendKeys("it's")).toBe("it''s");
    });

    it("路径中无单引号时不变", () => {
      expect(escapeSendKeys("D:\\no-quote-here\\file.png")).toBe("D:\\no-quote-here\\file.png");
    });
  });

  describe("合成素材路径 (回归保护)", () => {
    // 不用 D:\gaoshi-pure\data\,避免误导未来读者以为这是真盘路径。
    // escape 测试只关心字符串变换,文件存在与否无关。
    it("合成图片路径 escape 后不引入任何多余反斜杠", () => {
      const realPath = "D:\\test-data\\images\\sub\\fixture_1781007077381.png";
      const out = escapeSendKeys(realPath);
      // SendKeys 注入后,Windows 文件对话框收到的字符串必须 === 磁盘路径(字面)
      expect(out).toBe(realPath);
    });

    it("合成视频路径 escape 后不引入任何多余反斜杠", () => {
      const realPath = "D:\\test-data\\videos\\fixture-video.mp4";
      const out = escapeSendKeys(realPath);
      expect(out).toBe(realPath);
    });

    it("特殊字符文件名 (含括号) escape 后反斜杠不被翻倍", () => {
      const weird = "D:\\path\\with (parens)\\file.png";
      const out = escapeSendKeys(weird);
      // 反斜杠必须保留 (输入 3 个,输出必须 3 个)
      expect((out.match(/\\/g) || []).length).toBe(3);
      // 括号被 {} 包起来
      expect(out).toContain("{(}");
      expect(out).toContain("{)}");
    });
  });
});
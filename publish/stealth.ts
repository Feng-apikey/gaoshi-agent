// Anti-bot stealth init script.
//
// 注入时点:addInitScript — 在每个 page 自己的 JS 跑之前完成 patch,
// 所以 page 读 navigator.webdriver 等属性看到的就是"假人类"值。
//
// 覆盖范围(最高 ROI 优先):
//   1. navigator.webdriver → false
//   2. 清掉 document.__webdriver_evaluate / __selenium_unwrapped 等 hook
//   3. navigator.plugins → 真实浏览器的 array(NR 检测最常见的 fingerprint)
//   4. navigator.languages → 真人 zh-CN / zh / en
//
// 已知局限(后续可补,目前不做):
//   - chrome.runtime 缺时的 stub(影响小)
//   - WebGLRenderer UNMASKED_RENDERER_WEBGL 真渲染器串(影响小)
//   - CDP 协议层指纹(走 launchPersistentContext 已经不走远端 CDP,残留少很多)

export const STEALTH_INIT_SCRIPT = `
(() => {
  try {
    // ── 1. navigator.webdriver → false (核心) ──
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  } catch (e) {}

  try {
    // ── 2. 清掉自动化 hook ──
    const hookNames = [
      '__webdriver_evaluate', '__webdriver_script_function',
      '__webdriver_unwrap', '__driver_evaluate',
      '__selenium_unwrapped', '__fxdriver_evaluate',
      '__driver_unwrap', '__lastWatirEvaluate',
      '__lastWatirCommand', '_Selenium_IDE_Recorder',
    ];
    for (const n of hookNames) {
      try { delete window[n]; } catch (e) {}
      try { delete document[n]; } catch (e) {}
    }
  } catch (e) {}

  try {
    // ── 3. navigator.plugins → 真实 Edge 的 PDF Viewer 列表 ──
    const fakePlugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '', length: 1 },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '', length: 1 },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: '', length: 1 },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: '', length: 1 },
    ];
    Object.defineProperty(Navigator.prototype, 'plugins', {
      get: () => {
        fakePlugins.item = (i) => fakePlugins[i] || null;
        fakePlugins.namedItem = (n) => fakePlugins.find((p) => p.name === n) || null;
        fakePlugins.refresh = () => {};
        return fakePlugins;
      },
      configurable: true,
    });
  } catch (e) {}

  try {
    // ── 4. navigator.languages → zh-CN 真实用户 ──
    Object.defineProperty(Navigator.prototype, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });
  } catch (e) {}
})();
`;

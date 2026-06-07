// ── URLs ──
export const CREATOR_URL = "https://member.bilibili.com";
export const UPLOAD_VIDEO_URL = "https://member.bilibili.com/platform/upload/video";
export const ARTICLE_URL = "https://member.bilibili.com/platform/article";
export const DYNAMIC_URL = "https://member.bilibili.com/platform/upload/dynamic";
export const LOGIN_URL = "https://passport.bilibili.com/qrcode";
export const SEARCH_URL = "https://search.bilibili.com/all";
export const CREATOR_HOME_URL = "https://member.bilibili.com/platform/home";

// ── Limits (per content type) ──
export const LIMITS = {
  dynamic: { text: 2000, maxImages: 9, maxTags: 5 },
  video: { title: 30, desc: 250, maxTags: 10, maxFiles: 1 },
  article: { title: 30, body: 20000, maxImages: 50 },
} as const;

// ── Common partition IDs ──
export const PARTITIONS: Record<number, string> = {
  17: "单机游戏", 21: "日常", 95: "数码", 122: "野生技术协会",
  124: "社科·法律·心理", 160: "生活记录", 171: "电子竞技", 183: "影视杂谈",
  188: "科技资讯", 201: "科学", 207: "财经商业", 208: "科技",
  209: "手工", 230: "其他(生活)", 231: "美食", 234: "健身",
  28: "原创音乐", 31: "翻唱", 32: "完结动画", 65: "网络游戏",
};

// ── Timeouts (ms) ──
export const TIMEOUT = {
  PAGE_LOAD: 30_000,
  ELEMENT_VISIBLE: 5_000,
  ELEMENT_QUICK: 3_000,
  POPUP: 1_500,
  TAG_SUGGESTION: 2_000,
  FILE_INPUT: 5_000,
  BODY_TEXT: 8_000,
  LOGIN_POLL_INTERVAL: 3_000,
  DEFAULT_LOGIN_WAIT: 120_000,
} as const;

// ── Delays (ms) ──
export const DELAY = {
  AFTER_NAV: 3_000,
  AFTER_CLICK: 200,
  AFTER_FILL: 300,
  AFTER_EDITOR_FILL: 500,
  AFTER_DISMISS: 300,
  AFTER_UPLOAD_CLICK: 1_000,
  AFTER_FILE_UPLOAD: 5_000,
  AFTER_VIDEO_UPLOAD: 15_000,
  AFTER_COVER_UPLOAD: 3_000,
  AFTER_SAVE_DRAFT: 2_000,
  BETWEEN_IMAGES: 3_000,
  POST_SUBMIT: 3_000,
  POST_SEARCH: 5_000,
} as const;

// ── UI text markers (B站 DOM — update if they change the UI) ──
export const MARKERS = {
  LOGGED_IN: ["内容管理", "稿件管理", "创作中心", "数据", "作品管理"],
  LOGIN_PAGE: ["扫码登录", "登录", "请登录"],
  POPUP_BUTTONS: ["我知道了", "知道了", "关闭", "跳过", "立即体验"],
  SAVE_DRAFT_BUTTONS: ["保存草稿", "存草稿", "暂存"],
  SUBMIT_BUTTONS: ["发布", "提交审核", "立即发布", "投稿"],
} as const;

export const SELECTORS = {
  TITLE_INPUT: [
    'input[placeholder*="标题"]',
    'input[placeholder*="视频标题"]',
    'input[placeholder*="文章标题"]',
    'textarea[placeholder*="标题"]',
  ],
  BODY_EDITOR: '[contenteditable="true"]:visible',
  DYNAMIC_TEXTAREA: 'textarea[placeholder*="说点什么"], textarea[placeholder*="发表动态"], textarea[placeholder*="分享"]',
  TAG_SUGGESTION: '[class*="suggest"]:visible, [class*="option"]:visible',
  FILE_INPUT: 'input[type="file"]',
  SEARCH_INPUT: 'input[placeholder*="搜索"], input[class*="search-input"]',
  VIDEO_UPLOAD_ZONE: "text=或直接将视频文件拖入此区域, text=点击上传视频, text=选择视频文件",
  IMAGE_UPLOAD_ZONE: "text=或直接将图片文件拖入此区域, text=点击上传图片, text=选择图片文件",
  PARTITION_SELECTOR: '[class*="partition"], [class*="category"], [class*="tid"]',
  TAGS_INPUT: 'input[placeholder*="标签"], input[placeholder*="添加标签"]',
  COVER_UPLOAD: 'text=上传封面, text=添加封面, text=选择封面',
} as const;

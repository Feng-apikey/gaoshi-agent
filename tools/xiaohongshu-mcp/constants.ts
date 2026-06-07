// ── URLs ──
export const CREATOR_URL = "https://creator.xiaohongshu.com";
export const LOGIN_URL = "https://creator.xiaohongshu.com/login";
export const PUBLISH_IMAGE_URL = "https://creator.xiaohongshu.com/publish/publish";
export const PUBLISH_VIDEO_URL = "https://creator.xiaohongshu.com/publish/publish";
export const PUBLISH_ARTICLE_URL = "https://creator.xiaohongshu.com/publish/article";
export const CREATOR_HOME_URL = "https://creator.xiaohongshu.com/";
export const SEARCH_URL = "https://www.xiaohongshu.com/search_result";

// ── Limits (per content type) ──
export const LIMITS = {
  image_text: { title: 20, body: 1000, maxTags: 10, maxImages: 9 },
  video: { title: 20, body: 1000, maxTags: 10 },
  article: { title: 20, body: 6000, maxTags: 10 },
} as const;

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
  AFTER_VIDEO_UPLOAD: 10_000,
  AFTER_COVER_UPLOAD: 3_000,
  AFTER_HEADER_UPLOAD: 3_000,
  AFTER_SAVE_DRAFT: 2_000,
  BETWEEN_IMAGES: 3_000,
  PLACEHOLDER_UPLOAD: 5_000,
  POST_SEARCH: 5_000,
} as const;

// ── UI text selectors (Xiaohongshu DOM — update if they change the UI) ──
export const MARKERS = {
  LOGGED_IN: ["发布笔记", "笔记管理", "数据中心", "创作中心", "内容管理"],
  LOGIN_PAGE: ["扫码登录", "手机号登录", "小红书"],
  POPUP_BUTTONS: ["我知道了", "关闭", "取消", "跳过"],
  SAVE_DRAFT_BUTTONS: ["存草稿", "保存草稿", "暂存"],
} as const;

export const SELECTORS = {
  TITLE_INPUT: [
    '[placeholder*="标题"]',
    '[class*="title"] input',
    '[class*="title"] textarea',
    'textarea[class*="title"]',
    'input[class*="title"]',
  ],
  BODY_EDITOR: '[contenteditable="true"]:visible',
  BODY_TEXTAREA: 'textarea[placeholder*="正文"], textarea[placeholder*="内容"], textarea[class*="content"], textarea[class*="body"]',
  TAG_INPUT: '[placeholder*="标签"], [placeholder*="话题"], [class*="tag"] input, [class*="topic"] input',
  TAG_SUGGESTION: '[class*="suggest"]:visible, [class*="option"]:visible, [class*="tag-item"]:visible',
  FILE_INPUT: 'input[type="file"]',
  SEARCH_INPUT: 'input[placeholder*="搜索"], input[class*="search"]',
  NOTE_CARD: '[class*="note-item"], [class*="feed-item"], [class*="card"]',
} as const;

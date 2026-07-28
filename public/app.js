// === File Manager App ===

const state = {
  currentPath: '',
  entries: [],
  treeNodes: {},     // path -> { expanded, loaded, children }
  previewFile: null,
  selected: new Set(),      // Set of entry paths for multi-select
  sortKey: 'default',       // sort dropdown value
  user: null,               // { username, isAdmin }
};

// === Auth Helpers ===
let _csrfToken = '';

async function fetchCsrfToken() {
  try {
    const res = await _origFetch('/api/csrf-token', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      _csrfToken = data.token;
      return data.token;
    }
  } catch (_) {}
  return null;
}

async function checkAuth() {
  try {
    const res = await _origFetch('/api/auth/session', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      state.user = data;
      // Fetch CSRF token once authenticated
      await fetchCsrfToken();
      return true;
    }
  } catch (_) {}
  state.user = null;
  return false;
}

function redirectToLogin() {
  window.location.href = '/login.html';
}

async function doLogout() {
  try {
    const headers = {};
    if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
    await _origFetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers });
  } catch (_) {}
  redirectToLogin();
}

// Save original fetch before wrapping
const _origFetch = window.fetch;

// Auth-aware fetch: CSRF token + auto-redirect on 401 + refresh CSRF on 403 retry once
function authFetch(url, options = {}) {
  return doAuthFetch(url, options, false);
}

async function doAuthFetch(url, options = {}, isRetry) {
  const method = (options.method || 'GET').toUpperCase();
  const opts = { ...options, credentials: options.credentials || 'include' };

  // Attach CSRF token to state-changing requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    opts.headers = new Headers(opts.headers || {});
    if (_csrfToken) opts.headers.set('X-CSRF-Token', _csrfToken);
  }

  const res = await _origFetch(url, opts);

  if (res.status === 401) {
    try {
      const data = await res.clone().json();
      if (data.code === 'UNAUTHORIZED') redirectToLogin();
    } catch (_) {}
    return res;
  }

  // CSRF token probably expired; refresh once and retry
  if (res.status === 403 && !isRetry && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const newToken = await fetchCsrfToken();
    if (newToken) return doAuthFetch(url, options, true);
  }

  return res;
}

// === DOM References ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  tree: $('#tree'),
  breadcrumb: $('#breadcrumb'),
  fileList: $('#file-list'),
  itemCount: $('#item-count'),
  searchInput: $('#search-input'),
  refreshBtn: $('#refresh-btn'),
  sortSelect: $('#sort-select'),
  selectRect: null, // created dynamically on body
  sidebarToggle: $('#sidebar-toggle'),
  sidebarOverlay: $('#sidebar-overlay'),
  settingsBtn: $('#settings-btn'),
  rootPath: $('#root-path'),
  previewOverlay: $('#preview-overlay'),
  previewContainer: $('#preview-container'),
  previewTitle: $('#preview-title'),
  previewContent: $('#preview-content'),
  previewDownload: $('#preview-download'),
  previewClose: $('#preview-close'),
  previewEdit: $('#preview-edit'),
  imageNavPrev: $('#image-nav-prev'),
  imageNavNext: $('#image-nav-next'),
  imageCounter: $('#image-counter'),
  previewRotate: $('#preview-rotate'),
  previewAutoPlay: $('#preview-autoplay'),
  autoplayInterval: $('#autoplay-interval'),
  toastContainer: $('#toast-container'),
  settingsOverlay: $('#settings-overlay'),
  settingsRoot: $('#settings-root'),
  settingsRootError: $('#settings-root-error'),
  settingsPort: $('#settings-port'),
  settingsPortError: $('#settings-port-error'),
  settingsBind: $('#settings-bind'),
  settingsBindError: $('#settings-bind-error'),
  settingsWhitelist: $('#settings-whitelist'),
  settingsWhitelistError: $('#settings-whitelist-error'),
  settingsSave: $('#settings-save'),
  settingsCancel: $('#settings-cancel'),
  settingsClose: $('#settings-close'),
  // Change password
  passwordOverlay: $('#password-overlay'),
  passwordCurrent: $('#password-current'),
  passwordNew: $('#password-new'),
  passwordConfirm: $('#password-confirm'),
  passwordCurrentError: $('#password-current-error'),
  passwordNewError: $('#password-new-error'),
  passwordConfirmError: $('#password-confirm-error'),
  passwordSave: $('#password-save'),
  passwordCancel: $('#password-cancel'),
  passwordClose: $('#password-close'),
  // File operations
  contextMenu: $('#context-menu'),
  ctxCanvas: $('#ctx-canvas'),
  ctxRename: $('#ctx-rename'),
  ctxDownload: $('#ctx-download'),
  ctxMove: $('#ctx-move'),
  ctxAi: $('#ctx-ai'),
  ctxAiSub: $('#ctx-ai-sub'),
  ctxDelete: $('#ctx-delete'),
  dialogOverlay: $('#dialog-overlay'),
  dialogTitle: $('#dialog-title'),
  dialogInput: $('#dialog-input'),
  dialogError: $('#dialog-error'),
  dialogConfirm: $('#dialog-confirm'),
  dialogCancel: $('#dialog-cancel'),
  dialogClose: $('#dialog-close'),
  moveOverlay: $('#move-overlay'),
  moveTitle: $('#move-title'),
  moveTree: $('#move-tree'),
  moveCurrent: $('#move-current'),
  moveConfirm: $('#move-confirm'),
  moveCancel: $('#move-cancel'),
  moveClose: $('#move-close'),
  moveError: $('#move-error'),
  newFolderBtn: $('#new-folder-btn'),
  uploadBtn: $('#upload-btn'),
  uploadInput: $('#upload-input'),
  // Batch operations
  batchBar: $('#batch-bar'),
  batchCount: $('#batch-count'),
  batchRenameBtn: $('#batch-rename-btn'),
  batchDeleteBtn: $('#batch-delete-btn'),
  batchMoveBtn: $('#batch-move-btn'),
  batchClearBtn: $('#batch-clear-btn'),
  batchRenameOverlay: $('#batch-rename-overlay'),
  batchRenameMode: $('#batch-rename-mode'),
  batchRenameArgs: $('#batch-rename-args'),
  batchRenameError: $('#batch-rename-error'),
  batchRenameConfirm: $('#batch-rename-confirm'),
  batchRenameCancel: $('#batch-rename-cancel'),
  batchRenameClose: $('#batch-rename-close'),
  // AI multi-image workflow dialog
  aiMultiOverlay: $('#ai-multi-overlay'),
  aiMultiTitle: $('#ai-multi-title'),
  aiMultiHint: $('#ai-multi-hint'),
  aiMultiSlots: $('#ai-multi-slots'),
  aiMultiError: $('#ai-multi-error'),
  aiMultiClose: $('#ai-multi-close'),
  aiMultiCancel: $('#ai-multi-cancel'),
  aiMultiConfirm: $('#ai-multi-confirm'),
  // Batch image processing
  ctxBatchImages: $('#ctx-batch-images'),
  batchImgOverlay: $('#batch-img-overlay'),
  batchImgTitle: $('#batch-img-title'),
  batchImgClose: $('#batch-img-close'),
  batchList: $('#batch-list'),
  batchPreviewWrap: $('#batch-preview-wrap'),
  batchPreviewInfo: $('#batch-preview-info'),
  biWidth: $('#bi-width'),
  biWidthAuto: $('#bi-width-auto'),
  biHeight: $('#bi-height'),
  biHeightAuto: $('#bi-height-auto'),
  biCrop: $('#bi-crop'),
  biPadField: $('#bi-pad-field'),
  biPadColor: $('#bi-pad-color'),
  biFormat: $('#bi-format'),
  biQuality: $('#bi-quality'),
  biQualityVal: $('#bi-quality-val'),
  biRename: $('#bi-rename'),
  biRenameStart: $('#bi-rename-start'),
  biNamePreview: $('#bi-name-preview'),
  biOutput: $('#bi-output'),
  biTargetRow: $('#bi-target-row'),
  biTargetPath: $('#bi-target-path'),
  biPickDir: $('#bi-pick-dir'),
  biProgressWrap: $('#bi-progress-wrap'),
  biProgress: $('#bi-progress'),
  biProgressText: $('#bi-progress-text'),
  biCancel: $('#bi-cancel'),
  biError: $('#bi-error'),
  biStart: $('#bi-start'),
  // P1 extras
  biFocal: $('#bi-focal'),
  biRotL: $('#bi-rot-l'),
  biRotR: $('#bi-rot-r'),
  biFlipH: $('#bi-flip-h'),
  biFlipV: $('#bi-flip-v'),
  biPrepReset: $('#bi-prep-reset'),
  biPrepInfo: $('#bi-prep-info'),
  biWmLayers: $('#bi-wm-layers'),
  biWmAddText: $('#bi-wm-add-text'),
  biWmAddImg: $('#bi-wm-add-img'),
  biWmImgInput: $('#bi-wm-img-input'),
  biBorderEnable: $('#bi-border-enable'),
  biBorderColor: $('#bi-border-color'),
  biBorderW: $('#bi-border-w'),
  biBorderRadius: $('#bi-border-radius'),
  biKeepExif: $('#bi-keep-exif'),
  biPreset: $('#bi-preset'),
  biPresetSave: $('#bi-preset-save'),
  biPresetDel: $('#bi-preset-del'),
  biCompare: $('#bi-compare'),
  biResetFocal: $('#bi-reset-focal'),
  biPreviewName: $('#bi-preview-name'),
  // P2 extras
  biUnit: $('#bi-unit'),
  biHq: $('#bi-hq'),
  biWidthLabel: $('#bi-width-label'),
  biHeightLabel: $('#bi-height-label'),
  biToAi: $('#bi-to-ai'),
  // P3 extras
  biPresetExport: $('#bi-preset-export'),
  biPresetImport: $('#bi-preset-import'),
  biPresetImportInput: $('#bi-preset-import-input'),
  biHistory: $('#bi-history'),
  biHistoryOverlay: $('#bi-history-overlay'),
  biHistoryClose: $('#bi-history-close'),
  biHistoryList: $('#bi-history-list'),
  biHistoryClear: $('#bi-history-clear'),
  biSharedPreset: $('#bi-shared-preset'),
  biSharedLoad: $('#bi-shared-load'),
  biSharedPublish: $('#bi-shared-publish'),
  biSharedDefault: $('#bi-shared-default'),
  // Image editor
  previewImageEdit: $('#preview-image-edit'),
  imgEditOverlay: $('#image-edit-overlay'),
  imgEditTitle: $('#image-edit-title'),
  imgEditClose: $('#image-edit-close'),
  ieCanvas: $('#ie-canvas'),
  ieCanvasWrap: $('#ie-canvas-wrap'),
  ieRotateL: $('#ie-rotate-l'),
  ieRotateR: $('#ie-rotate-r'),
  ieFlipH: $('#ie-flip-h'),
  ieFlipV: $('#ie-flip-v'),
  ieCrop: $('#ie-crop'),
  ieCropApply: $('#ie-crop-apply'),
  ieCropCancel: $('#ie-crop-cancel'),
  ieReset: $('#ie-reset'),
  ieInfo: $('#ie-info'),
  ieFormat: $('#ie-format'),
  ieQuality: $('#ie-quality'),
  ieError: $('#ie-error'),
  ieSave: $('#ie-save'),
  ieSaveAs: $('#ie-save-as'),
};

// === File Type Helpers ===
const FILE_ICONS = {
  folder: '\u{1F4C1}',
  image: '\u{1F5BC}',
  video: '\u{1F3AC}',
  audio: '\u{1F3B5}',
  text: '\u{1F4C4}',
  pdf: '\u{1F4D5}',
  archive: '\u{1F4E6}',
  other: '\u{1F4CE}',
};

const IMAGE_EXTS = ['jpg','jpeg','png','gif','webp','svg','bmp','ico'];
const VIDEO_EXTS = ['mp4','webm','ogg','mov','avi','mkv'];
const AUDIO_EXTS = ['mp3','wav','flac','aac','m4a','opus'];
const TEXT_EXTS = ['txt','md','csv','log','html','css','js','json','xml','ts','jsx','tsx',
  'py','rb','java','c','cpp','h','rs','go','php','sql','sh','bat',
  'yml','yaml','toml','ini','cfg','conf','env'];

function getExt(name) {
  return name.split('.').pop()?.toLowerCase();
}

function getFileCategory(entry) {
  if (entry.type === 'directory') return 'folder';
  const ext = getExt(entry.name);
  if (!ext) return 'other';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXTS.includes(ext)) return 'text';
  if (['zip','tar','gz','7z','rar'].includes(ext)) return 'archive';
  return 'other';
}

function isPreviewable(category) {
  return ['image','video','audio','text','pdf'].includes(category);
}

// === Toast Notifications ===
function showToast(message, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close">&times;</button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  dom.toastContainer.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

// === API Calls ===
async function apiBrowse(path) {
  const res = await authFetch(`/api/browse?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `HTTP ${res.status}`);
    console.error(`[apiBrowse] path="${path}" failed:`, err.message);
    throw err;
  }
  return res.json();
}

async function apiGetJson(url) {
  const res = await authFetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiPostJson(url, body) {
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function getFilePath(entry) {
  return state.currentPath ? `${state.currentPath}/${entry.name}` : entry.name;
}

function getFileUrl(entry) {
  return `/api/file?path=${encodeURIComponent(getFilePath(entry))}`;
}

function getThumbUrl(entry) {
  return `/api/thumb?path=${encodeURIComponent(getFilePath(entry))}`;
}

// === File Operations API ===
async function apiMkdir(parentPath, name) {
  const res = await authFetch('/api/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: parentPath, name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiRename(targetPath, newName) {
  const res = await authFetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath, newName }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiDelete(targetPath) {
  const res = await authFetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiMove(sourcePath, targetDir) {
  const res = await authFetch('/api/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: sourcePath, targetDir }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiUpload(formData) {
  const res = await authFetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiSave(filePath, content) {
  const res = await authFetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiChangePassword(currentPassword, newPassword) {
  const res = await authFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let data = {};
    try { data = JSON.parse(text); } catch (_) {}
    const error = data.error || (res.status === 401 ? '登录已过期，请重新登录' : `请求失败 (${res.status})`);
    throw new Error(error);
  }
  return res.json().catch(() => ({}));
}

// === Breadcrumb ===
function renderBreadcrumb() {
  dom.breadcrumb.innerHTML = '';
  const parts = state.currentPath ? state.currentPath.split('/') : [];

  const root = document.createElement('span');
  root.className = 'breadcrumb-segment';
  root.textContent = 'Root';
  root.addEventListener('click', () => navigateTo(''));
  dom.breadcrumb.appendChild(root);

  parts.forEach((part, i) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '›';
    dom.breadcrumb.appendChild(sep);

    const seg = document.createElement('span');
    seg.className = 'breadcrumb-segment';
    seg.textContent = part;
    if (i === parts.length - 1) seg.classList.add('current');
    const targetPath = parts.slice(0, i + 1).join('/');
    seg.addEventListener('click', () => navigateTo(targetPath));
    dom.breadcrumb.appendChild(seg);
  });
}

// === File List ===
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function renderFileList(entries) {
  dom.fileList.innerHTML = '';

  if (entries.length === 0) {
    dom.fileList.innerHTML = `<div class="empty-placeholder">
      <span class="icon">\u{1F4C2}</span>
      <p>此文件夹为空</p>
    </div>`;
    dom.itemCount.textContent = '0 项';
    return;
  }

  const folderCount = entries.filter(e => e.type === 'directory').length;
  const fileCount = entries.length - folderCount;
  dom.itemCount.textContent = `${folderCount} 个文件夹, ${fileCount} 个文件`;

  const frag = document.createDocumentFragment();
  entries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'file-card';
    const category = getFileCategory(entry);
    const fileUrl = entry.type === 'file' ? getFileUrl(entry) : null;
    const entryPath = getFilePath(entry);

    if (state.selected.has(entryPath)) card.classList.add('selected');

    // Selection checkbox
    const check = document.createElement('div');
    check.className = 'card-check';
    check.textContent = '✓';
    card.appendChild(check);

    // Thumbnail area
    const thumb = document.createElement('div');
    thumb.className = `file-card-thumb ${category}`;

    if (category === 'image' && fileUrl) {
      const img = document.createElement('img');
      img.src = getThumbUrl(entry);
      img.loading = 'lazy';
      img.alt = entry.name;
      img.addEventListener('error', () => {
        img.style.display = 'none';
        thumb.innerHTML = FILE_ICONS.image;
        thumb.classList.add('fallback-icon');
      });
      thumb.appendChild(img);
    } else if (category === 'video' && fileUrl) {
      thumb.innerHTML = FILE_ICONS.video;
      thumb.classList.add('fallback-icon');
      thumb.dataset.videoUrl = fileUrl;
      thumb.dataset.videoThumb = 'pending';
    } else {
      thumb.innerHTML = FILE_ICONS[category];
      thumb.classList.add('fallback-icon');
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'file-card-name';
    nameEl.title = entry.name;
    nameEl.textContent = entry.name;

    const meta = document.createElement('div');
    meta.className = 'file-card-meta';
    meta.textContent = entry.type === 'file' ? formatSize(entry.size) : '';

    card.appendChild(thumb);
    card.appendChild(nameEl);
    card.appendChild(meta);

    card.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click: toggle selection
        e.stopPropagation();
        toggleSelect(entryPath, card);
      } else {
        // Single click: select this item only
        clearSelection();
        state.selected.add(entryPath);
        card.classList.add('selected');
        updateBatchBar();
      }
    });

    card.addEventListener('dblclick', () => {
      // Double click: open
      clearSelection();
      if (entry.type === 'directory') {
        navigateTo(entryPath);
      } else {
        openPreview(entry);
      }
    });

    card.addEventListener('contextmenu', (e) => {
      if (state.selected.size > 0 && state.selected.has(entryPath)) {
        showContextMenu(e, entry);
      } else {
        clearSelection();
        card.classList.add('selected');
        state.selected.add(entryPath);
        updateBatchBar();
        showContextMenu(e, entry);
      }
    });

    // Long press for context menu on touch devices
    let longPressTimer = null;
    let touchStartPos = null;
    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { clearTimeout(longPressTimer); return; }
      touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      longPressTimer = setTimeout(() => {
        if (dragState && dragState.started) return;
        const ev = new MouseEvent('contextmenu', {
          clientX: touchStartPos.x, clientY: touchStartPos.y, bubbles: true, cancelable: true
        });
        e.target.dispatchEvent(ev);
      }, 600);
    }, { passive: false });
    card.addEventListener('touchmove', (e) => {
      if (touchStartPos) {
        const dx = Math.abs(e.touches[0].clientX - touchStartPos.x);
        const dy = Math.abs(e.touches[0].clientY - touchStartPos.y);
        if (dx > 5 || dy > 5) { clearTimeout(longPressTimer); longPressTimer = null; }
      }
    });
    card.addEventListener('touchend', () => { clearTimeout(longPressTimer); longPressTimer = null; });
    card.addEventListener('touchcancel', () => { clearTimeout(longPressTimer); longPressTimer = null; });

    frag.appendChild(card);
  });

  dom.fileList.appendChild(frag);

  updateBatchBar();

  // Lazy-load video thumbnails
  requestAnimationFrame(() => generateVideoThumbnails());
}

function generateVideoThumbnails() {
  const pending = dom.fileList.querySelectorAll('[data-video-thumb="pending"]');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const el = entry.target;
        observer.unobserve(el);
        generateVideoThumb(el);
      }
    });
  }, { rootMargin: '200px' });

  pending.forEach((el) => observer.observe(el));
}

function generateVideoThumb(thumbEl) {
  const url = thumbEl.dataset.videoUrl;
  if (!url || thumbEl.dataset.videoThumb !== 'pending') return;
  thumbEl.dataset.videoThumb = 'loading';

  const video = document.createElement('video');
  video.src = url;
  video.preload = 'metadata';
  video.muted = true;
  video.crossOrigin = 'anonymous';

  const cleanup = () => {
    video.removeEventListener('loadeddata', onLoaded);
    video.removeEventListener('error', onError);
  };

  const onLoaded = () => {
    cleanup();
    video.currentTime = Math.min(2, video.duration / 3 || 2);
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

        thumbEl.innerHTML = '';
        thumbEl.classList.remove('fallback-icon');
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = '';
        thumbEl.appendChild(img);
      } catch (_) {
        // Canvas tainted, keep icon
      }
      video.remove();
    }, { once: true });
  };

  const onError = () => {
    cleanup();
    thumbEl.dataset.videoThumb = 'failed';
    video.remove();
  };

  video.addEventListener('loadeddata', onLoaded, { once: true });
  video.addEventListener('error', onError, { once: true });

  // Timeout fallback
  setTimeout(() => {
    if (thumbEl.dataset.videoThumb === 'loading') {
      cleanup();
      thumbEl.dataset.videoThumb = 'failed';
      video.remove();
    }
  }, 8000);
}

function showLoading() {
  dom.fileList.innerHTML = `<div class="loading-placeholder">
    <div class="spinner"></div>
    <p>加载中...</p>
  </div>`;
  dom.itemCount.textContent = '';
}

function showError(message) {
  dom.fileList.innerHTML = `<div class="error-placeholder">
    <span class="icon">⚠</span>
    <p>${escapeHtml(message)}</p>
  </div>`;
  dom.itemCount.textContent = '';
}

// === Directory Tree ===
function renderTree() {
  const loadRoot = async () => {
    try {
      const data = await apiBrowse('');
      state.treeNodes[''] = { expanded: true, loaded: true, children: data.entries };
      buildTreeDOM();
      // After building, apply active state
      await ensureTreePath(state.currentPath);
    } catch (err) {
      dom.tree.innerHTML = `<div class="tree-error">加载失败: ${escapeHtml(err.message)}</div>`;
    }
  };
  loadRoot();
}

function buildTreeDOM() {
  dom.tree.innerHTML = '';
  const root = state.treeNodes[''];
  if (!root || !root.children) return;

  root.children.forEach((entry) => {
    if (entry.type === 'directory') {
      dom.tree.appendChild(createTreeNode(entry.name, '', entry.name));
    }
  });
}

function createTreeNode(name, parentPath, fullPath) {
  const node = document.createElement('div');
  node.className = 'tree-node';
  node.dataset.path = fullPath;

  const content = document.createElement('div');
  content.className = 'tree-node-content';

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '\u{1F4C1}';

  const label = document.createElement('span');
  label.className = 'tree-name';
  label.textContent = name;

  content.appendChild(toggle);
  content.appendChild(icon);
  content.appendChild(label);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'tree-children collapsed';

  node.appendChild(content);
  node.appendChild(childrenContainer);

  // Click label/icon → navigate to that directory
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateTo(fullPath);
  });
  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateTo(fullPath);
  });

  // Click toggle arrow → expand/collapse (don't navigate)
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNode(fullPath, childrenContainer, toggle);
  });

  return node;
}

async function toggleNode(fullPath, container, toggleEl) {
  if (container.classList.contains('collapsed')) {
    // Expand
    container.classList.remove('collapsed');
    toggleEl.classList.add('expanded');

    const nodeData = state.treeNodes[fullPath];
    if (!nodeData || !nodeData.loaded) {
      container.innerHTML = '<div class="tree-spinner"></div>';

      try {
        const data = await apiBrowse(fullPath);
        const dirs = data.entries.filter(e => e.type === 'directory');
        state.treeNodes[fullPath] = { expanded: true, loaded: true, children: dirs };

        container.innerHTML = '';
        dirs.forEach((child) => {
          const childPath = `${fullPath}/${child.name}`;
          container.appendChild(createTreeNode(child.name, fullPath, childPath));
        });

        if (dirs.length === 0) {
          container.innerHTML = '';
          toggleEl.classList.add('empty');
        }
      } catch (err) {
        container.innerHTML = '<div class="tree-error">加载失败</div>';
        showToast(`加载文件夹失败: ${err.message}`);
      }
    }
  } else {
    // Collapse
    container.classList.add('collapsed');
    toggleEl.classList.remove('expanded');
  }
}

// Ensure tree nodes along currentPath are loaded, expanded, and highlighted
async function ensureTreePath(path) {
  if (!path) return;

  const parts = path.split('/');
  let currentPath = '';

  for (let i = 0; i < parts.length; i++) {
    currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

    // Check if this node is loaded
    let nodeData = state.treeNodes[currentPath];
    if (!nodeData || !nodeData.loaded) {
      // Load it
      try {
        const data = await apiBrowse(currentPath);
        const dirs = data.entries.filter(e => e.type === 'directory');
        state.treeNodes[currentPath] = { expanded: true, loaded: true, children: dirs };
      } catch (_) {
        break; // Can't go further
      }
    }

    // Expand the parent node in the DOM
    if (i === 0) {
      // Root level: find in #tree
      expandTreeNodeInDOM(dom.tree, parts[i], currentPath);
    } else {
      // Find parent's children container
      const parentPath = parts.slice(0, i).join('/');
      const parentContainer = findTreeChildrenContainer(parentPath);
      if (parentContainer) {
        expandTreeNodeInDOM(parentContainer, parts[i], currentPath);
      }
    }
  }

  // Now highlight
  updateTreeActiveDOM();
}

function findTreeChildrenContainer(path) {
  if (!path) return dom.tree;
  const parts = path.split('/');
  let container = dom.tree;

  for (const part of parts) {
    const nodeContents = container.querySelectorAll(':scope > .tree-node > .tree-node-content');
    let found = false;
    for (const content of nodeContents) {
      const label = content.querySelector('.tree-name');
      if (label && label.textContent === part) {
        const childrenContainer = content.parentElement.querySelector('.tree-children');
        if (childrenContainer) {
          container = childrenContainer;
          found = true;
        }
        break;
      }
    }
    if (!found) return null;
  }
  return container;
}

function expandTreeNodeInDOM(container, name, fullPath) {
  const nodeData = state.treeNodes[fullPath];
  const nodeContents = container.querySelectorAll(':scope > .tree-node > .tree-node-content');
  for (const content of nodeContents) {
    const label = content.querySelector('.tree-name');
    if (label && label.textContent === name) {
      const childrenContainer = content.parentElement.querySelector('.tree-children');
      if (childrenContainer && childrenContainer.classList.contains('collapsed')) {
        childrenContainer.classList.remove('collapsed');
        const toggle = content.querySelector('.tree-toggle');
        if (toggle) toggle.classList.add('expanded');

        // Populate children if loaded but not rendered
        if (nodeData && nodeData.loaded && nodeData.children &&
            childrenContainer.children.length === 0) {
          nodeData.children.forEach((child) => {
            const childPath = `${fullPath}/${child.name}`;
            childrenContainer.appendChild(createTreeNode(child.name, fullPath, childPath));
          });
          if (nodeData.children.length === 0) {
            childrenContainer.innerHTML = '';
            const toggle = content.querySelector('.tree-toggle');
            if (toggle) toggle.classList.add('empty');
          }
        } else if (childrenContainer.children.length === 0) {
          // Need to load
          childrenContainer.innerHTML = '<div class="tree-spinner"></div>';
          apiBrowse(fullPath).then(data => {
            const dirs = data.entries.filter(e => e.type === 'directory');
            state.treeNodes[fullPath] = { expanded: true, loaded: true, children: dirs };
            childrenContainer.innerHTML = '';
            dirs.forEach((child) => {
              const childPath = `${fullPath}/${child.name}`;
              childrenContainer.appendChild(createTreeNode(child.name, fullPath, childPath));
            });
            if (dirs.length === 0) {
              childrenContainer.innerHTML = '';
              const toggle = content.querySelector('.tree-toggle');
              if (toggle) toggle.classList.add('empty');
            }
          }).catch(() => {
            childrenContainer.innerHTML = '<div class="tree-error">加载失败</div>';
          });
        }
      }
      return;
    }
  }
}

function updateTreeActiveDOM() {
  $$('.tree-node-content').forEach(el => el.classList.remove('active'));
  if (!state.currentPath) return;

  const parts = state.currentPath.split('/');
  let container = dom.tree;

  for (let i = 0; i < parts.length; i++) {
    const nodeContents = container.querySelectorAll(':scope > .tree-node > .tree-node-content');
    let found = false;
    for (const content of nodeContents) {
      const label = content.querySelector('.tree-name');
      if (label && label.textContent === parts[i]) {
        content.classList.add('active');
        const childrenContainer = content.parentElement.querySelector('.tree-children');
        if (childrenContainer) {
          container = childrenContainer;
        }
        found = true;
        break;
      }
    }
    if (!found) break;
  }
}

// === Navigation ===
async function navigateTo(path) {
  state.currentPath = path;
  window.location.hash = path ? `#/${path}` : '#';
  clearSelection();

  renderBreadcrumb();
  showLoading();

  // Ensure tree path is loaded and highlighted
  await ensureTreePath(path);

  try {
    const data = await apiBrowse(path);
    state.entries = data.entries;
    applySearchFilter();
  } catch (err) {
    showError(err.message);
    showToast(`加载目录失败: ${err.message}`);
  }
}

// === Search / Filter ===
function sortEntries(entries) {
  const [key, order] = state.sortKey.split('-');
  if (key === 'default') return entries;

  const dirs = entries.filter(e => e.type === 'directory');
  const files = entries.filter(e => e.type !== 'directory');

  const cmp = (a, b) => {
    let va, vb;
    switch (key) {
      case 'name':
        va = a.name.toLowerCase();
        vb = b.name.toLowerCase();
        return va.localeCompare(vb, undefined, { numeric: true });
      case 'mtime':
      case 'birthtime':
        va = new Date(a[key] || 0).getTime();
        vb = new Date(b[key] || 0).getTime();
        return va - vb;
      case 'size':
        va = a.size || 0;
        vb = b.size || 0;
        return va - vb;
      default:
        return 0;
    }
  };

  const fullCmp = (a, b) => order === 'desc' ? -cmp(a, b) : cmp(a, b);
  dirs.sort(fullCmp);
  files.sort(fullCmp);

  return [...dirs, ...files];
}

function applySearchFilter() {
  const query = dom.searchInput.value.trim().toLowerCase();
  const filtered = query
    ? state.entries.filter(e => e.name.toLowerCase().includes(query))
    : [...state.entries];
  renderFileList(sortEntries(filtered));
}

dom.searchInput.addEventListener('input', applySearchFilter);
dom.sortSelect.addEventListener('change', () => {
  state.sortKey = dom.sortSelect.value;
  applySearchFilter();
});

// === Preview ===
async function openPreview(entry) {
  const category = getFileCategory(entry);
  if (!isPreviewable(category)) {
    showToast('不支持预览此文件类型', 'error');
    return;
  }

  state.previewFile = entry;
  const fileUrl = getFileUrl(entry);
  dom.previewTitle.textContent = entry.name;
  dom.previewContent.innerHTML = '<div class="spinner"></div>';
  dom.previewDownload.href = fileUrl;
  dom.previewDownload.download = entry.name;
  dom.previewEdit.classList.toggle('hidden', category !== 'text');
  dom.previewImageEdit.classList.toggle('hidden', category !== 'image');
  dom.previewOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    switch (category) {
      case 'image':
        renderImagePreview(entry);
        break;
      case 'video':
        renderVideoPreview(fileUrl);
        break;
      case 'audio':
        renderAudioPreview(fileUrl, entry.name);
        break;
      case 'text':
        if (getExt(entry.name) === 'md') {
          await renderMarkdownPreview(fileUrl);
        } else {
          await renderTextPreview(fileUrl);
        }
        break;
      case 'pdf':
        renderPdfPreview(fileUrl);
        break;
    }
  } catch (err) {
    dom.previewContent.innerHTML = `<div class="preview-error">
      <span class="icon">⚠</span>
      <p>预览失败: ${escapeHtml(err.message)}</p>
    </div>`;
  }
}

function closePreview() {
  stopAutoPlay();
  dom.previewOverlay.classList.add('hidden');
  dom.previewContainer.classList.remove('image-fullscreen');
  dom.previewContent.innerHTML = '';
  document.body.style.overflow = '';
  state.previewFile = null;
  if (state._imageNav) {
    if (state._imageNav.onResize) window.removeEventListener('resize', state._imageNav.onResize);
    if (state._imageNav.cleanup) state._imageNav.cleanup();
    state._imageNav = null;
  }
  dom.previewEdit.classList.add('hidden');
  dom.previewImageEdit.classList.add('hidden');
  dom.previewRotate.classList.add('hidden');
  dom.previewAutoPlay.classList.add('hidden');
  dom.autoplayInterval.classList.add('hidden');
  dom.imageNavPrev.classList.add('hidden');
  dom.imageNavNext.classList.add('hidden');
  dom.imageCounter.classList.add('hidden');
}

function renderImagePreview(entry) {
  // Build list of images in the current folder
  const imageList = sortEntries([...state.entries]).filter(e => e.type === 'file' && getFileCategory(e) === 'image');
  let currentIndex = imageList.findIndex(e => getFilePath(e) === getFilePath(entry));
  if (currentIndex < 0) currentIndex = 0;

  const showImage = (index) => {
    currentIndex = index;
    const e = imageList[index];
    const url = getFileUrl(e);
    state.previewFile = e;
    dom.previewTitle.textContent = e.name;
    dom.previewDownload.href = url;
    dom.previewDownload.download = e.name;
    dom.imageCounter.textContent = `${index + 1} / ${imageList.length}`;
    dom.imageNavPrev.classList.toggle('hidden', index <= 0);
    dom.imageNavNext.classList.toggle('hidden', index >= imageList.length - 1);

    img.src = url;
    img.alt = e.name;
    scale = 0.01; posX = 0; posY = 0; rotation = 0;
    updateTransform();
    wrapper.style.cursor = 'grab';
    dom.previewRotate.classList.remove('rotated');
  };

  // --- Build fullscreen viewer ---
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab;';

  const img = document.createElement('img');
  img.draggable = false;
  img.style.cssText = 'position:absolute;transition:transform 0.1s ease;user-select:none;pointer-events:none;';

  let scale = 0.01, posX = 0, posY = 0, rotation = 0, baseScale = 0.01;
  let dragging = false, lastX = 0, lastY = 0;

  const updateTransform = () => {
    img.style.transform = `translate(${posX}px, ${posY}px) scale(${scale}) rotate(${rotation}deg)`;
  };

  // Wheel zoom
  wrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = img.getBoundingClientRect();
    const cx = e.clientX - (rect.left + rect.width / 2);
    const cy = e.clientY - (rect.top + rect.height / 2);
    const oldScale = scale;
    scale = Math.min(8, Math.max(0.1, scale - e.deltaY * 0.002));
    const ratio = scale / oldScale;
    posX = posX * ratio - cx * (ratio - 1);
    posY = posY * ratio - cy * (ratio - 1);
    updateTransform();
  }, { passive: false });

  // Drag pan
  wrapper.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    wrapper.style.cursor = 'grabbing';
    e.preventDefault();
  });

  const onMouseMove = (e) => {
    if (!dragging || !state.previewFile) return;
    posX += e.clientX - lastX;
    posY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    img.style.transition = 'none';
    updateTransform();
  };

  const onMouseUp = () => {
    if (dragging) {
      dragging = false;
      wrapper.style.cursor = scale > baseScale ? 'grab' : 'default';
      img.style.transition = 'transform 0.1s ease';
    }
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  wrapper.addEventListener('dblclick', () => {
    fitToScreen();
    wrapper.style.cursor = 'grab';
  });

  img.addEventListener('load', () => {
    fitToScreen();
  });

  img.addEventListener('error', () => {
    dom.previewContent.innerHTML = `<div class="preview-error">
      <span class="icon">\u{1F5BC}</span><p>图片加载失败</p></div>`;
  });

  img.addEventListener('transitionend', () => {
    if (scale < baseScale) { fitToScreen(); wrapper.style.cursor = 'grab'; }
  });

  const onResize = () => {
    if (!dom.previewOverlay.classList.contains('hidden')) fitToScreen();
  };
  window.addEventListener('resize', onResize);

  wrapper.appendChild(img);

  // --- Update overlay to fullscreen image mode ---
  dom.previewContainer.classList.add('image-fullscreen');
  dom.previewTitle.textContent = entry.name;
  dom.previewDownload.href = getFileUrl(entry);
  dom.imageCounter.textContent = `${currentIndex + 1} / ${imageList.length}`;
  dom.imageNavPrev.classList.toggle('hidden', currentIndex <= 0);
  dom.imageNavNext.classList.toggle('hidden', currentIndex >= imageList.length - 1);
  dom.imageNavPrev.classList.remove('hidden');
  dom.imageNavNext.classList.remove('hidden');
  dom.imageCounter.classList.remove('hidden');
  dom.previewEdit.classList.add('hidden');
  dom.previewRotate.classList.remove('hidden');
  dom.previewRotate.classList.remove('rotated');
  dom.previewAutoPlay.classList.remove('hidden');
  dom.autoplayInterval.classList.remove('hidden');

  dom.previewContent.innerHTML = '';
  dom.previewContent.appendChild(wrapper);
  showImage(currentIndex);

  // Recalculate scale to fit viewport after rotation
  const fitToScreen = () => {
    if (!img.naturalWidth) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isVertical = rotation === 90 || rotation === 270;
    const ew = isVertical ? img.naturalHeight : img.naturalWidth;
    const eh = isVertical ? img.naturalWidth : img.naturalHeight;
    scale = Math.min((vw * 0.95) / ew, (vh * 0.95) / eh, 1);
    baseScale = scale;
    posX = 0; posY = 0;
    updateTransform();
  };

  // Rotate handler
  dom.previewRotate.onclick = () => {
    rotation = (rotation + 90) % 360;
    dom.previewRotate.classList.toggle('rotated', rotation === 90 || rotation === 270);
    fitToScreen();
  };

  // --- Keyboard navigation ---
  state._imageNav = {
    showImage,
    imageList,
    index: currentIndex,
    onResize,
    cleanup: () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    },
  };
}

function navigateImage(direction) {
  if (!state._imageNav || !state._imageNav.imageList.length) return;
  stopAutoPlay();
  const { showImage, imageList } = state._imageNav;
  let idx = state._imageNav.index + direction;
  if (idx < 0) idx = imageList.length - 1;
  if (idx >= imageList.length) idx = 0;
  state._imageNav.index = idx;
  showImage(idx);
}

function startAutoPlay() {
  if (!state._imageNav) return;
  stopAutoPlay();
  const seconds = Math.max(1, parseInt(dom.autoplayInterval.value) || 3);
  dom.autoplayInterval.value = seconds;
  state._imageNav._autoplayTimer = setInterval(() => {
    if (!state._imageNav || !state._imageNav.imageList.length) { stopAutoPlay(); return; }
    let idx = state._imageNav.index + 1;
    if (idx >= state._imageNav.imageList.length) idx = 0;
    state._imageNav.index = idx;
    state._imageNav.showImage(idx);
  }, seconds * 1000);
  dom.previewAutoPlay.textContent = '⏸'; // pause icon
  dom.previewAutoPlay.classList.add('active');
}

function stopAutoPlay() {
  if (state._imageNav && state._imageNav._autoplayTimer) {
    clearInterval(state._imageNav._autoplayTimer);
    state._imageNav._autoplayTimer = null;
  }
  dom.previewAutoPlay.textContent = '▶'; // play icon
  dom.previewAutoPlay.classList.remove('active');
}

function toggleAutoPlay() {
  if (state._imageNav && state._imageNav._autoplayTimer) {
    stopAutoPlay();
  } else {
    startAutoPlay();
  }
}

function renderVideoPreview(url) {
  const video = document.createElement('video');
  video.src = url;
  video.controls = true;
  video.autoplay = true;
  video.addEventListener('error', () => {
    dom.previewContent.innerHTML = `<div class="preview-error">
      <span class="icon">\u{1F3AC}</span><p>视频加载失败</p></div>`;
  });
  dom.previewContent.innerHTML = '';
  dom.previewContent.appendChild(video);
}

function renderAudioPreview(url, name) {
  const wrapper = document.createElement('div');
  wrapper.className = 'audio-visual';

  const icon = document.createElement('div');
  icon.className = 'audio-icon';
  icon.textContent = '\u{1F3B5}';

  const title = document.createElement('div');
  title.style.fontSize = '16px';
  title.style.color = 'var(--text-primary)';
  title.textContent = name;

  const audio = document.createElement('audio');
  audio.src = url;
  audio.controls = true;
  audio.autoplay = true;
  audio.style.width = '100%';
  audio.style.maxWidth = '500px';

  wrapper.appendChild(icon);
  wrapper.appendChild(title);
  wrapper.appendChild(audio);
  dom.previewContent.innerHTML = '';
  dom.previewContent.appendChild(wrapper);
}

async function renderTextPreview(url) {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  // View mode
  const viewArea = document.createElement('div');
  viewArea.id = 'text-view';
  const pre = document.createElement('pre');
  pre.className = 'line-numbers';
  const code = document.createElement('code');
  text.split('\n').forEach((line) => {
    const span = document.createElement('span');
    span.textContent = line || '​'; // zero-width space for empty lines
    code.appendChild(span);
  });
  pre.appendChild(code);
  viewArea.appendChild(pre);

  // Also update save: rebuild text from lines
  const getTextFromEditor = () => textarea.value;

  // Edit mode
  const editArea = document.createElement('div');
  editArea.id = 'text-edit';
  editArea.className = 'hidden';

  const toolbar = document.createElement('div');
  toolbar.className = 'preview-edit-toolbar';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = '保存';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = '取消';
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(cancelBtn);

  const textarea = document.createElement('textarea');
  textarea.className = 'preview-editor';
  textarea.value = text;

  editArea.appendChild(toolbar);
  editArea.appendChild(textarea);

  dom.previewContent.innerHTML = '';
  dom.previewContent.appendChild(viewArea);
  dom.previewContent.appendChild(editArea);

  // Edit button in header
  dom.previewEdit.classList.remove('hidden');

  const enterEdit = () => {
    viewArea.classList.add('hidden');
    editArea.classList.remove('hidden');
    textarea.focus();
    dom.previewEdit.classList.add('hidden');
  };

  const saveEdit = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';
    try {
      const fp = getFilePath(state.previewFile);
      await apiSave(fp, textarea.value);
      code.innerHTML = '';
      textarea.value.split('\n').forEach((line) => {
        const span = document.createElement('span');
        span.textContent = line || '​';
        code.appendChild(span);
      });
      showToast('文件已保存', 'success');
      exitEdit();
    } catch (err) {
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  };

  const exitEdit = () => {
    editArea.classList.add('hidden');
    viewArea.classList.remove('hidden');
    dom.previewEdit.classList.remove('hidden');
  };

  dom.previewEdit.replaceWith(dom.previewEdit.cloneNode(true));
  dom.previewEdit = $('#preview-edit');
  dom.previewEdit.addEventListener('click', enterEdit);
  saveBtn.addEventListener('click', saveEdit);
  cancelBtn.addEventListener('click', exitEdit);

  // Ctrl+S to save
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === 'Escape') exitEdit();
  });
}

async function renderMarkdownPreview(url) {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  // Rendered view
  const viewArea = document.createElement('div');
  viewArea.id = 'text-view';
  const mdContent = document.createElement('div');
  mdContent.className = 'markdown-body';
  window.fileManagerMarkdown.render(mdContent, text);
  viewArea.appendChild(mdContent);

  // Edit mode (same as text preview)
  const editArea = document.createElement('div');
  editArea.id = 'text-edit';
  editArea.className = 'hidden';

  const toolbar = document.createElement('div');
  toolbar.className = 'preview-edit-toolbar';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = '保存';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = '取消';
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(cancelBtn);

  const textarea = document.createElement('textarea');
  textarea.className = 'preview-editor';
  textarea.value = text;

  editArea.appendChild(toolbar);
  editArea.appendChild(textarea);

  dom.previewContent.innerHTML = '';
  dom.previewContent.appendChild(viewArea);
  dom.previewContent.appendChild(editArea);

  dom.previewEdit.classList.remove('hidden');

  const enterEdit = () => {
    viewArea.classList.add('hidden');
    editArea.classList.remove('hidden');
    textarea.focus();
    dom.previewEdit.classList.add('hidden');
  };

  const saveEdit = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';
    try {
      const fp = getFilePath(state.previewFile);
      await apiSave(fp, textarea.value);
      window.fileManagerMarkdown.render(mdContent, textarea.value);
      showToast('文件已保存', 'success');
      exitEdit();
    } catch (err) {
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  };

  const exitEdit = () => {
    editArea.classList.add('hidden');
    viewArea.classList.remove('hidden');
    dom.previewEdit.classList.remove('hidden');
  };

  dom.previewEdit.replaceWith(dom.previewEdit.cloneNode(true));
  dom.previewEdit = $('#preview-edit');
  dom.previewEdit.addEventListener('click', enterEdit);
  saveBtn.addEventListener('click', saveEdit);
  cancelBtn.addEventListener('click', exitEdit);

  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === 'Escape') exitEdit();
  });
}

function renderPdfPreview(url) {
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.title = 'PDF preview';
  dom.previewContent.innerHTML = '';
  dom.previewContent.appendChild(iframe);
}

// Close preview on overlay click (outside container)
dom.previewOverlay.addEventListener('click', (e) => {
  if (e.target === dom.previewOverlay) closePreview();
});
dom.previewClose.addEventListener('click', closePreview);
dom.imageNavPrev.addEventListener('click', () => navigateImage(-1));
dom.imageNavNext.addEventListener('click', () => navigateImage(1));
dom.previewAutoPlay.addEventListener('click', toggleAutoPlay);
dom.autoplayInterval.addEventListener('change', () => {
  if (state._imageNav && state._imageNav._autoplayTimer) {
    startAutoPlay();
  }
});

// Close overlays on Escape key (priority: context menu > dialog > move > preview > settings)
document.addEventListener('keydown', (e) => {
  // Arrow keys for image navigation (only when image preview is active)
  if (state._imageNav && !dom.previewOverlay.classList.contains('hidden')) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateImage(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateImage(1); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); dom.previewRotate.click(); return; }
    if (e.key === ' ') { e.preventDefault(); toggleAutoPlay(); return; }
  }
  if (e.key !== 'Escape') return;
  if (!dom.contextMenu.classList.contains('hidden')) {
    hideContextMenu();
  } else if (!dom.dialogOverlay.classList.contains('hidden')) {
    closeDialog();
  } else if (!dom.moveOverlay.classList.contains('hidden')) {
    closeMoveDialog();
  } else if (!dom.batchRenameOverlay.classList.contains('hidden')) {
    closeBatchRename();
  } else if (!dom.previewOverlay.classList.contains('hidden')) {
    closePreview();
  } else if (!dom.settingsOverlay.classList.contains('hidden')) {
    closeSettings();
  }
});

// === Hash Routing ===
function getPathFromHash() {
  const hash = window.location.hash;
  if (hash.startsWith('#/')) {
    const raw = hash.slice(2);
    try {
      const decoded = decodeURIComponent(raw);
      return decoded;
    } catch (_) {
      return raw;
    }
  }
  return '';
}

window.addEventListener('hashchange', () => {
  const newPath = getPathFromHash();
  if (newPath !== state.currentPath) {
    navigateTo(newPath);
  }
});

// === Settings ===
async function apiGetConfig() {
  const res = await authFetch('/api/config');
  if (!res.ok) throw new Error('获取配置失败');
  return res.json();
}

async function apiSaveConfig(config) {
  const res = await authFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '保存配置失败');
  return data;
}

async function openSettings() {
  try {
    const config = await apiGetConfig();
    dom.settingsRoot.value = config.root || '';
    dom.settingsPort.value = config.port || 3000;
    const bindAddrs = Array.isArray(config.bind) ? config.bind : [config.bind || '0.0.0.0'];
    dom.settingsBind.value = bindAddrs.join('\n');
    dom.settingsWhitelist.value = (config.whitelist || []).join('\n');
    dom.settingsRootError.textContent = '';
    dom.settingsPortError.textContent = '';
    dom.settingsBindError.textContent = '';
    dom.settingsWhitelistError.textContent = '';
    dom.settingsRoot.classList.remove('input-error');
    dom.settingsPort.classList.remove('input-error');
    dom.settingsBind.classList.remove('input-error');
    dom.settingsWhitelist.classList.remove('input-error');
  } catch (err) {
    dom.settingsRoot.value = '';
    dom.settingsRootError.textContent = err.message;
  }
  dom.settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  dom.settingsOverlay.classList.add('hidden');
}

async function saveSettings() {
  const root = dom.settingsRoot.value.trim();
  if (!root) {
    dom.settingsRootError.textContent = '请输入目录路径';
    dom.settingsRoot.classList.add('input-error');
    return;
  }

  const config = { root };

  // Port
  const portVal = dom.settingsPort.value.trim();
  if (portVal) {
    const p = parseInt(portVal, 10);
    if (isNaN(p) || p < 1 || p > 65535) {
      dom.settingsPortError.textContent = '端口号需在 1-65535 之间';
      dom.settingsPort.classList.add('input-error');
      return;
    }
    config.port = p;
  }

  // Bind addresses
  const bindRaw = dom.settingsBind.value.trim();
  if (bindRaw) {
    config.bind = bindRaw.split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
  }

  // Whitelist
  let whitelist = [];
  const whitelistRaw = dom.settingsWhitelist.value.trim();
  if (whitelistRaw) {
    whitelist = whitelistRaw.split('\n').map(s => s.trim()).filter(s => s !== '');
  }
  config.whitelist = whitelist;

  dom.settingsSave.disabled = true;
  dom.settingsSave.textContent = '保存中...';
  dom.settingsRootError.textContent = '';
  dom.settingsPortError.textContent = '';
  dom.settingsBindError.textContent = '';
  dom.settingsWhitelistError.textContent = '';
  [dom.settingsRoot, dom.settingsPort, dom.settingsBind, dom.settingsWhitelist].forEach(el => {
    if (el) el.classList.remove('input-error');
  });

  try {
    const result = await apiSaveConfig(config);
    dom.rootPath.textContent = result.root;
    closeSettings();
    const msgs = ['配置已保存'];
    if (result.warnings && result.warnings.length > 0) {
      result.warnings.forEach(w => msgs.push(w));
    }
    if (config.whitelist && config.whitelist.length > 0) msgs.push(`白名单: ${config.whitelist.join(', ')}`);
    else msgs.push('白名单: 允许所有');
    showToast(msgs.join('；'), 'success');
    state.treeNodes = {};
    state.currentPath = '';
    window.location.hash = '#';
    renderTree();
    renderBreadcrumb();
    const data = await apiBrowse('');
    state.entries = data.entries;
    renderFileList(state.entries);
  } catch (err) {
    const msg = err.message;
    if (msg.includes('端口')) { dom.settingsPortError.textContent = msg; dom.settingsPort.classList.add('input-error'); }
    else if (msg.includes('绑定') || msg.includes('IP')) { dom.settingsBindError.textContent = msg; dom.settingsBind.classList.add('input-error'); }
    else if (msg.includes('whitelist') || msg.includes('白名单')) { dom.settingsWhitelistError.textContent = msg; dom.settingsWhitelist.classList.add('input-error'); }
    else { dom.settingsRootError.textContent = msg; dom.settingsRoot.classList.add('input-error'); }
  } finally {
    dom.settingsSave.disabled = false;
    dom.settingsSave.textContent = '保存';
  }
}

dom.settingsBtn.addEventListener('click', openSettings);
dom.settingsClose.addEventListener('click', closeSettings);
dom.settingsCancel.addEventListener('click', closeSettings);
dom.settingsSave.addEventListener('click', saveSettings);
dom.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === dom.settingsOverlay) closeSettings();
});

// === Change Password ===
function openChangePassword() {
  dom.passwordCurrent.value = '';
  dom.passwordNew.value = '';
  dom.passwordConfirm.value = '';
  dom.passwordCurrentError.textContent = '';
  dom.passwordNewError.textContent = '';
  dom.passwordConfirmError.textContent = '';
  [dom.passwordCurrent, dom.passwordNew, dom.passwordConfirm].forEach(el => el.classList.remove('input-error'));
  dom.passwordOverlay.classList.remove('hidden');
  setTimeout(() => dom.passwordCurrent.focus(), 50);
}

function closeChangePassword() {
  dom.passwordOverlay.classList.add('hidden');
}

async function saveChangePassword() {
  const current = dom.passwordCurrent.value;
  const newPwd = dom.passwordNew.value;
  const confirm = dom.passwordConfirm.value;

  dom.passwordCurrentError.textContent = '';
  dom.passwordNewError.textContent = '';
  dom.passwordConfirmError.textContent = '';
  [dom.passwordCurrent, dom.passwordNew, dom.passwordConfirm].forEach(el => el.classList.remove('input-error'));

  let hasError = false;
  if (!current) {
    dom.passwordCurrentError.textContent = '请输入当前密码';
    dom.passwordCurrent.classList.add('input-error');
    hasError = true;
  }
  if (!newPwd || newPwd.length < 6) {
    dom.passwordNewError.textContent = '新密码至少需要6位';
    dom.passwordNew.classList.add('input-error');
    hasError = true;
  }
  if (newPwd !== confirm) {
    dom.passwordConfirmError.textContent = '两次输入的新密码不一致';
    dom.passwordConfirm.classList.add('input-error');
    hasError = true;
  }
  if (hasError) return;

  dom.passwordSave.disabled = true;
  dom.passwordSave.textContent = '保存中...';

  try {
    await apiChangePassword(current, newPwd);
    closeChangePassword();
    showToast('密码已修改，请使用新密码重新登录', 'success');
    // Log out after a short delay so user can re-login with new password
    setTimeout(() => doLogout(), 1500);
  } catch (err) {
    const msg = err.message || '修改失败';
    if (msg.includes('当前密码') || msg.includes('旧密码') || msg.includes('错误')) {
      dom.passwordCurrentError.textContent = msg;
      dom.passwordCurrent.classList.add('input-error');
    } else if (msg.includes('新密码') || msg.includes('至少')) {
      dom.passwordNewError.textContent = msg;
      dom.passwordNew.classList.add('input-error');
    } else {
      dom.passwordConfirmError.textContent = msg;
      dom.passwordConfirm.classList.add('input-error');
    }
  } finally {
    dom.passwordSave.disabled = false;
    dom.passwordSave.textContent = '保存';
  }
}

dom.passwordClose.addEventListener('click', closeChangePassword);
dom.passwordCancel.addEventListener('click', closeChangePassword);
dom.passwordSave.addEventListener('click', saveChangePassword);
dom.passwordOverlay.addEventListener('click', (e) => {
  if (e.target === dom.passwordOverlay) closeChangePassword();
});
[dom.passwordCurrent, dom.passwordNew, dom.passwordConfirm].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveChangePassword();
    if (e.key === 'Escape') closeChangePassword();
  });
});

// === Refresh ===
dom.refreshBtn.addEventListener('click', () => {
  state.treeNodes = {};
  renderTree();
  navigateTo(state.currentPath);
});

// === Sidebar Toggle (Mobile) ===
function openSidebar() {
  $('#sidebar').classList.add('open');
  dom.sidebarOverlay.classList.add('show');
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  dom.sidebarOverlay.classList.remove('show');
}
dom.sidebarToggle.addEventListener('click', openSidebar);
dom.sidebarOverlay.addEventListener('click', closeSidebar);

// Override navigateTo to close sidebar on mobile after navigation
const _navigateTo = navigateTo;
navigateTo = async function(path) {
  closeSidebar();
  return _navigateTo(path);
};

// === Drag Select ===
// Create select rectangle on body (outside any overflow container)
dom.selectRect = document.createElement('div');
dom.selectRect.className = 'select-rect hidden';
document.body.appendChild(dom.selectRect);

let dragState = null;

dom.fileList.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.empty-placeholder') || e.target.closest('.loading-placeholder') || e.target.closest('.error-placeholder')) return;

  dragState = {
    startX: e.clientX,
    startY: e.clientY,
    started: false,
  };
});

document.addEventListener('mousemove', (e) => {
  if (!dragState) return;

  const dx = Math.abs(e.clientX - dragState.startX);
  const dy = Math.abs(e.clientY - dragState.startY);

  if (!dragState.started && (dx > 3 || dy > 3)) {
    // Threshold exceeded: activate drag mode
    dragState.started = true;
    if (!e.ctrlKey && !e.metaKey) clearSelection();
    dom.selectRect.classList.remove('hidden');
    document.body.style.userSelect = 'none';
  }

  if (dragState.started) {
    const left = Math.min(e.clientX, dragState.startX);
    const top = Math.min(e.clientY, dragState.startY);
    const width = Math.abs(e.clientX - dragState.startX);
    const height = Math.abs(e.clientY - dragState.startY);
    dom.selectRect.style.left = left + 'px';
    dom.selectRect.style.top = top + 'px';
    dom.selectRect.style.width = width + 'px';
    dom.selectRect.style.height = height + 'px';
  }
});

document.addEventListener('mouseup', (e) => {
  if (!dragState) return;

  if (dragState.started) {
    const selRect = dom.selectRect.getBoundingClientRect();
    dom.selectRect.classList.add('hidden');
    document.body.style.userSelect = '';
    const cards = dom.fileList.querySelectorAll('.file-card');

    cards.forEach((card) => {
      const cardRect = card.getBoundingClientRect();
      if (cardRect.left < selRect.right &&
          cardRect.right > selRect.left &&
          cardRect.top < selRect.bottom &&
          cardRect.bottom > selRect.top) {
        const nameEl = card.querySelector('.file-card-name');
        if (!nameEl) return;
        const entry = state.entries.find(en => en.name === nameEl.textContent);
        if (!entry) return;
        const p = getFilePath(entry);
        state.selected.add(p);
        card.classList.add('selected');
      }
    });

    updateBatchBar();
  }
  // If drag never started, it was a click on empty area → clear selection
  if (!dragState.started && !e.target.closest('.file-card') && !e.ctrlKey) {
    clearSelection();
  }

  dragState = null;
});

// === Multi-Select ===
function toggleSelect(entryPath, card) {
  if (state.selected.has(entryPath)) {
    state.selected.delete(entryPath);
    if (card) card.classList.remove('selected');
  } else {
    state.selected.add(entryPath);
    if (card) card.classList.add('selected');
  }
  updateBatchBar();
}

function updateAllCardSelections() {
  dom.fileList.querySelectorAll('.file-card').forEach((card) => {
    const nameEl = card.querySelector('.file-card-name');
    if (!nameEl) return;
    const entry = state.entries.find(e => e.name === nameEl.textContent);
    if (!entry) return;
    const p = getFilePath(entry);
    card.classList.toggle('selected', state.selected.has(p));
  });
}

function updateBatchBar() {
  const count = state.selected.size;
  if (count > 0) {
    dom.batchBar.classList.remove('hidden');
    dom.batchCount.textContent = `已选 ${count} 项`;
  } else {
    dom.batchBar.classList.add('hidden');
  }
}

function clearSelection() {
  state.selected.clear();
  dom.fileList.querySelectorAll('.file-card.selected').forEach(c => c.classList.remove('selected'));
  updateBatchBar();
}

// Batch bar events
dom.batchClearBtn.addEventListener('click', clearSelection);

dom.batchDeleteBtn.addEventListener('click', () => {
  const count = state.selected.size;
  openDialog('delete', `确定删除选中的 ${count} 个项目？此操作不可撤销。`, '', async () => {
    const paths = [...state.selected];
    let ok = 0;
    for (const p of paths) {
      try {
        await apiDelete(p);
        ok++;
      } catch (err) {
        showToast(`删除失败: ${escapeHtml(p)} - ${err.message}`, 'error');
      }
    }
    showToast(`已删除 ${ok}/${paths.length} 项`, 'success');
    clearSelection();
    refreshCurrent();
  });
});

// === Batch Rename Dialog ===
dom.batchRenameBtn.addEventListener('click', openBatchRename);

// Batch move
dom.batchMoveBtn.addEventListener('click', () => {
  if (state.selected.size === 0) return;
  batchMoveMode = true;
  moveTarget = null;
  moveTargetDir = '';
  dom.moveTitle.textContent = `批量移动 ${state.selected.size} 个项目`;
  dom.moveCurrent.textContent = '目标: /';
  dom.moveError.textContent = '';
  dom.moveOverlay.classList.remove('hidden');
  dom.moveTree.innerHTML = '<div class="tree-spinner"></div>';
  buildMoveTree().catch(err => {
    dom.moveTree.innerHTML = `<div class="tree-error">加载失败: ${escapeHtml(err.message)}</div>`;
  });
});

dom.batchRenameClose.addEventListener('click', closeBatchRename);
dom.batchRenameCancel.addEventListener('click', closeBatchRename);
dom.batchRenameOverlay.addEventListener('click', (e) => {
  if (e.target === dom.batchRenameOverlay) closeBatchRename();
});

dom.batchRenameMode.addEventListener('change', updateBatchRenameArgs);

function updateBatchRenameArgs() {
  const mode = dom.batchRenameMode.value;
  let html = '';
  switch (mode) {
    case 'prefix':
      html = '<div class="settings-field"><label>前缀</label><input type="text" id="br-prefix" class="settings-input" placeholder="输入前缀..." style="font-family:inherit;"></div>';
      break;
    case 'suffix':
      html = '<div class="settings-field"><label>后缀</label><input type="text" id="br-suffix" class="settings-input" placeholder="输入后缀（不含扩展名）..." style="font-family:inherit;"></div>';
      break;
    case 'replace':
      html = '<div class="settings-field"><label>查找</label><input type="text" id="br-find" class="settings-input" placeholder="查找文本..." style="font-family:inherit;"></div><div class="settings-field"><label>替换为</label><input type="text" id="br-replace" class="settings-input" placeholder="替换文本..." style="font-family:inherit;"></div>';
      break;
    case 'number':
      html = '<div class="settings-field"><label>基础名称</label><input type="text" id="br-base" class="settings-input" placeholder="基础文件名..." style="font-family:inherit;"></div><div class="settings-field"><label>起始编号</label><input type="number" id="br-start" class="settings-input" value="1" min="0" style="font-family:inherit;"></div><div class="settings-field"><label>位数</label><input type="number" id="br-digits" class="settings-input" value="2" min="1" max="6" style="font-family:inherit;"></div>';
      break;
  }
  dom.batchRenameArgs.innerHTML = html;
}

function openBatchRename() {
  if (state.selected.size === 0) return;
  dom.batchRenameError.textContent = '';
  dom.batchRenameMode.value = 'prefix';
  updateBatchRenameArgs();
  dom.batchRenameOverlay.classList.remove('hidden');
}

function closeBatchRename() {
  dom.batchRenameOverlay.classList.add('hidden');
}

dom.batchRenameConfirm.addEventListener('click', async () => {
  const mode = dom.batchRenameMode.value;
  const selectedPaths = [...state.selected];
  const results = { ok: 0, fail: 0 };

  dom.batchRenameConfirm.disabled = true;
  dom.batchRenameConfirm.textContent = '重命名中...';

  for (const p of selectedPaths) {
    try {
      const ext = p.includes('.') ? '.' + p.split('.').pop() : '';
      const base = ext ? p.slice(0, -(ext.length)) : p;
      let newName;

      switch (mode) {
        case 'prefix': {
          const prefix = document.getElementById('br-prefix')?.value || '';
          newName = prefix + p.split('/').pop();
          break;
        }
        case 'suffix': {
          const suffix = document.getElementById('br-suffix')?.value || '';
          newName = base.split('/').pop() + suffix + ext;
          break;
        }
        case 'replace': {
          const find = document.getElementById('br-find')?.value || '';
          const replace = document.getElementById('br-replace')?.value || '';
          const oldName = p.split('/').pop();
          if (!find) { results.fail++; continue; }
          newName = oldName.replaceAll(find, replace);
          break;
        }
        case 'number': {
          const baseName = document.getElementById('br-base')?.value || 'file';
          const start = parseInt(document.getElementById('br-start')?.value || '1', 10);
          const digits = parseInt(document.getElementById('br-digits')?.value || '2', 10);
          const num = String(start + results.ok).padStart(digits, '0');
          newName = baseName + num + ext;
          break;
        }
      }

      if (newName && newName !== p.split('/').pop()) {
        try {
          await apiRename(p, newName);
        } catch (err) {
          if (err.message.includes('已存在')) {
            const ext = newName.includes('.') ? '.' + newName.split('.').pop() : '';
            const baseName = ext ? newName.slice(0, -(ext.length)) : newName;
            let resolved = false;
            for (let n = 1; n < 100; n++) {
              try {
                const altName = `${baseName} (${n})${ext}`;
                await apiRename(p, altName);
                resolved = true;
                break;
              } catch (e2) {
                if (!e2.message.includes('已存在')) throw e2;
              }
            }
            if (!resolved) throw new Error('重名次数过多，无法自动解决');
          } else {
            throw err;
          }
        }
        results.ok++;
      } else {
        results.fail++;
      }
    } catch (err) {
      results.fail++;
      console.error(`Rename failed for ${p}:`, err.message);
    }
  }

  dom.batchRenameConfirm.disabled = false;
  dom.batchRenameConfirm.textContent = '确认重命名';

  if (results.ok > 0) showToast(`已重命名 ${results.ok} 项`, 'success');
  if (results.fail > 0) showToast(`${results.fail} 项重命名失败`, 'error');
  closeBatchRename();
  clearSelection();
  refreshCurrent();
});

// === Utility ===
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === Context Menu ===
let contextTarget = null;

function showContextMenu(e, entry) {
  e.preventDefault();
  contextTarget = entry;

  const menu = dom.contextMenu;
  menu.classList.remove('hidden');
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - 260);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  dom.ctxDownload.classList.toggle('hidden', entry.type === 'directory');
  const isImg = !entry || entry.type === 'directory' || getFileCategory(entry) !== 'image';
  dom.ctxCanvas.classList.toggle('hidden', isImg);
  dom.ctxAi.classList.toggle('hidden', isImg);
  dom.ctxBatchImages.classList.toggle('hidden', isImg);
  dom.ctxAiSub.classList.add('hidden');

  // Highlight target card
  document.querySelectorAll('.file-card.context-target').forEach(el => el.classList.remove('context-target'));
  e.currentTarget.classList.add('context-target');
}

async function loadAiSubmenu() {
  const sub = dom.ctxAiSub;
  sub.classList.remove('hidden');
  sub.innerHTML = '<div class="ctx-sub-loading">加载中...</div>';
  sub.style.left = '0px';
  sub.style.top = '0px';
  let workflows = [];
  try {
    // Always fetch fresh workflows when hovering the submenu (no caching)
    const data = await apiGetJson('/api/ai/workflows-for-images');
    workflows = data.workflows || [];
  } catch (err) {
    sub.innerHTML = `<div class="ctx-sub-empty" style="color:var(--danger)">加载失败: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (!workflows.length) {
    sub.innerHTML = '<div class="ctx-sub-empty">无图片输入类型的工作流</div>';
    return;
  }
  let h = '';
  workflows.forEach(w => {
    const tag = w.imageInputCount > 1 ? ` <span style="color:var(--accent);font-size:11px">·${w.imageInputCount}图</span>` : '';
    h += `<div class="ctx-sub-item" data-wfid="${escapeHtml(w.id)}" data-count="${w.imageInputCount||1}">${escapeHtml(w.name)}${tag}</div>`;
  });
  sub.innerHTML = h;
  // stash the workflow metadata for the click handler
  state._aiWfList = workflows;
  // position submenu to the right of the AI item (or left if near right edge)
  const menuRect = dom.contextMenu.getBoundingClientRect();
  const aiTop = dom.ctxAi.getBoundingClientRect().top;
  const subWidth = 200;
  if (menuRect.right + subWidth > window.innerWidth) {
    sub.style.left = (-subWidth + 4) + 'px';
  } else {
    sub.style.left = (menuRect.width - 2) + 'px';
  }
  sub.style.top = (aiTop - menuRect.top) + 'px';
}

function hideAiSubmenu() {
  dom.ctxAiSub.classList.add('hidden');
}

dom.ctxAi.addEventListener('mouseenter', () => {
  loadAiSubmenu();
});
dom.ctxCanvas.addEventListener('click', async () => {
  if (!contextTarget) return;
  const filePath = getFilePath(contextTarget);
  hideContextMenu();
  try {
    const result = await apiPostJson('/api/ai/infinite-canvas/imports', {
      fileRef: { rootId: 'main', path: filePath },
    });
    if (!result.canvasAsset || !result.canvasAsset.url) throw new Error('画布未返回素材引用');
    showToast('图片已安全发送到 Infinite Canvas 素材库', 'success');
    const url = `/ai-workbench.html?fileManagerAsset=${encodeURIComponent(result.canvasAsset.url)}`;
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    showToast('发送到 Infinite Canvas 失败: ' + err.message, 'error');
  }
});
dom.ctxAiSub.addEventListener('mouseleave', (e) => {
  // Check if mouse actually leaves the submenu (not moving to a child)
  if (!dom.ctxAiSub.contains(e.relatedTarget) && !dom.ctxAi.contains(e.relatedTarget)) {
    hideAiSubmenu();
  }
});
dom.ctxAiSub.addEventListener('click', async (e) => {
  const item = e.target.closest('.ctx-sub-item');
  if (!item) return;
  const wfId = item.dataset.wfid;
  if (!wfId || !contextTarget) return;
  const wfMeta = (state._aiWfList || []).find(w => w.id === wfId) || { imageInputCount: 1 };
  const need = wfMeta.imageInputCount || 1;
  hideContextMenu();

  // Collect selected image paths (multi-select support)
  const selectedImages = [];
  if (state.selected.size > 0) {
    for (const p of state.selected) {
      const ext = p.split('.').pop()?.toLowerCase();
      if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
        selectedImages.push(p);
      }
    }
  }
  const rightClickPath = getFilePath(contextTarget);
  if (!selectedImages.includes(rightClickPath)) selectedImages.unshift(rightClickPath);

  if (need === 1) {
    // Single-image workflow: one task per selected image (batch)
    const images = selectedImages.length ? selectedImages : [rightClickPath];
    try {
      const r = await apiPostJson('/api/ai/tasks/batch', {
        workflowId: wfId,
        imageRefs: images.map(path => ({ rootId: 'main', path })),
      });
      showToast(`已提交 ${r.count} 个AI任务`, 'success');
    } catch (err) {
      showToast('提交失败: ' + err.message, 'error');
    }
    return;
  }

  // Multi-image workflow: open guided dialog to assign one image per slot
  openAiMultiDialog(wfId, wfMeta, selectedImages);
});

function hideContextMenu() {
  dom.contextMenu.classList.add('hidden');
  hideAiSubmenu();
  contextTarget = null;
  document.querySelectorAll('.file-card.context-target').forEach(el => el.classList.remove('context-target'));
}

// ---------- Multi-image workflow dialog ----------
let _aiMultiState = null; // { wfId, slots: [path|null], imageInputs, candidates }

function openAiMultiDialog(wfId, wfMeta, preselected) {
  _aiMultiState = {
    wfId,
    imageInputs: wfMeta.imageInputs || [],
    slots: (wfMeta.imageInputs || []).map((_, i) => preselected[i] || null),
    candidates: preselected.slice(),
  };
  dom.aiMultiTitle.textContent = `AI 工作流「${wfMeta.name}」— 按顺序选择 ${wfMeta.imageInputs.length} 张图片`;
  dom.aiMultiHint.innerHTML = `该工作流需要 <b>${wfMeta.imageInputs.length}</b> 张图片作为输入，按下方顺序逐一指定。` +
    ` 已选 <b>${preselected.length}</b> 张候选图，可从下拉框选择或留空后用「选择文件」按钮浏览。`;
  renderAiMultiSlots();
  dom.aiMultiError.textContent = '';
  dom.aiMultiOverlay.classList.remove('hidden');
}

function renderAiMultiSlots() {
  const st = _aiMultiState;
  if (!st) return;
  let h = '';
  st.imageInputs.forEach((inp, i) => {
    const cur = st.slots[i] || '';
    const opts = ['<option value="">— 未选择 —</option>']
      .concat(st.candidates.map(p => `<option value="${escapeHtml(p)}"${p===cur?' selected':''}>${escapeHtml(p.split('/').pop())}</option>`))
      .join('');
    h += `<div class="settings-field" style="margin:0">
      <label>第 ${i + 1} 张图片${inp.label ? '（'+escapeHtml(inp.label)+'）' : ''}</label>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="settings-input" data-slot="${i}" style="flex:1;font-family:var(--mono);">${opts}</select>
        <button class="btn-secondary" data-pick="${i}" style="padding:6px 10px;white-space:nowrap">选择文件</button>
        <button class="btn-secondary" data-clear="${i}" style="padding:6px 10px;white-space:nowrap">清空</button>
      </div>
      <div class="settings-hint" data-preview="${i}" style="font-family:var(--mono);word-break:break-all">${cur ? escapeHtml(cur) : ''}</div>
    </div>`;
  });
  dom.aiMultiSlots.innerHTML = h;
  $$('[data-slot]', dom.aiMultiSlots).forEach(sel => {
    sel.addEventListener('change', () => {
      const i = +sel.dataset.slot;
      _aiMultiState.slots[i] = sel.value || null;
      const pv = dom.aiMultiSlots.querySelector(`[data-preview="${i}"]`);
      if (pv) pv.textContent = sel.value || '';
    });
  });
  $$('[data-pick]', dom.aiMultiSlots).forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.pick;
      openFilePickerForAi((path) => {
        _aiMultiState.slots[i] = path;
        const sel = dom.aiMultiSlots.querySelector(`[data-slot="${i}"]`);
        if (sel && ![...sel.options].some(o => o.value === path)) {
          const o = document.createElement('option');
          o.value = path; o.textContent = path.split('/').pop();
          sel.appendChild(o);
        }
        sel.value = path;
        const pv = dom.aiMultiSlots.querySelector(`[data-preview="${i}"]`);
        if (pv) pv.textContent = path;
      });
    });
  });
  $$('[data-clear]', dom.aiMultiSlots).forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.clear;
      _aiMultiState.slots[i] = null;
      const sel = dom.aiMultiSlots.querySelector(`[data-slot="${i}"]`);
      if (sel) sel.value = '';
      const pv = dom.aiMultiSlots.querySelector(`[data-preview="${i}"]`);
      if (pv) pv.textContent = '';
    });
  });
}

function closeAiMultiDialog() {
  dom.aiMultiOverlay.classList.add('hidden');
  _aiMultiState = null;
}

// Minimal file picker: reuses the browse API to walk the file manager
function openFilePickerForAi(callback) {
  // Build a lightweight modal on the fly
  let cwd = state.currentPath || '';
  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '4000';
  overlay.innerHTML = `
    <div class="dialog-modal" style="width:520px">
      <div class="dialog-header"><h3>选择图片</h3><button class="btn-icon" title="关闭">&times;</button></div>
      <div class="dialog-body" style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow:hidden">
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn-secondary" data-up style="padding:5px 10px">上级</button>
          <span class="settings-hint" data-path style="flex:1;font-family:var(--mono);word-break:break-all"></span>
        </div>
        <div data-grid style="flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px"></div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" data-cancel>取消</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const grid = overlay.querySelector('[data-grid]');
  const pathEl = overlay.querySelector('[data-path]');
  const close = () => overlay.remove();
  overlay.querySelector('.btn-icon').addEventListener('click', close);
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-up]').addEventListener('click', () => {
    cwd = cwd.split('/').slice(0, -1).join('/');
    renderPick();
  });
  async function renderPick() {
    pathEl.textContent = '/' + cwd;
    grid.innerHTML = '<div class="settings-hint">加载中...</div>';
    try {
      const data = await apiBrowse(cwd);
      const items = data.entries || [];
      grid.innerHTML = '';
      items.forEach(it => {
        const isImg = it.type === 'file' && ['jpg','jpeg','png','gif','webp','bmp'].includes((it.name.split('.').pop()||'').toLowerCase());
        if (it.type === 'directory') {
          const d = document.createElement('div');
          d.style.cssText = 'cursor:pointer;padding:8px;border:1px solid var(--border);border-radius:6px;text-align:center';
          d.innerHTML = `📁<br><span style="font-size:12px;word-break:break-all">${escapeHtml(it.name)}</span>`;
          d.addEventListener('click', () => { cwd = cwd ? cwd + '/' + it.name : it.name; renderPick(); });
          grid.appendChild(d);
        } else if (isImg) {
          const p = cwd ? cwd + '/' + it.name : it.name;
          const url = `/api/file?path=${encodeURIComponent(p)}`;
          const d = document.createElement('div');
          d.style.cssText = 'cursor:pointer;padding:4px;border:1px solid var(--border);border-radius:6px;text-align:center';
          d.innerHTML = `<img src="${url}" style="width:100%;height:70px;object-fit:cover;border-radius:4px"><br><span style="font-size:11px;word-break:break-all">${escapeHtml(it.name)}</span>`;
          d.addEventListener('click', () => { callback(p); close(); });
          grid.appendChild(d);
        }
      });
      if (!grid.children.length) grid.innerHTML = '<div class="settings-hint">无图片文件</div>';
    } catch (err) {
      grid.innerHTML = `<div class="settings-hint" style="color:var(--danger)">${escapeHtml(err.message)}</div>`;
    }
  }
  renderPick();
}

dom.aiMultiClose.addEventListener('click', closeAiMultiDialog);
dom.aiMultiCancel.addEventListener('click', closeAiMultiDialog);
dom.aiMultiOverlay.addEventListener('click', e => { if (e.target === dom.aiMultiOverlay) closeAiMultiDialog(); });
dom.aiMultiConfirm.addEventListener('click', async () => {
  const st = _aiMultiState;
  if (!st) return;
  const filled = st.slots.map(s => s || '').filter(Boolean);
  if (filled.length !== st.imageInputs.length) {
    dom.aiMultiError.textContent = `还需选择 ${st.imageInputs.length - filled.length} 张图片`;
    return;
  }
  dom.aiMultiConfirm.disabled = true;
  try {
    const r = await apiPostJson('/api/ai/tasks/with-images', {
      workflowId: st.wfId,
      imageRefs: filled.map(path => ({ rootId: 'main', path })),
    });
    showToast(`已提交 AI 任务`, 'success');
    closeAiMultiDialog();
  } catch (err) {
    dom.aiMultiError.textContent = err.message;
  } finally {
    dom.aiMultiConfirm.disabled = false;
  }
});

// =================== Image Editor ===================
let _ie = null; // { sourcePath, baseName, dir, img, rotation, flipH, flipV, crop, dirty }

function openImageEditor(entry) {
  const path = getFilePath(entry);
  _ie = {
    sourcePath: path,
    dir: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    baseName: entry.name,
    img: new Image(),
    rotation: 0, flipH: false, flipV: false, crop: null, dirty: false,
  };
  dom.imgEditTitle.textContent = '编辑图片 — ' + entry.name;
  dom.ieError.textContent = '';
  dom.ieCropApply.style.display = 'none';
  dom.ieCropCancel.style.display = 'none';
  dom.ieCrop.style.display = '';
  dom.imgEditOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // load image via fetch to avoid caching issues with same-origin
  _ie.img.onload = () => { renderIeCanvas(); updateIeInfo(); };
  _ie.img.onerror = () => { dom.ieError.textContent = '图片加载失败'; };
  _ie.img.crossOrigin = 'anonymous';
  _ie.img.src = getFileUrl(entry) + '&t=' + Date.now();
}

function renderIeCanvas() {
  const canvas = dom.ieCanvas;
  const ctx = canvas.getContext('2d');
  const img = _ie.img;
  const rot = _ie.rotation % 360;
  const swap = rot === 90 || rot === 270;
  const w = swap ? img.naturalHeight : img.naturalWidth;
  const h = swap ? img.naturalWidth : img.naturalHeight;
  canvas.width = w; canvas.height = h;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.scale(_ie.flipH ? -1 : 1, _ie.flipV ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
  // draw crop overlay if active
  if (_ie.crop) drawIeCropOverlay();
}

function updateIeInfo() {
  const canvas = dom.ieCanvas;
  dom.ieInfo.textContent = `${canvas.width} × ${canvas.height}px`;
}

function ieApplyTransformsThen(callback) {
  // Bake current rotation/flips into a new image so crop works on the displayed pixels
  const canvas = dom.ieCanvas;
  const off = document.createElement('canvas');
  off.width = canvas.width; off.height = canvas.height;
  off.getContext('2d').drawImage(canvas, 0, 0);
  const tmp = new Image();
  tmp.onload = () => callback(tmp);
  tmp.src = off.toDataURL();
}

function ieRotate(dir) {
  _ie.rotation = (_ie.rotation + (dir > 0 ? 90 : 270)) % 360;
  _ie.dirty = true;
  renderIeCanvas(); updateIeInfo();
}

function ieFlip(axis) {
  if (axis === 'h') _ie.flipH = !_ie.flipH;
  else _ie.flipV = !_ie.flipV;
  _ie.dirty = true;
  renderIeCanvas(); updateIeInfo();
}

function ieReset() {
  _ie.rotation = 0; _ie.flipH = false; _ie.flipV = false; _ie.crop = null;
  _ie.dirty = false;
  dom.ieCropApply.style.display = 'none';
  dom.ieCropCancel.style.display = 'none';
  dom.ieCrop.style.display = '';
  renderIeCanvas(); updateIeInfo();
}

// ---- Crop via drag selection on canvas ----
let _ieCropDrag = null;
function enterCropMode() {
  _ie.crop = { x: 0, y: 0, w: 0, h: 0 };
  dom.ieCropApply.style.display = '';
  dom.ieCropCancel.style.display = '';
  dom.ieCrop.style.display = 'none';
  renderIeCanvas();
}
function exitCropMode(apply) {
  if (!apply || !_ie.crop || _ie.crop.w < 2 || _ie.crop.h < 2) {
    _ie.crop = null;
    dom.ieCropApply.style.display = 'none';
    dom.ieCropCancel.style.display = 'none';
    dom.ieCrop.style.display = '';
    renderIeCanvas();
    return;
  }
  // apply crop: bake transforms first so coordinates match displayed canvas
  ieApplyTransformsThen((baked) => {
    const c = Math.max(0, Math.round(_ie.crop.x));
    const d = Math.max(0, Math.round(_ie.crop.y));
    const cw = Math.min(dom.ieCanvas.width - c, Math.round(_ie.crop.w));
    const ch = Math.min(dom.ieCanvas.height - d, Math.round(_ie.crop.h));
    const off = document.createElement('canvas');
    off.width = cw; off.height = ch;
    off.getContext('2d').drawImage(baked, c, d, cw, ch, 0, 0, cw, ch);
    const tmp = new Image();
    tmp.onload = () => {
      _ie.img = tmp;
      _ie.rotation = 0; _ie.flipH = false; _ie.flipV = false;
      _ie.crop = null; _ie.dirty = true;
      dom.ieCropApply.style.display = 'none';
      dom.ieCropCancel.style.display = 'none';
      dom.ieCrop.style.display = '';
      renderIeCanvas(); updateIeInfo();
    };
    tmp.src = off.toDataURL();
  });
}

function drawIeCropOverlay() {
  const canvas = dom.ieCanvas;
  const ctx = canvas.getContext('2d');
  const cr = _ie.crop;
  // dim outside
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, canvas.width, cr.y);
  ctx.fillRect(0, cr.y, cr.x, cr.h);
  ctx.fillRect(cr.x + cr.w, cr.y, canvas.width - cr.x - cr.w, cr.h);
  ctx.fillRect(0, cr.y + cr.h, canvas.width, canvas.height - cr.y - cr.h);
  ctx.strokeStyle = '#89b4fa';
  ctx.lineWidth = 2;
  ctx.strokeRect(cr.x + 0.5, cr.y + 0.5, cr.w, cr.h);
  ctx.restore();
}

function ieCanvasPos(e) {
  const rect = dom.ieCanvas.getBoundingClientRect();
  // canvas may be displayed scaled; map to canvas pixels
  const sx = dom.ieCanvas.width / rect.width;
  const sy = dom.ieCanvas.height / rect.height;
  return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}

dom.ieCanvas.addEventListener('mousedown', (e) => {
  if (!_ie || !_ie.crop) return;
  const p = ieCanvasPos(e);
  _ieCropDrag = { startX: p.x, startY: p.y };
  _ie.crop.x = p.x; _ie.crop.y = p.y; _ie.crop.w = 0; _ie.crop.h = 0;
});
document.addEventListener('mousemove', (e) => {
  if (!_ieCropDrag || !_ie || !_ie.crop) return;
  const p = ieCanvasPos(e);
  const x = Math.min(_ieCropDrag.startX, p.x);
  const y = Math.min(_ieCropDrag.startY, p.y);
  _ie.crop.x = Math.max(0, x);
  _ie.crop.y = Math.max(0, y);
  _ie.crop.w = Math.min(dom.ieCanvas.width - _ie.crop.x, Math.abs(p.x - _ieCropDrag.startX));
  _ie.crop.h = Math.min(dom.ieCanvas.height - _ie.crop.y, Math.abs(p.y - _ieCropDrag.startY));
  renderIeCanvas();
});
document.addEventListener('mouseup', () => { _ieCropDrag = null; });

function ieExportBlob() {
  // Re-render from source image WITHOUT the crop overlay so exports are always clean
  const img = _ie.img;
  const rot = _ie.rotation % 360;
  const swap = rot === 90 || rot === 270;
  const w = swap ? img.naturalHeight : img.naturalWidth;
  const h = swap ? img.naturalWidth : img.naturalHeight;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const ctx = off.getContext('2d');
  // For formats without alpha, paint a white background to avoid black
  const fmt = dom.ieFormat.value;
  if (fmt === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.scale(_ie.flipH ? -1 : 1, _ie.flipV ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
  const q = parseFloat(dom.ieQuality.value) || 0.92;
  return new Promise((resolve, reject) => {
    off.toBlob((blob) => blob ? resolve(blob) : reject(new Error('导出失败')), fmt, q);
  });
}

async function ieSave(as) {
  if (!_ie) return;
  dom.ieError.textContent = '';
  try {
    const blob = await ieExportBlob();
    let targetName;
    if (as) {
      targetName = prompt('另存为（输入文件名）', _ie.baseName.replace(/(\.[^.]+)?$/, '_edit$1'));
      if (!targetName) return;
    } else {
      targetName = _ie.baseName;
    }
    // adjust extension to match format
    const fmt = dom.ieFormat.value;
    const extByFmt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[fmt];
    if (!new RegExp('\\.' + extByFmt + '$', 'i').test(targetName)) {
      targetName = targetName.replace(/\.[^.]+$/, '') + '.' + extByFmt;
    }
    const file = new File([blob], targetName, { type: fmt });
    const formData = new FormData();
    formData.append('uploadDir', _ie.dir);
    formData.append('files', file);
    const result = await apiUpload(formData);
    const ok = result.results.filter(r => r.success).length;
    if (ok) {
      showToast(as ? `已另存为 ${targetName}` : `已保存 ${targetName}`, 'success');
      if (!as) _ie.dirty = false;
      closeImageEditor();
      refreshCurrent();
    } else {
      dom.ieError.textContent = (result.results[0] && result.results[0].error) || '保存失败';
    }
  } catch (err) {
    dom.ieError.textContent = err.message;
  }
}

function closeImageEditor() {
  if (_ie && _ie.dirty && !confirm('有未保存的改动，确定关闭？')) return;
  dom.imgEditOverlay.classList.add('hidden');
  document.body.style.overflow = '';
  _ie = null;
}

dom.previewImageEdit.addEventListener('click', () => {
  if (state.previewFile && getFileCategory(state.previewFile) === 'image') {
    openImageEditor(state.previewFile);
  }
});
dom.imgEditClose.addEventListener('click', closeImageEditor);
dom.imgEditOverlay.addEventListener('click', e => { if (e.target === dom.imgEditOverlay) closeImageEditor(); });
dom.ieRotateL.addEventListener('click', () => ieRotate(-1));
dom.ieRotateR.addEventListener('click', () => ieRotate(1));
dom.ieFlipH.addEventListener('click', () => ieFlip('h'));
dom.ieFlipV.addEventListener('click', () => ieFlip('v'));
dom.ieReset.addEventListener('click', ieReset);
dom.ieCrop.addEventListener('click', enterCropMode);
dom.ieCropApply.addEventListener('click', () => exitCropMode(true));
dom.ieCropCancel.addEventListener('click', () => exitCropMode(false));
dom.ieSave.addEventListener('click', () => ieSave(false));
dom.ieSaveAs.addEventListener('click', () => ieSave(true));

// =================== Batch Image Processing (P0) ===================
let _bi = null; // { paths:[], imgs:[{path,name,el,ext}], selIdx, cancel:false, targetDir:'' }

const BI_IMG_EXTS = ['jpg','jpeg','png','gif','webp','bmp'];
const BI_FMT_EXT = { 'image/jpeg':'jpg', 'image/webp':'webp', 'image/png':'png' };
const BI_KEEP_EXT = { 'image/jpeg':['jpg','jpeg'], 'image/webp':['webp'], 'image/png':['png'], 'image/gif':['gif'] };

function _biLoadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('_bi_settings') || '{}');
    if (s.width != null) dom.biWidth.value = s.width;
    if (s.height != null) dom.biHeight.value = s.height;
    if (s.widthAuto) dom.biWidthAuto.checked = true;
    if (s.heightAuto) dom.biHeightAuto.checked = true;
    if (s.crop) dom.biCrop.value = s.crop;
    if (s.format) dom.biFormat.value = s.format;
    if (s.quality != null) { dom.biQuality.value = s.quality; dom.biQualityVal.textContent = s.quality; }
    if (s.rename) dom.biRename.value = s.rename;
    if (s.renameStart != null) dom.biRenameStart.value = s.renameStart;
    if (s.padColor) dom.biPadColor.value = s.padColor;
    if (s.output) dom.biOutput.value = s.output;
    if (s.focal) dom.biFocal.value = s.focal;
    if (s.unit) dom.biUnit.value = s.unit;
    if (s.hq) dom.biHq.checked = true;
    if (s.borderColor) dom.biBorderColor.value = s.borderColor;
    if (s.borderW != null) dom.biBorderW.value = s.borderW;
    if (s.borderRadius != null) dom.biBorderRadius.value = s.borderRadius;
    if (s.borderEnable) dom.biBorderEnable.checked = true;
    if (s.keepExif) dom.biKeepExif.checked = true;
    if (s.prep && _bi) _bi.prep = s.prep;
    if (s.wmLayers && _bi) _bi.wmLayers = _biDeserializeWmLayers(s.wmLayers);
  } catch (_) {}
}
function _biSaveSettings() {
  const s = _biReadSettings();
  s.wmLayers = _biSerializeWmLayers();
  localStorage.setItem('_bi_settings', JSON.stringify(s));
}

// watermark layers: serialize image layers without the DOM imgEl (keep src)
function _biSerializeWmLayers() {
  if (!_bi) return [];
  return _bi.wmLayers.map(l => {
    const o = { ...l };
    if (l.type === 'image' && l.imgEl) { o.imgSrc = l.imgEl.src; delete o.imgEl; }
    return o;
  });
}
function _biDeserializeWmLayers(arr) {
  return (arr || []).map(l => {
    const o = { ...l };
    if (o.type === 'image' && o.imgSrc) {
      const img = new Image();
      img.onload = () => _biRenderPreview();
      img.src = o.imgSrc;
      o.imgEl = img;
    }
    delete o.imgSrc;
    return o;
  });
}

let _biWmId = 1;
function _biWmNewText() { return { id: _biWmId++, type: 'text', enabled: true, text: '水印', size: 32, color: '#ffffff', opacity: 0.7, pos: 'br' }; }
function _biWmNewImage() { return { id: _biWmId++, type: 'image', enabled: true, imgEl: null, imgScale: 0.2, opacity: 0.8, pos: 'br', tile: false }; }

function _biRenderWmLayers() {
  if (!_bi) return;
  let h = '';
  _bi.wmLayers.forEach((l, idx) => {
    const en = l.enabled ? 'checked' : '';
    if (l.type === 'text') {
      h += `<div class="bi-wm-row" data-id="${l.id}" style="border:1px solid var(--border);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;gap:6px;align-items:center">
          <input type="checkbox" data-f="enabled" ${en}>
          <span style="font-size:11px;color:var(--muted)">文字</span>
          <span style="flex:1"></span>
          <button type="button" class="btn-secondary" data-act="up" style="padding:2px 6px;font-size:11px">↑</button>
          <button type="button" class="btn-secondary" data-act="down" style="padding:2px 6px;font-size:11px">↓</button>
          <button type="button" class="btn-secondary" data-act="del" style="padding:2px 6px;font-size:11px">✕</button>
        </div>
        <input type="text" data-f="text" value="${escapeHtml(l.text||'')}" class="settings-input" placeholder="水印文字" style="font-family:inherit">
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
          <input type="number" data-f="size" value="${l.size}" min="8" style="width:54px;font-family:var(--mono)" title="字号">
          <input type="color" data-f="color" value="${l.color}" style="width:30px;height:28px">
          <input type="range" data-f="opacity" min="0.1" max="1" step="0.05" value="${l.opacity}" style="width:70px" title="不透明度">
          <select data-f="pos" class="settings-input" style="width:auto;font-family:inherit;font-size:11px">
            ${['br','bl','tr','tl','c'].map(p=>`<option value="${p}" ${l.pos===p?'selected':''}>${({br:'右下',bl:'左下',tr:'右上',tl:'左上',c:'居中'})[p]}</option>`).join('')}
          </select>
        </div>
      </div>`;
    } else {
      h += `<div class="bi-wm-row" data-id="${l.id}" style="border:1px solid var(--border);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;gap:6px;align-items:center">
          <input type="checkbox" data-f="enabled" ${en}>
          <span style="font-size:11px;color:var(--muted)">图片</span>
          <span style="flex:1;font-size:11px;color:var(--muted)">${l.imgEl?'已加载':'未加载'}</span>
          <button type="button" class="btn-secondary" data-act="up" style="padding:2px 6px;font-size:11px">↑</button>
          <button type="button" class="btn-secondary" data-act="down" style="padding:2px 6px;font-size:11px">↓</button>
          <button type="button" class="btn-secondary" data-act="del" style="padding:2px 6px;font-size:11px">✕</button>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
          <input type="number" data-f="imgScale" value="${l.imgScale}" min="0.01" step="0.05" style="width:60px;font-family:var(--mono)" title="缩放比例(相对短边)">
          <input type="range" data-f="opacity" min="0.1" max="1" step="0.05" value="${l.opacity}" style="width:70px" title="不透明度">
          <label style="display:flex;align-items:center;gap:3px;font-size:11px"><input type="checkbox" data-f="tile" ${l.tile?'checked':''}> 平铺</label>
          <select data-f="pos" class="settings-input" style="width:auto;font-family:inherit;font-size:11px">
            ${['br','bl','tr','tl','c'].map(p=>`<option value="${p}" ${l.pos===p?'selected':''}>${({br:'右下',bl:'左下',tr:'右上',tl:'左上',c:'居中'})[p]}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }
  });
  dom.biWmLayers.innerHTML = h || '<div class="settings-hint">无水印图层</div>';
  // wire inputs
  $$('.bi-wm-row', dom.biWmLayers).forEach(row => {
    const id = +row.dataset.id;
    const layer = _bi.wmLayers.find(l => l.id === id);
    if (!layer) return;
    $$('[data-f]', row).forEach(inp => {
      const f = inp.dataset.f;
      const handler = () => {
        if (inp.type === 'checkbox') layer[f] = inp.checked;
        else if (inp.type === 'number' || inp.type === 'range') layer[f] = parseFloat(inp.value);
        else layer[f] = inp.value;
        _biRenderPreview(); _biSaveSettings();
      };
      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });
    $$('[data-act]', row).forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        const i = _bi.wmLayers.findIndex(l => l.id === id);
        if (act === 'del') _bi.wmLayers.splice(i, 1);
        else if (act === 'up' && i > 0) { const a = _bi.wmLayers[i-1]; _bi.wmLayers[i-1]=_bi.wmLayers[i]; _bi.wmLayers[i]=a; }
        else if (act === 'down' && i < _bi.wmLayers.length-1) { const a = _bi.wmLayers[i+1]; _bi.wmLayers[i+1]=_bi.wmLayers[i]; _bi.wmLayers[i]=a; }
        _biRenderWmLayers(); _biRenderPreview(); _biSaveSettings();
      });
    });
  });
}

function _biUpdateUnitLabels() {
  const u = dom.biUnit.value === 'pct' ? '%' : 'px';
  dom.biWidthLabel.textContent = `宽度 (${u})`;
  dom.biHeightLabel.textContent = `高度 (${u})`;
}

function _biUpdatePrepInfo() {
  if (!_bi) return;
  const p = _bi.prep;
  const parts = [];
  if (p.rotation) parts.push(`旋转${p.rotation}°`);
  if (p.flipH) parts.push('水平翻转');
  if (p.flipV) parts.push('垂直翻转');
  dom.biPrepInfo.textContent = parts.length ? parts.join('，') : '无';
}

// --- presets (localStorage) ---
function _biPresets() { try { return JSON.parse(localStorage.getItem('_bi_presets') || '{}'); } catch (_) { return {}; } }
function _biRefreshPresets() {
  const ps = _biPresets();
  let h = '<option value="">— 选择预设 —</option>';
  Object.keys(ps).forEach(n => { h += `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`; });
  dom.biPreset.innerHTML = h;
}
function _biApplyPreset(name) {
  const ps = _biPresets();
  const s = ps[name]; if (!s) return;
  if (s.width != null) dom.biWidth.value = s.width;
  if (s.height != null) dom.biHeight.value = s.height;
  dom.biWidthAuto.checked = !!s.widthAuto; dom.biHeightAuto.checked = !!s.heightAuto;
  if (s.crop) dom.biCrop.value = s.crop;
  if (s.format) dom.biFormat.value = s.format;
  if (s.quality != null) { dom.biQuality.value = s.quality; dom.biQualityVal.textContent = s.quality; }
  if (s.rename) dom.biRename.value = s.rename;
  if (s.renameStart != null) dom.biRenameStart.value = s.renameStart;
  if (s.padColor) dom.biPadColor.value = s.padColor;
  if (s.focal) dom.biFocal.value = s.focal;
  if (s.unit) dom.biUnit.value = s.unit;
  dom.biHq.checked = !!s.hq;
  if (s.borderColor) dom.biBorderColor.value = s.borderColor;
  if (s.borderW != null) dom.biBorderW.value = s.borderW;
  if (s.borderRadius != null) dom.biBorderRadius.value = s.borderRadius;
  dom.biBorderEnable.checked = !!s.borderEnable;
  dom.biKeepExif.checked = !!s.keepExif;
  if (s.prep && _bi) { _bi.prep = s.prep; _biUpdatePrepInfo(); }
  if (s.wmLayers && _bi) { _bi.wmLayers = _biDeserializeWmLayers(s.wmLayers); _biRenderWmLayers(); }
  _biUpdateUnitLabels(); _biTogglePadField(); _biToggleTargetRow();
  _biRenderPreview(); _biUpdateNamePreview();
}

// --- preset import/export ---
function _biExportPresets() {
  const ps = _biPresets();
  const blob = new Blob([JSON.stringify(ps, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `birme-presets-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast('已导出预设', 'success');
}
function _biImportPresets(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imp = JSON.parse(reader.result);
      const ps = _biPresets();
      let n = 0;
      for (const k in imp) { ps[k] = imp[k]; n++; }
      localStorage.setItem('_bi_presets', JSON.stringify(ps));
      _biRefreshPresets();
      showToast(`已导入 ${n} 个预设`, 'success');
    } catch (e) { showToast('导入失败: ' + e.message, 'error'); }
  };
  reader.readAsText(file);
}

// --- batch history (localStorage) ---
function _biHistory() { try { return JSON.parse(localStorage.getItem('_bi_history') || '[]'); } catch (_) { return []; } }
function _biRecordHistory(entry) {
  const h = _biHistory();
  h.unshift(entry);
  if (h.length > 50) h.length = 50;
  localStorage.setItem('_bi_history', JSON.stringify(h));
}
function _biRenderHistory() {
  const h = _biHistory();
  if (!h.length) { dom.biHistoryList.innerHTML = '<div class="settings-hint">暂无历史记录</div>'; return; }
  let html = '';
  h.forEach((e, i) => {
    const t = new Date(e.time).toLocaleString();
    const summary = `${e.count}张 · ${e.outputMode === 'zip' ? 'ZIP' : '目录'} · 成功${e.ok} 失败${e.fail}`;
    const dims = e.settings ? `${e.settings.width||'自动'}×${e.settings.height||'自动'}${e.settings.unit==='pct'?'%':'px'}` : '';
    html += `<div class="bi-hist-row" data-i="${i}" style="border:1px solid var(--border);border-radius:6px;padding:8px;display:flex;gap:8px;align-items:center">
      <div style="flex:1"><div style="font-size:12px">${escapeHtml(t)}</div><div class="settings-hint">${escapeHtml(summary)}${dims?' · '+escapeHtml(dims):''}</div></div>
      <button class="btn-secondary" data-load="${i}" style="padding:4px 10px;font-size:12px">载入</button>
      <button class="btn-secondary" data-del="${i}" style="padding:4px 10px;font-size:12px">删</button>
    </div>`;
  });
  dom.biHistoryList.innerHTML = html;
  $$('[data-load]', dom.biHistoryList).forEach(b => b.addEventListener('click', () => {
    const e = _biHistory()[+b.dataset.load]; if (!e) return;
    _biApplyHistoryEntry(e);
    dom.biHistoryOverlay.classList.add('hidden');
  }));
  $$('[data-del]', dom.biHistoryList).forEach(b => b.addEventListener('click', () => {
    const h = _biHistory(); h.splice(+b.dataset.del, 1);
    localStorage.setItem('_bi_history', JSON.stringify(h));
    _biRenderHistory();
  }));
}
function _biApplyHistoryEntry(e) {
  if (!_bi || !e.settings) return;
  const s = e.settings;
  if (s.width != null) dom.biWidth.value = s.width;
  if (s.height != null) dom.biHeight.value = s.height;
  dom.biWidthAuto.checked = !!s.widthAuto; dom.biHeightAuto.checked = !!s.heightAuto;
  if (s.crop) dom.biCrop.value = s.crop;
  if (s.format) dom.biFormat.value = s.format;
  if (s.quality != null) { dom.biQuality.value = s.quality; dom.biQualityVal.textContent = s.quality; }
  if (s.rename) dom.biRename.value = s.rename;
  if (s.renameStart != null) dom.biRenameStart.value = s.renameStart;
  if (s.padColor) dom.biPadColor.value = s.padColor;
  if (s.focal) dom.biFocal.value = s.focal;
  if (s.unit) dom.biUnit.value = s.unit;
  dom.biHq.checked = !!s.hq;
  if (s.borderColor) dom.biBorderColor.value = s.borderColor;
  if (s.borderW != null) dom.biBorderW.value = s.borderW;
  if (s.borderRadius != null) dom.biBorderRadius.value = s.borderRadius;
  dom.biBorderEnable.checked = !!s.borderEnable;
  dom.biKeepExif.checked = !!s.keepExif;
  if (s.prep) { _bi.prep = s.prep; _biUpdatePrepInfo(); }
  if (s.wmLayers) { _bi.wmLayers = _biDeserializeWmLayers(s.wmLayers); _biRenderWmLayers(); }
  _biUpdateUnitLabels(); _biTogglePadField(); _biToggleTargetRow();
  _biRenderPreview(); _biUpdateNamePreview();
  showToast('已载入历史设置', 'success');
}

// --- shared presets (team) + admin default ---
async function _biRefreshSharedPresets() {
  try {
    const data = await apiGetJson('/api/ai/presets');
    let h = '<option value="">— 团队预设 —</option>';
    (data.presets || []).forEach(p => { h += `<option value="${escapeHtml(p.name)}"${p.isDefault?' selected':''}>${escapeHtml(p.name)}${p.isDefault?' (默认)':''}</option>`; });
    dom.biSharedPreset.innerHTML = h;
  } catch (_) { dom.biSharedPreset.innerHTML = '<option value="">— 团队预设 —</option>'; }
}
async function _biLoadSharedPreset() {
  const name = dom.biSharedPreset.value; if (!name) return;
  try {
    const p = await apiGetJson('/api/ai/presets/' + encodeURIComponent(name));
    if (p && p.settings) _biApplyHistoryEntry({ settings: p.settings });
  } catch (e) { showToast('载入失败: ' + e.message, 'error'); }
}
async function _biPublishSharedPreset() {
  const name = prompt('发布为共享预设（名称）'); if (!name) return;
  const settings = _biReadSettings();
  settings.wmLayers = _biSerializeWmLayers();
  settings.prep = _bi ? _bi.prep : null;
  try {
    await apiPostJson('/api/ai/presets', { name, settings });
    showToast(`已发布共享预设「${name}」`, 'success');
    _biRefreshSharedPresets();
  } catch (e) { showToast('发布失败: ' + e.message, 'error'); }
}
async function _biSetSharedDefault() {
  const name = dom.biSharedPreset.value; if (!name) return;
  try {
    await apiPostJson('/api/ai/presets/default', { name });
    showToast(`已将「${name}」设为默认预设`, 'success');
    _biRefreshSharedPresets();
  } catch (e) { showToast('设置失败: ' + e.message, 'error'); }
}
async function _biMaybeApplyDefault() {
  // Apply admin default preset on first open (when user has no saved local settings)
  if (localStorage.getItem('_bi_settings')) return; // user already has preferences
  try {
    const cfg = await apiGetJson('/api/ai/config');
    const dp = cfg && cfg.defaultPreset;
    if (dp) {
      const p = await apiGetJson('/api/ai/presets/' + encodeURIComponent(dp));
      if (p && p.settings) _biApplyHistoryEntry({ settings: p.settings });
    }
  } catch (_) {}
}

function openBatchImages(paths) {
  // de-dupe, filter image types, enforce 50MB limit
  const seen = new Set();
  const items = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    const ext = (p.split('.').pop() || '').toLowerCase();
    if (!BI_IMG_EXTS.includes(ext)) continue;
    items.push({ path: p, name: p.split('/').pop(), ext, el: null, loaded: false, tooBig: false });
  }
  if (!items.length) { showToast('未选择有效的图片文件', 'error'); return; }
  _bi = { items, selIdx: 0, cancel: false, targetDir: '', existingNames: null, prep: { rotation: 0, flipH: false, flipV: false }, wmLayers: [], lastResults: null };
  dom.batchImgTitle.textContent = `批量图片处理 — ${items.length} 张图片`;
  _biLoadSettings();
  _biRefreshPresets();
  _biRefreshSharedPresets();
  _biRenderList();
  _biRenderWmLayers();
  _biUpdatePrepInfo();
  _biUpdateNamePreview();
  _biUpdateUnitLabels();
  _biMaybeApplyDefault();
  dom.biError.textContent = '';
  dom.biProgressWrap.style.display = 'none';
  dom.biStart.disabled = false;
  _biTogglePadField();
  _biToggleTargetRow();
  dom.batchImgOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // load thumbnails + check size
  items.forEach((it, i) => _biLoadImage(i));
}

async function _biLoadImage(i) {
  const it = _bi.items[i];
  try {
    const resp = await fetch('/api/file?path=' + encodeURIComponent(it.path), { method: 'GET', credentials: 'include' });
    if (!resp.ok) throw new Error('加载失败');
    // Early reject via Content-Length if available (avoid downloading huge files)
    const cl = parseInt(resp.headers.get('content-length') || '0', 10);
    if (cl && cl > 50 * 1024 * 1024) { it.tooBig = true; _biRenderList(); return; }
    const blob = await resp.blob();
    if (blob.size > 50 * 1024 * 1024) { it.tooBig = true; _biRenderList(); return; }
    it.origBlob = blob;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      it.el = img; it.loaded = true;
      _biRenderList();
      if (_bi.selIdx === i) _biRenderPreview();
    };
    img.onerror = () => { it.tooBig = true; _biRenderList(); };
    img.src = url;
  } catch (_) {
    it.tooBig = true; _biRenderList();
  }
}

function _biRenderList() {
  let h = '';
  _bi.items.forEach((it, i) => {
    const sel = i === _bi.selIdx ? 'background:var(--bg-hover);outline:1px solid var(--accent)' : '';
    const th = it.el ? `<img src="${it.el.src}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;pointer-events:none">` : (it.tooBig ? '<span style="color:var(--danger);font-size:18px">⚠</span>' : '<div class="spinner" style="width:16px;height:16px"></div>');
    const label = it.tooBig ? `${escapeHtml(it.name)} <span style="color:var(--danger);font-size:10px">超50M</span>` : escapeHtml(it.name);
    h += `<div class="bi-list-item" data-i="${i}" draggable="true" style="display:flex;gap:8px;align-items:center;padding:6px;border-radius:6px;cursor:pointer;${sel}"><span style="color:var(--muted);cursor:grab;font-size:12px">⋮⋮</span>${th}<span style="font-size:12px;word-break:break-all;flex:1;pointer-events:none">${label}</span></div>`;
  });
  dom.batchList.innerHTML = h;
  $$('.bi-list-item', dom.batchList).forEach(el => {
    el.addEventListener('click', () => {
      _bi.selIdx = +el.dataset.i;
      _biRenderList();
      _biRenderPreview();
    });
    el.addEventListener('dragstart', (e) => { _biDragFromIdx = +el.dataset.i; e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = +el.dataset.i;
      const from = _biDragFromIdx;
      _biDragFromIdx = null;
      if (from == null || from === to) return;
      const arr = _bi.items, moved = arr.splice(from, 1)[0];
      arr.splice(to, 0, moved);
      if (_bi.selIdx === from) _bi.selIdx = to;
      else if (from < _bi.selIdx && to >= _bi.selIdx) _bi.selIdx--;
      else if (from > _bi.selIdx && to <= _bi.selIdx) _bi.selIdx++;
      _biRenderList(); _biRenderPreview(); _biUpdateNamePreview();
    });
  });
}

function _biReadSettings() {
  return {
    width: parseInt(dom.biWidth.value, 10) || 0,
    height: parseInt(dom.biHeight.value, 10) || 0,
    widthAuto: dom.biWidthAuto.checked,
    heightAuto: dom.biHeightAuto.checked,
    crop: dom.biCrop.value,
    padColor: dom.biPadColor.value,
    focal: dom.biFocal.value,
    format: dom.biFormat.value,
    quality: parseInt(dom.biQuality.value, 10) / 100,
    rename: dom.biRename.value || 'ORIGINAL-NAME_xxx',
    renameStart: parseInt(dom.biRenameStart.value, 10) || 0,
    prep: _bi && _bi.prep ? _bi.prep : { rotation: 0, flipH: false, flipV: false },
    wmLayers: _bi ? _bi.wmLayers : [],
    unit: dom.biUnit.value,
    hq: dom.biHq.checked,
    borderEnable: dom.biBorderEnable.checked,
    borderColor: dom.biBorderColor.value,
    borderW: parseInt(dom.biBorderW.value, 10) || 0,
    borderRadius: parseInt(dom.biBorderRadius.value, 10) || 0,
    keepExif: dom.biKeepExif.checked,
  };
}

function _biComputeOutDims(natW, natH, s) {
  const pct = s.unit === 'pct';
  const toAbs = (v) => pct ? Math.round(natW * v / 100) : v; // width uses natW scale; height below uses natH
  let w = s.widthAuto ? null : (pct ? Math.round(natW * s.width / 100) : s.width);
  let h = s.heightAuto ? null : (pct ? Math.round(natH * s.height / 100) : s.height);
  if (w && !h) h = Math.round(w * natH / natW);
  if (h && !w) w = Math.round(h * natW / natH);
  if (!w && !h) { w = natW; h = natH; }
  w = Math.max(1, w); h = Math.max(1, h);
  return { w, h };
}

function _biOutMime(s, ext) {
  if (s.format !== 'keep') return s.format;
  for (const [mime, exts] of Object.entries(BI_KEEP_EXT)) if (exts.includes(ext)) return mime;
  return 'image/png';
}

function _biOutExt(mime, ext) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/avif') return 'avif';
  if (mime === 'image/gif') return 'gif';
  return ext || 'png';
}

function _biApplyRename(template, origName, index, w, h, startNum) {
  const base = origName.replace(/\.[^.]+$/, '');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const xMatch = template.match(/x{2,}/);
  const padLen = xMatch ? xMatch[0].length : 3;
  const num = String(startNum + index).padStart(padLen, '0');
  let out = template
    .replace(/ORIGINAL-NAME/g, base)
    .replace(/x{2,}/g, num)
    .replace(/\{w\}/g, w)
    .replace(/\{h\}/g, h)
    .replace(/\{date\}/g, date);
  return out;
}

// --- AVIF support detection ---
let _avifSupported = null;
function _biAvifSupported() {
  if (_avifSupported !== null) return Promise.resolve(_avifSupported);
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = 2; c.height = 2;
    c.toBlob((b) => {
      _avifSupported = !!(b && b.type === 'image/avif');
      resolve(_avifSupported);
    }, 'image/avif');
  });
}

// --- smartcrop lazy loader ---
let _smartcropPromise = null;
function _loadSmartcrop() {
  if (window.smartcrop) return Promise.resolve(window.smartcrop);
  if (_smartcropPromise) return _smartcropPromise;
  _smartcropPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/smartcrop.js@2.0.5/dist/smartcrop.min.js';
    s.onload = () => resolve(window.smartcrop || null);
    s.onerror = () => { _smartcropPromise = null; resolve(null); };
    document.head.appendChild(s);
  });
  return _smartcropPromise;
}

async function _biSmartCrop(src, outW, outH, item) {
  const key = `${outW}x${outH}`;
  if (item._smart && item._smart.key === key) return item._smart.crop;
  const sc = await _loadSmartcrop();
  if (!sc) return null;
  try {
    const res = await sc.crop(src, { width: outW, height: outH, minScale: 0.5 });
    const top = res && res.topCrop;
    if (top) { item._smart = { key, crop: { x: top.x, y: top.y, width: top.width, height: top.height } }; return item._smart.crop; }
  } catch (_) {}
  return null;
}

// --- pre-process (rotate/flip) ---
function _biSrcDims(src) {
  if (src instanceof HTMLCanvasElement) return { w: src.width, h: src.height };
  return { w: src.naturalWidth, h: src.naturalHeight };
}
function _biApplyPrep(img, prep) {
  if (!prep || (!prep.rotation && !prep.flipH && !prep.flipV)) return img;
  const rot = (prep.rotation || 0) % 360;
  const swap = rot === 90 || rot === 270;
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const w = swap ? sh : sw, h = swap ? sw : sh;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.scale(prep.flipH ? -1 : 1, prep.flipV ? -1 : 1);
  ctx.drawImage(img, -sw / 2, -sh / 2);
  return c;
}

// --- watermark layers (text + image, optional tiling) ---
function _biPosXY(pos, W, H, dw, dh, m) {
  let x, y, align;
  if (pos === 'br') { align = 'right'; x = W - m; y = H - m - dh / 2; }
  else if (pos === 'bl') { align = 'left'; x = m; y = H - m - dh / 2; }
  else if (pos === 'tr') { align = 'right'; x = W - m; y = m + dh / 2; }
  else if (pos === 'tl') { align = 'left'; x = m; y = m + dh / 2; }
  else { align = 'center'; x = W / 2; y = H / 2; }
  return { x, y, align };
}
function _biDrawWatermarks(ctx, W, H, s) {
  if (!s.wmLayers || !s.wmLayers.length) return;
  for (const l of s.wmLayers) {
    if (!l.enabled) continue;
    if (l.type === 'text') {
      if (!l.text) continue;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.fillStyle = l.color;
      ctx.font = `${l.size}px sans-serif`;
      ctx.textBaseline = 'middle';
      const m = 12;
      const { x, y, align } = _biPosXY(l.pos, W, H, ctx.measureText(l.text).width, l.size, m);
      ctx.textAlign = align;
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 2; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
      ctx.fillText(l.text, x, y);
      ctx.restore();
    } else if (l.type === 'image' && l.imgEl) {
      const base = Math.min(W, H) * (l.imgScale || 0.2);
      const iw = l.imgEl.naturalWidth, ih = l.imgEl.naturalHeight;
      const sc = base / Math.min(iw, ih);
      const dw = iw * sc, dh = ih * sc;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      if (l.tile) {
        const stepX = Math.max(1, dw * 1.4), stepY = Math.max(1, dh * 1.4);
        for (let yy = 0; yy < H; yy += stepY) {
          for (let xx = 0; xx < W; xx += stepX) {
            ctx.drawImage(l.imgEl, xx, yy, dw, dh);
          }
        }
      } else {
        const m = 12;
        const { x: cx, y: cy, align } = _biPosXY(l.pos, W, H, dw, dh, m);
        let dx = cx;
        if (align === 'right') dx = cx - dw;
        else if (align === 'center') dx = cx - dw / 2;
        let dy = cy - dh / 2;
        ctx.drawImage(l.imgEl, dx, dy, dw, dh);
      }
      ctx.restore();
    }
  }
}

// --- border (with optional rounded corners) ---
function _biDrawBorder(ctx, W, H, s) {
  if (!s.borderEnable || s.borderW <= 0) return;
  const t = s.borderW, r = s.borderRadius || 0;
  ctx.save();
  ctx.fillStyle = s.borderColor;
  if (r <= 0) {
    ctx.fillRect(0, 0, W, t);
    ctx.fillRect(0, H - t, W, t);
    ctx.fillRect(0, 0, t, H);
    ctx.fillRect(W - t, 0, t, H);
  } else {
    // draw rounded border via a ring path (outer rounded minus inner rounded)
    const rr = Math.min(r, W / 2, H / 2);
    ctx.beginPath();
    _biRoundRectPath(ctx, 0, 0, W, H, rr);
    _biRoundRectPath(ctx, t, t, W - 2 * t, H - 2 * t, Math.max(0, rr - t));
    ctx.fill('evenodd');
  }
  ctx.restore();
}
function _biRoundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// --- pica (high-quality resize) lazy loader ---
let _picaPromise = null;
function _loadPica() {
  if (window.pica) return Promise.resolve(window.pica);
  if (_picaPromise) return _picaPromise;
  _picaPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pica@9.0.1/dist/pica.min.js';
    s.onload = () => resolve(window.pica || null);
    s.onerror = () => { _picaPromise = null; resolve(null); };
    document.head.appendChild(s);
  });
  return _picaPromise;
}
async function _biResizeHq(srcCanvas, dstCanvas) {
  const p = await _loadPica();
  if (!p) { dstCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, dstCanvas.width, dstCanvas.height); return; }
  await p.resize(srcCanvas, dstCanvas, { alpha: true });
}

// --- EXIF APP1 preservation (JPEG only) ---
async function _biExtractExifApp1(blob) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(bytes.buffer);
    if (bytes.length < 4 || dv.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off < bytes.length - 4) {
      const marker = dv.getUint16(off);
      if (marker === 0xFFE1) {
        const len = dv.getUint16(off + 2);
        if (len >= 8 && bytes[off+4]===0x45 && bytes[off+5]===0x78 && bytes[off+6]===0x69 && bytes[off+7]===0x66) {
          return bytes.slice(off, off + 2 + len);
        }
      }
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFD9 || marker === 0xFFDA) break;
      const len = dv.getUint16(off + 2);
      off += 2 + len;
    }
  } catch (_) {}
  return null;
}
async function _biInjectExif(outBlob, app1) {
  if (!app1) return outBlob;
  const out = new Uint8Array(await outBlob.arrayBuffer());
  const dv = new DataView(out.buffer);
  if (out.length < 4 || dv.getUint16(0) !== 0xFFD8) return outBlob;
  const r = new Uint8Array(2 + app1.length + (out.length - 2));
  r.set(out.slice(0, 2), 0);
  r.set(app1, 2);
  r.set(out.slice(2), 2 + app1.length);
  return new Blob([r], { type: 'image/jpeg' });
}

// --- main processing pipeline (async due to smartcrop/pica) ---
async function _biProcessImage(item, s) {
  const src = _biApplyPrep(item.el, s.prep);
  const { w: pw, h: ph } = _biSrcDims(src);
  const { w: outW, h: outH } = _biComputeOutDims(pw, ph, s);
  let outMime = _biOutMime(s, item.ext);
  if (outMime === 'image/avif' && !(await _biAvifSupported())) {
    if (!window._biAvifToastShown) { window._biAvifToastShown = true; showToast('浏览器不支持 AVIF，已回退到 WebP', 'error'); }
    outMime = 'image/webp';
  }

  // Determine source content region
  let region = { sx: 0, sy: 0, sw: pw, sh: ph };
  if (s.crop === 'crop') {
    const aspect = outW / outH;
    let ww, wh;
    if (pw / ph > aspect) { ww = ph * aspect; wh = ph; } else { ww = pw; wh = pw / aspect; }
    let cx = pw / 2, cy = ph / 2;
    if (s.focal === 'manual' && item.focal) { cx = item.focal.x * pw; cy = item.focal.y * ph; }
    else if (s.focal === 'smart') {
      const crop = await _biSmartCrop(src, outW, outH, item);
      if (crop) region = { sx: crop.x, sy: crop.y, sw: crop.width, sh: crop.height };
      else { region = { sx: Math.max(0, Math.min(cx - ww/2, pw - ww)), sy: Math.max(0, Math.min(cy - wh/2, ph - wh)), sw: ww, sh: wh }; }
    } else {
      region = { sx: Math.max(0, Math.min(cx - ww/2, pw - ww)), sy: Math.max(0, Math.min(cy - wh/2, ph - wh)), sw: ww, sh: wh };
    }
  }

  // Build content canvas at source-region resolution
  const content = document.createElement('canvas');
  content.width = Math.max(1, Math.round(region.sw));
  content.height = Math.max(1, Math.round(region.sh));
  content.getContext('2d').drawImage(src, region.sx, region.sy, region.sw, region.sh, 0, 0, content.width, content.height);

  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d');

  const fillBg = () => { if (outMime === 'image/jpeg') { ctx.fillStyle = s.padColor || '#ffffff'; ctx.fillRect(0, 0, outW, outH); } };

  if (s.crop === 'pad') {
    fillBg();
    if (outMime !== 'image/jpeg') { ctx.fillStyle = s.padColor || '#ffffff'; ctx.fillRect(0, 0, outW, outH); }
    const scale = Math.min(outW / pw, outH / ph);
    const dw = Math.max(1, Math.round(pw * scale));
    const dh = Math.max(1, Math.round(ph * scale));
    // resize whole src into a contained canvas, then composite
    if (s.hq) {
      const tmp = document.createElement('canvas'); tmp.width = dw; tmp.height = dh;
      await _biResizeHq(src, tmp);
      ctx.drawImage(tmp, (outW - dw) / 2, (outH - dh) / 2);
    } else {
      ctx.drawImage(src, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
    }
  } else {
    // stretch or crop: content → target (fills)
    if (s.hq && (content.width !== outW || content.height !== outH)) {
      await _biResizeHq(content, canvas);
    } else {
      ctx.drawImage(content, 0, 0, outW, outH);
    }
    // for jpeg, fill bg first was skipped — do it before drawImage to avoid black for transparent
    // (content has no alpha from a photo; for PNG sources exported to jpeg, fill bg)
    if (outMime === 'image/jpeg') {
      // re-do: we already drew; to keep bg under transparent pixels, redraw with bg
      const tmp = document.createElement('canvas'); tmp.width = outW; tmp.height = outH;
      const tctx = tmp.getContext('2d');
      tctx.fillStyle = s.padColor || '#ffffff'; tctx.fillRect(0, 0, outW, outH);
      tctx.drawImage(canvas, 0, 0);
      ctx.clearRect(0, 0, outW, outH);
      ctx.drawImage(tmp, 0, 0);
    }
  }

  _biDrawBorder(ctx, outW, outH, s);
  _biDrawWatermarks(ctx, outW, outH, s);
  return { canvas, w: outW, h: outH, outMime };
}

let _biPreviewToken = 0;
async function _biRenderPreview() {
  if (!_bi) return;
  const it = _bi.items[_bi.selIdx];
  dom.biPreviewName.textContent = it ? it.name : '';
  if (!it || !it.loaded) { dom.batchPreviewWrap.innerHTML = '<div class="settings-hint">图片加载中或无法预览</div>'; dom.batchPreviewInfo.textContent = ''; return; }
  const s = _biReadSettings();
  dom.biResetFocal.style.display = (s.focal === 'manual' && it.focal) ? '' : 'none';
  const myToken = ++_biPreviewToken;
  try {
    const { canvas, w, h, outMime } = await _biProcessImage(it, s);
    if (myToken !== _biPreviewToken) return; // a newer render superseded
    const maxDim = 520;
    const dispScale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    const disp = document.createElement('canvas');
    disp.width = Math.round(canvas.width * dispScale);
    disp.height = Math.round(canvas.height * dispScale);
    disp.getContext('2d').drawImage(canvas, 0, 0, disp.width, disp.height);
    dom.batchPreviewWrap.innerHTML = '';
    disp.style.maxWidth = '100%'; disp.style.maxHeight = '100%'; disp.style.border = '1px solid var(--border)'; disp.style.borderRadius = '6px';
    disp.dataset.biDisp = '1';
    dom.batchPreviewWrap.appendChild(disp);
    // focal marker
    if (s.focal === 'manual' && it.focal) {
      const mk = document.createElement('div');
      mk.style.cssText = `position:absolute;left:${it.focal.x * 100}%;top:${it.focal.y * 100}%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;border:2px solid #fff;background:rgba(137,180,250,0.6);box-shadow:0 0 0 1px #000;pointer-events:none`;
      dom.batchPreviewWrap.appendChild(mk);
    }
    const outName = _biApplyRename(s.rename, it.name, _bi.selIdx, w, h, s.renameStart) + '.' + _biOutExt(outMime, it.ext);
    dom.batchPreviewInfo.textContent = `${it.name} → ${outName} (${w}×${h}, ${outMime.replace('image/', '')})`;
    _bi._lastProcCanvas = canvas; // for compare
    _bi._lastSrcForCompare = it.el;
  } catch (err) {
    dom.batchPreviewInfo.textContent = '预览失败: ' + err.message;
  }
}

function _biRenderOriginal() {
  const it = _bi.items[_bi.selIdx];
  if (!it || !it.loaded) return;
  const s = _biReadSettings();
  const src = _biApplyPrep(it.el, s.prep);
  const maxDim = 520;
  const { w, h } = _biSrcDims(src);
  const dispScale = Math.min(1, maxDim / Math.max(w, h));
  const disp = document.createElement('canvas');
  disp.width = Math.round(w * dispScale); disp.height = Math.round(h * dispScale);
  disp.getContext('2d').drawImage(src, 0, 0, disp.width, disp.height);
  dom.batchPreviewWrap.innerHTML = '';
  disp.style.maxWidth = '100%'; disp.style.maxHeight = '100%'; disp.style.border = '1px solid var(--border)'; disp.style.borderRadius = '6px';
  dom.batchPreviewWrap.appendChild(disp);
}

function _biUpdateNamePreview() {
  if (!_bi || !_bi.items.length) return;
  const it = _bi.items[0];
  const s = _biReadSettings();
  if (!it.loaded) { dom.biNamePreview.textContent = '（图片加载中...）'; return; }
  const src = _biApplyPrep(it.el, s.prep);
  const { w, h } = _biSrcDims(src);
  const { w: ow, h: oh } = _biComputeOutDims(w, h, s);
  const outMime = _biOutMime(s, it.ext);
  const outName = _biApplyRename(s.rename, it.name, 0, ow, oh, s.renameStart) + '.' + _biOutExt(outMime, it.ext);
  dom.biNamePreview.textContent = outName;
}

function _biTogglePadField() { dom.biPadField.style.display = dom.biCrop.value === 'pad' ? '' : 'none'; }
function _biToggleTargetRow() { dom.biTargetRow.style.display = dom.biOutput.value === 'dir' ? '' : 'none'; }

async function _biEnsureTargetDir() {
  if (_bi.targetDir === '') return true;
  try {
    await apiBrowse(_bi.targetDir);
    return true;
  } catch (_) { return false; }
}

function _biPickDir() {
  // reuse a simple browse modal
  let cwd = _bi.targetDir || '';
  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  overlay.style.display = 'flex'; overlay.style.zIndex = '4000';
  overlay.innerHTML = `
    <div class="dialog-modal" style="width:520px">
      <div class="dialog-header"><h3>选择目标目录</h3><button class="btn-icon" title="关闭">&times;</button></div>
      <div class="dialog-body" style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow:hidden">
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn-secondary" data-up style="padding:5px 10px">上级</button>
          <span class="settings-hint" data-path style="flex:1;font-family:var(--mono);word-break:break-all"></span>
        </div>
        <div data-grid style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px"></div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" data-cancel>取消</button>
        <button class="btn-primary" data-ok>选择此目录</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const grid = overlay.querySelector('[data-grid]');
  const pathEl = overlay.querySelector('[data-path]');
  const close = () => overlay.remove();
  overlay.querySelector('.btn-icon').addEventListener('click', close);
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-up]').addEventListener('click', () => { cwd = cwd.split('/').slice(0, -1).join('/'); render(); });
  overlay.querySelector('[data-ok]').addEventListener('click', () => {
    _bi.targetDir = cwd;
    dom.biTargetPath.textContent = '/' + cwd;
    close();
  });
  async function render() {
    pathEl.textContent = '/' + cwd;
    grid.innerHTML = '<div class="settings-hint">加载中...</div>';
    try {
      const data = await apiBrowse(cwd);
      const dirs = (data.entries || []).filter(e => e.type === 'directory');
      grid.innerHTML = '';
      if (cwd) { const d = document.createElement('div'); d.textContent='📁 ..'; d.style.cssText='cursor:pointer;padding:6px;border-radius:4px'; d.addEventListener('click',()=>{cwd=cwd.split('/').slice(0,-1).join('/');render();}); grid.appendChild(d); }
      dirs.forEach(dd => {
        const d = document.createElement('div');
        d.textContent = '📁 ' + dd.name;
        d.style.cssText = 'cursor:pointer;padding:6px;border-radius:4px';
        d.addEventListener('mouseenter',()=>d.style.background='var(--bg-hover)');
        d.addEventListener('mouseleave',()=>d.style.background='');
        d.addEventListener('click', () => { cwd = cwd ? cwd + '/' + dd.name : dd.name; render(); });
        grid.appendChild(d);
      });
      if (!grid.children.length) grid.innerHTML = '<div class="settings-hint">无子目录</div>';
    } catch (err) { grid.innerHTML = `<div class="settings-hint" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; }
  }
  render();
}

async function _biProcessAll() {
  dom.biError.textContent = '';
  const s = _biReadSettings();
  _biSaveSettings();
  if (dom.biOutput.value === 'dir' && !(await _biEnsureTargetDir())) {
    dom.biError.textContent = '请选择有效的目标目录'; return;
  }
  // gather existing names in target dir to avoid overwrite
  if (dom.biOutput.value === 'dir' && _bi.targetDir !== '') {
    try {
      const data = await apiBrowse(_bi.targetDir);
      _bi.existingNames = new Set((data.entries || []).map(e => e.name));
    } catch (_) { _bi.existingNames = new Set(); }
  } else { _bi.existingNames = new Set(); }
  _bi.cancel = false;
  dom.biProgressWrap.style.display = 'flex';
  dom.biStart.disabled = true;
  dom.biProgress.max = _bi.items.length;
  dom.biProgress.value = 0;
  dom.biProgressText.textContent = `0/${_bi.items.length}`;
  const results = [];
  const blobs = []; // for zip
  for (let i = 0; i < _bi.items.length; i++) {
    if (_bi.cancel) break;
    const it = _bi.items[i];
    try {
      if (!it.loaded) throw new Error('图片未加载');
      if (it.tooBig) throw new Error('超过50MB上限');
      const { canvas, w, h, outMime } = await _biProcessImage(it, s);
      let blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('导出失败')), outMime, s.quality));
      // EXIF preservation: JPEG source -> JPEG output, when keepExif enabled
      if (s.keepExif && outMime === 'image/jpeg' && (it.ext === 'jpg' || it.ext === 'jpeg') && it.origBlob) {
        const app1 = await _biExtractExifApp1(it.origBlob);
        if (app1) blob = await _biInjectExif(blob, app1);
      }
      const baseName = _biApplyRename(s.rename, it.name, i, w, h, s.renameStart);
      const ext = _biOutExt(outMime, it.ext);
      let outName = baseName + '.' + ext;
      // avoid overwrite: append _1, _2... if exists (default don't overwrite)
      if (_bi.existingNames.has(outName)) {
        let n = 1;
        while (_bi.existingNames.has(`${baseName}_${n}.${ext}`)) n++;
        outName = `${baseName}_${n}.${ext}`;
      }
      _bi.existingNames.add(outName);
      results.push({ name: outName, blob, ok: true });
      blobs.push({ name: outName, blob });
    } catch (err) {
      results.push({ name: it.name, ok: false, error: err.message });
    }
    dom.biProgress.value = i + 1;
    dom.biProgressText.textContent = `${i + 1}/${_bi.items.length}`;
  }
  // output
  _bi.lastResults = null;
  try {
    if (dom.biOutput.value === 'zip') {
      const zipBlob = await _biMakeZip(blobs);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = `images_${Date.now()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else {
      // upload each to target dir (or root if empty)
      const dir = _bi.targetDir || '';
      const saved = [];
      for (const r of results) {
        if (!r.ok) continue;
        const fd = new FormData();
        fd.append('uploadDir', dir);
        fd.append('files', r.blob, r.name);
        try { await apiUpload(fd); saved.push({ name: r.name, path: dir ? dir + '/' + r.name : r.name }); }
        catch (e) { r.ok = false; r.error = e.message; }
      }
      _bi.lastResults = saved;
    }
  } catch (err) { dom.biError.textContent = '输出失败: ' + err.message; }
  const ok = results.filter(r => r.ok).length;
  const fail = results.length - ok;
  let msg = `处理完成 ${ok}/${results.length}`;
  if (fail > 0) msg += `，${fail} 个失败`;
  showToast(msg, fail > 0 ? 'error' : 'success');
  if (dom.biOutput.value === 'dir') refreshCurrent();
  // show "→ AI 工作流" button only when we have saved image paths in a dir
  dom.biToAi.style.display = (_bi.lastResults && _bi.lastResults.length) ? '' : 'none';
  dom.biStart.disabled = false;
  dom.biProgressWrap.style.display = 'none';
  // record history (only if something was processed)
  if (results.length) {
    _biRecordHistory({
      id: Date.now(),
      time: new Date().toISOString(),
      count: results.length, ok, fail,
      outputMode: dom.biOutput.value,
      settings: { ...s, wmLayers: _biSerializeWmLayers(), prep: _bi.prep },
      inputNames: _bi.items.map(it => it.name),
      outputNames: results.map(r => r.name),
    });
  }
}

// Minimal store-mode (no compression) ZIP builder in the browser
function _biMakeZip(files) {
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder();
  const parts = [], central = []; let offset = 0;
  return (async () => {
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const nameBuf = enc.encode(f.name);
      const crc = crc32(data), size = data.length;
      const lh = new Uint8Array(30);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
      dv.setUint16(8, 0, true); dv.setUint16(10, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true);
      dv.setUint16(26, nameBuf.length, true); dv.setUint16(28, 0, true);
      parts.push(lh, nameBuf, data);
      const cd = new Uint8Array(46); const cdv = new DataView(cd.buffer);
      cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true);
      cdv.setUint16(8, 0, true); cdv.setUint16(10, 0, true);
      cdv.setUint32(16, crc, true); cdv.setUint32(20, size, true); cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBuf.length, true); cdv.setUint16(30, 0, true); cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true); cdv.setUint32(38, 0, true); cdv.setUint32(42, offset, true);
      central.push(cd, nameBuf);
      offset += lh.length + nameBuf.length + data.length;
    }
    const centralBuf = _concatU8(central);
    const end = new Uint8Array(22); const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralBuf.length, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
    return new Blob([_concatU8(parts), centralBuf, end], { type: 'application/zip' });
  })();
  function _concatU8(arr) { let len = 0; for (const a of arr) len += a.length; const r = new Uint8Array(len); let o = 0; for (const a of arr) { r.set(a, o); o += a.length; } return r; }
}

function closeBatchImages() {
  dom.batchImgOverlay.classList.add('hidden');
  document.body.style.overflow = '';
  _bi = null;
}

// Wire up events
dom.ctxBatchImages.addEventListener('click', () => {
  if (!contextTarget) return;
  const imgs = [];
  if (state.selected.size > 0) {
    for (const p of state.selected) {
      const ext = (p.split('.').pop() || '').toLowerCase();
      if (BI_IMG_EXTS.includes(ext)) imgs.push(p);
    }
  }
  if (!imgs.length) imgs.push(getFilePath(contextTarget));
  hideContextMenu();
  openBatchImages(imgs);
});
dom.batchImgClose.addEventListener('click', closeBatchImages);
dom.batchImgOverlay.addEventListener('click', e => { if (e.target === dom.batchImgOverlay) closeBatchImages(); });
dom.biCrop.addEventListener('change', () => { _biTogglePadField(); _biRenderPreview(); _biUpdateNamePreview(); _biSaveSettings(); });
dom.biFormat.addEventListener('change', () => { _biRenderPreview(); _biUpdateNamePreview(); _biSaveSettings(); });
dom.biQuality.addEventListener('input', () => { dom.biQualityVal.textContent = dom.biQuality.value; _biSaveSettings(); });
dom.biWidth.addEventListener('input', () => { _biRenderPreview(); _biUpdateNamePreview(); });
dom.biHeight.addEventListener('input', () => { _biRenderPreview(); _biUpdateNamePreview(); });
dom.biWidthAuto.addEventListener('change', () => { _biRenderPreview(); _biUpdateNamePreview(); _biSaveSettings(); });
dom.biHeightAuto.addEventListener('change', () => { _biRenderPreview(); _biUpdateNamePreview(); _biSaveSettings(); });
dom.biPadColor.addEventListener('input', () => { _biRenderPreview(); _biSaveSettings(); });
dom.biRename.addEventListener('input', () => { _biRenderPreview(); _biUpdateNamePreview(); });
dom.biRenameStart.addEventListener('input', () => { _biRenderPreview(); _biUpdateNamePreview(); });
dom.biOutput.addEventListener('change', () => { _biToggleTargetRow(); _biSaveSettings(); });
dom.biPickDir.addEventListener('click', _biPickDir);
dom.biStart.addEventListener('click', _biProcessAll);
dom.biCancel.addEventListener('click', () => { _bi.cancel = true; });

// P1 extras wiring
dom.biFocal.addEventListener('change', () => { _biRenderPreview(); _biSaveSettings(); });
// pre-process buttons
dom.biRotL.addEventListener('click', () => { if (_bi) { _bi.prep.rotation = (_bi.prep.rotation + 270) % 360; _biUpdatePrepInfo(); _biInvalidateItemCaches(); _biRenderPreview(); _biSaveSettings(); } });
dom.biRotR.addEventListener('click', () => { if (_bi) { _bi.prep.rotation = (_bi.prep.rotation + 90) % 360; _biUpdatePrepInfo(); _biInvalidateItemCaches(); _biRenderPreview(); _biSaveSettings(); } });
dom.biFlipH.addEventListener('click', () => { if (_bi) { _bi.prep.flipH = !_bi.prep.flipH; _biUpdatePrepInfo(); _biInvalidateItemCaches(); _biRenderPreview(); _biSaveSettings(); } });
dom.biFlipV.addEventListener('click', () => { if (_bi) { _bi.prep.flipV = !_bi.prep.flipV; _biUpdatePrepInfo(); _biInvalidateItemCaches(); _biRenderPreview(); _biSaveSettings(); } });
dom.biPrepReset.addEventListener('click', () => { if (_bi) { _bi.prep = { rotation: 0, flipH: false, flipV: false }; _biUpdatePrepInfo(); _biInvalidateItemCaches(); _biRenderPreview(); _biSaveSettings(); } });
// watermark + border (layer-based; layer inputs are wired in _biRenderWmLayers)
['input','change'].forEach(ev => {
  dom.biBorderColor.addEventListener(ev, _biRenderPreview);
  dom.biBorderW.addEventListener(ev, _biRenderPreview);
  dom.biBorderRadius.addEventListener(ev, _biRenderPreview);
});
dom.biWmAddText.addEventListener('click', () => { if (_bi) { _bi.wmLayers.push(_biWmNewText()); _biRenderWmLayers(); _biRenderPreview(); _biSaveSettings(); } });
dom.biWmAddImg.addEventListener('click', () => dom.biWmImgInput.click());
dom.biWmImgInput.addEventListener('change', () => {
  const f = dom.biWmImgInput.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    if (_bi) { _bi.wmLayers.push(Object.assign(_biWmNewImage(), { imgEl: img })); _biRenderWmLayers(); _biRenderPreview(); _biSaveSettings(); }
  };
  img.src = URL.createObjectURL(f);
  dom.biWmImgInput.value = '';
});
dom.biBorderEnable.addEventListener('change', _biRenderPreview);
// P2: unit, HQ, EXIF
dom.biUnit.addEventListener('change', () => { _biUpdateUnitLabels(); _biRenderPreview(); _biUpdateNamePreview(); _biSaveSettings(); });
dom.biHq.addEventListener('change', () => { _biRenderPreview(); _biSaveSettings(); });
dom.biKeepExif.addEventListener('change', _biSaveSettings);
// presets
dom.biPreset.addEventListener('change', () => { if (dom.biPreset.value) _biApplyPreset(dom.biPreset.value); });
dom.biPresetSave.addEventListener('click', () => {
  const name = prompt('预设名称'); if (!name) return;
  const ps = _biPresets(); ps[name] = _biReadSettings(); ps[name].prep = _bi ? _bi.prep : null;
  localStorage.setItem('_bi_presets', JSON.stringify(ps)); _biRefreshPresets(); dom.biPreset.value = name;
  showToast(`已保存预设「${name}」`, 'success');
});
dom.biPresetDel.addEventListener('click', () => {
  const name = dom.biPreset.value; if (!name) return;
  const ps = _biPresets(); delete ps[name]; localStorage.setItem('_bi_presets', JSON.stringify(ps)); _biRefreshPresets();
  showToast(`已删除预设「${name}」`, 'success');
});
// P3: preset import/export + history
dom.biPresetExport.addEventListener('click', _biExportPresets);
dom.biPresetImport.addEventListener('click', () => dom.biPresetImportInput.click());
dom.biPresetImportInput.addEventListener('change', () => {
  const f = dom.biPresetImportInput.files[0]; if (f) _biImportPresets(f);
  dom.biPresetImportInput.value = '';
});
dom.biHistory.addEventListener('click', () => { _biRenderHistory(); dom.biHistoryOverlay.classList.remove('hidden'); });
dom.biHistoryClose.addEventListener('click', () => dom.biHistoryOverlay.classList.add('hidden'));
dom.biHistoryOverlay.addEventListener('click', e => { if (e.target === dom.biHistoryOverlay) dom.biHistoryOverlay.classList.add('hidden'); });
dom.biHistoryClear.addEventListener('click', () => {
  if (!confirm('清空全部批量处理历史？')) return;
  localStorage.removeItem('_bi_history'); _biRenderHistory();
});
// P3: shared presets + admin default
dom.biSharedLoad.addEventListener('click', _biLoadSharedPreset);
dom.biSharedPublish.addEventListener('click', _biPublishSharedPreset);
dom.biSharedDefault.addEventListener('click', _biSetSharedDefault);
// before/after compare (hold to show original)
dom.biCompare.addEventListener('mousedown', () => { _bi._holdProc = true; if (_bi) _biRenderOriginal(); });
const _biRestoreProc = () => { if (_bi && _bi._holdProc) { _bi._holdProc = false; _biRenderPreview(); } };
dom.biCompare.addEventListener('mouseup', _biRestoreProc);
dom.biCompare.addEventListener('mouseleave', _biRestoreProc);
dom.biCompare.addEventListener('touchstart', (e) => { e.preventDefault(); _bi._holdProc = true; if (_bi) _biRenderOriginal(); }, { passive: false });
dom.biCompare.addEventListener('touchend', _biRestoreProc);
// manual focal: click on preview canvas
dom.batchPreviewWrap.addEventListener('click', (e) => {
  if (!_bi) return;
  const s = _biReadSettings();
  if (s.focal !== 'manual') return;
  const disp = dom.batchPreviewWrap.querySelector('canvas[data-bi-disp]');
  if (!disp) return;
  const rect = disp.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  _bi.items[_bi.selIdx].focal = { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
  _biRenderPreview();
});
dom.biResetFocal.addEventListener('click', () => {
  if (_bi && _bi.items[_bi.selIdx]) { _bi.items[_bi.selIdx].focal = null; _biRenderPreview(); }
});

// P2: run AI workflow on saved results
dom.biToAi.addEventListener('click', async () => {
  if (!_bi || !_bi.lastResults || !_bi.lastResults.length) return;
  const paths = _bi.lastResults.map(r => r.path);
  try {
    const data = await apiGetJson('/api/ai/workflows-for-images');
    const wfs = data.workflows || [];
    if (!wfs.length) { showToast('无图片输入类型的 AI 工作流', 'error'); return; }
    // simple picker
    const overlay = document.createElement('div');
    overlay.className = 'preview-overlay'; overlay.style.display = 'flex'; overlay.style.zIndex = '4000';
    overlay.innerHTML = `<div class="dialog-modal" style="width:420px"><div class="dialog-header"><h3>选择 AI 工作流</h3></div>
      <div class="dialog-body" style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow-y:auto">
      ${wfs.map(w => `<button class="btn-secondary" data-wfid="${escapeHtml(w.id)}" style="text-align:left;padding:8px">${escapeHtml(w.name)}${w.imageInputCount>1?` ·${w.imageInputCount}图`:''}</button>`).join('')}
      </div><div class="dialog-footer"><button class="btn-secondary" data-cancel>取消</button></div></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    $$('[data-wfid]', overlay).forEach(btn => btn.addEventListener('click', async () => {
      const wfId = btn.dataset.wfid;
      const wf = wfs.find(w => w.id === wfId);
      close();
      try {
        if (wf && wf.imageInputCount > 1) {
          showToast('多图工作流请从文件管理器右键使用', 'error'); return;
        }
        const r = await apiPostJson('/api/ai/tasks/batch', {
          workflowId: wfId,
          imageRefs: paths.map(path => ({ rootId: 'main', path })),
        });
        showToast(`已对 ${r.count} 张结果提交 AI 任务`, 'success');
        dom.biToAi.style.display = 'none';
      } catch (e) { showToast('提交失败: ' + e.message, 'error'); }
    }));
  } catch (err) { showToast('加载工作流失败: ' + err.message, 'error'); }
});

// P2: drag-reorder image list
let _biDragFromIdx = null;
function _biBindListDrag() {
  // delegated handlers attached once in _biRenderList via draggable attr
}

function _biInvalidateItemCaches() {
  if (!_bi) return;
  _bi.items.forEach(it => { it._smart = null; });
}

dom.ctxRename.addEventListener('click', () => {
  if (!contextTarget) return;
  const entry = contextTarget;
  hideContextMenu();
  openDialog('rename', entry.type === 'directory' ? '重命名文件夹' : '重命名文件', entry.name, async (newName) => {
    const fp = getFilePath(entry);
    await apiRename(fp, newName);
    showToast(`已重命名为 "${newName}"`, 'success');
    refreshCurrent();
  });
});

dom.ctxDownload.addEventListener('click', () => {
  if (!contextTarget || contextTarget.type === 'directory') return;
  const entry = contextTarget;
  hideContextMenu();
  window.open(getFileUrl(entry) + '&download=1', '_blank');
});

dom.ctxMove.addEventListener('click', () => {
  if (!contextTarget) return;
  const entry = contextTarget;
  hideContextMenu();
  openMoveDialog(entry);
});

dom.ctxDelete.addEventListener('click', () => {
  if (!contextTarget) return;
  const entry = contextTarget;
  hideContextMenu();
  const label = entry.type === 'directory' ? `文件夹 "${entry.name}"` : `文件 "${entry.name}"`;
  openDialog('delete', `确定删除 ${label}？`, '', async () => {
    const fp = getFilePath(entry);
    await apiDelete(fp);
    showToast(`已删除 "${entry.name}"`, 'success');
    refreshCurrent();
  });
});

document.addEventListener('click', (e) => {
  if (!dom.contextMenu.classList.contains('hidden') && !dom.contextMenu.contains(e.target)) {
    hideContextMenu();
  }
  if (!dom.ctxAiSub.classList.contains('hidden') && !dom.ctxAiSub.contains(e.target) && !dom.ctxAi.contains(e.target)) {
    hideAiSubmenu();
  }
});

// === Operation Dialog ===
let dialogMode = '';
let dialogTarget = null;

function openDialog(mode, title, value, onConfirm) {
  dialogMode = mode;
  dom.dialogTitle.textContent = title;
  dom.dialogInput.value = value || '';
  dom.dialogInput.placeholder = mode === 'delete' ? '' : '输入新名称...';
  dom.dialogInput.style.display = mode === 'delete' ? 'none' : '';
  dom.dialogError.textContent = '';
  dom.dialogInput.classList.remove('input-error');
  dom.dialogConfirm.className = mode === 'delete' ? 'btn-primary btn-danger' : 'btn-primary';
  dom.dialogConfirm.textContent = mode === 'delete' ? '删除' : '确认';
  dom.dialogOverlay.classList.remove('hidden');

  if (mode !== 'delete') setTimeout(() => dom.dialogInput.focus(), 100);

  const handler = async () => {
    const inputVal = dom.dialogInput.value.trim();
    if (mode !== 'delete' && !inputVal) {
      dom.dialogError.textContent = '请输入名称';
      dom.dialogInput.classList.add('input-error');
      return;
    }
    dom.dialogConfirm.disabled = true;
    try {
      await onConfirm(inputVal);
      closeDialog();
    } catch (err) {
      dom.dialogError.textContent = err.message;
      dom.dialogInput.classList.add('input-error');
    } finally {
      dom.dialogConfirm.disabled = false;
    }
  };

  dom.dialogConfirm.replaceWith(dom.dialogConfirm.cloneNode(true));
  dom.dialogConfirm = $('#dialog-confirm');
  dom.dialogConfirm.addEventListener('click', handler);

  dom.dialogInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handler();
  }, { once: true });
}

function closeDialog() {
  dom.dialogOverlay.classList.add('hidden');
  dialogMode = '';
  dialogTarget = null;
}

[dom.dialogCancel, dom.dialogClose].forEach(el => el.addEventListener('click', closeDialog));
dom.dialogOverlay.addEventListener('click', (e) => {
  if (e.target === dom.dialogOverlay) closeDialog();
});

// === Move Dialog ===
let moveTarget = null;
let moveTargetDir = '';
let batchMoveMode = false;

async function openMoveDialog(entry) {
  moveTarget = entry;
  moveTargetDir = '';
  batchMoveMode = false;
  dom.moveTitle.textContent = `移动 "${entry.name}"`;
  dom.moveCurrent.textContent = '目标: /';
  dom.moveError.textContent = '';
  dom.moveOverlay.classList.remove('hidden');
  dom.moveTree.innerHTML = '<div class="tree-spinner"></div>';

  try {
    await buildMoveTree();
  } catch (err) {
    dom.moveTree.innerHTML = `<div class="tree-error">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function buildMoveTree() {
  const data = await apiBrowse('');
  dom.moveTree.innerHTML = '';

  const rootNode = createMoveTreeNode('Root', '', true);
  dom.moveTree.appendChild(rootNode);
}

function createMoveTreeNode(name, fullPath, isRoot) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  const content = document.createElement('div');
  content.className = 'tree-node-content';
  if ((!fullPath && isRoot) || fullPath === '') {
    content.classList.add('selected');
    moveTargetDir = '';
  }

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '\u{1F4C1}';

  const label = document.createElement('span');
  label.className = 'tree-name';
  label.textContent = name;

  content.appendChild(toggle);
  content.appendChild(icon);
  content.appendChild(label);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'tree-children collapsed';

  node.appendChild(content);
  node.appendChild(childrenContainer);

  // Toggle expand
  toggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (childrenContainer.classList.contains('collapsed')) {
      childrenContainer.classList.remove('collapsed');
      toggle.classList.add('expanded');

      if (childrenContainer.children.length === 0) {
        childrenContainer.innerHTML = '<div class="tree-spinner"></div>';
        try {
          const browsePath = fullPath || '';
          const data = await apiBrowse(browsePath);
          const dirs = data.entries.filter(e => e.type === 'directory');
          childrenContainer.innerHTML = '';
          dirs.forEach((child) => {
            const childPath = fullPath ? `${fullPath}/${child.name}` : child.name;
            childrenContainer.appendChild(createMoveTreeNode(child.name, childPath, false));
          });
          if (dirs.length === 0) {
            childrenContainer.innerHTML = '';
            toggle.classList.add('empty');
          }
        } catch (_) {
          childrenContainer.innerHTML = '<div class="tree-error">加载失败</div>';
        }
      }
    } else {
      childrenContainer.classList.add('collapsed');
      toggle.classList.remove('expanded');
    }
  });

  // Select target
  content.addEventListener('click', (e) => {
    e.stopPropagation();
    moveTargetDir = fullPath || '';
    dom.moveTree.querySelectorAll('.tree-node-content.selected').forEach(el => el.classList.remove('selected'));
    content.classList.add('selected');
    dom.moveCurrent.textContent = `目标: /${fullPath}`;
    dom.moveError.textContent = '';
  });

  return node;
}

function closeMoveDialog() {
  dom.moveOverlay.classList.add('hidden');
  moveTarget = null;
  batchMoveMode = false;
}

[dom.moveCancel, dom.moveClose].forEach(el => el.addEventListener('click', closeMoveDialog));
dom.moveOverlay.addEventListener('click', (e) => {
  if (e.target === dom.moveOverlay) closeMoveDialog();
});

dom.moveConfirm.addEventListener('click', async () => {
  if (batchMoveMode) {
    // Batch move
    const paths = [...state.selected];
    if (paths.length === 0) return;
    if (moveTargetDir === (state.currentPath || '')) {
      dom.moveError.textContent = '目标位置与当前位置相同';
      return;
    }
    dom.moveConfirm.disabled = true;
    let ok = 0;
    for (const p of paths) {
      try {
        await apiMove(p, moveTargetDir);
        ok++;
      } catch (err) {
        showToast(`移动失败: ${p.split('/').pop()} - ${err.message}`, 'error');
      }
    }
    showToast(`已移动 ${ok}/${paths.length} 项`, 'success');
    dom.moveConfirm.disabled = false;
    closeMoveDialog();
    clearSelection();
    refreshCurrent();
    return;
  }

  // Single move
  if (!moveTarget) return;
  const sourcePath = getFilePath(moveTarget);
  if (moveTargetDir === (state.currentPath || '')) {
    dom.moveError.textContent = '目标位置与当前位置相同';
    return;
  }
  dom.moveConfirm.disabled = true;
  try {
    await apiMove(sourcePath, moveTargetDir);
    showToast(`已移动到 /${moveTargetDir || ''}`, 'success');
    closeMoveDialog();
    refreshCurrent();
  } catch (err) {
    dom.moveError.textContent = err.message;
  } finally {
    dom.moveConfirm.disabled = false;
  }
});

// === Upload ===
dom.uploadBtn.addEventListener('click', () => {
  dom.uploadInput.click();
});

dom.uploadInput.addEventListener('change', async () => {
  const files = dom.uploadInput.files;
  if (!files || files.length === 0) return;

  const formData = new FormData();
  formData.append('uploadDir', state.currentPath || '');
  for (const file of files) formData.append('files', file);

  dom.uploadBtn.disabled = true;
  dom.uploadBtn.textContent = '⏳';
  try {
    const result = await apiUpload(formData);
    const ok = result.results.filter(r => r.success).length;
    const fail = result.results.filter(r => r.error).length;
    let msg = `上传完成: ${ok} 个成功`;
    if (fail > 0) msg += `, ${fail} 个失败`;
    showToast(msg, fail > 0 ? 'error' : 'success');
    refreshCurrent();
  } catch (err) {
    showToast(`上传失败: ${err.message}`, 'error');
  } finally {
    dom.uploadBtn.disabled = false;
    dom.uploadBtn.textContent = '⬆';
    dom.uploadInput.value = '';
  }
});

// === New Folder ===
dom.newFolderBtn.addEventListener('click', () => {
  openDialog('newfolder', '新建文件夹', '', async (name) => {
    await apiMkdir(state.currentPath || '', name);
    showToast(`已创建文件夹 "${name}"`, 'success');
    refreshCurrent();
  });
});

// === Refresh Helper ===
async function refreshCurrent() {
  state.treeNodes = {};
  renderTree();
  await navigateTo(state.currentPath);
}

// === Init ===
async function init() {
  // Check authentication first
  const authed = await checkAuth();
  if (!authed) {
    redirectToLogin();
    return;
  }

  // Show logged-in user in sidebar
  updateUserDisplay();

  try {
    const data = await apiBrowse('');
    state.entries = data.entries;
    state.treeNodes[''] = { expanded: true, loaded: true, children: data.entries };
    dom.rootPath.textContent = data.path || '/';
  } catch (err) {
    showToast(`初始化失败: ${err.message}`);
    return;
  }

  const initialPath = getPathFromHash();
  state.currentPath = initialPath;
  renderTree();
  renderBreadcrumb();

  if (initialPath) {
    await navigateTo(initialPath);
  } else {
    renderFileList(state.entries);
    const folderCount = state.entries.filter(e => e.type === 'directory').length;
    const fileCount = state.entries.length - folderCount;
    dom.itemCount.textContent = `${folderCount} 个文件夹, ${fileCount} 个文件`;
  }
}

function updateUserDisplay() {
  if (!state.user) return;
  const existing = document.getElementById('user-display');
  if (existing) existing.remove();

  const userEl = document.createElement('div');
  userEl.id = 'user-display';
  userEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;color:var(--text-muted);border-top:1px solid var(--border);margin-top:8px;padding-top:8px;';

  const avatar = document.createElement('span');
  avatar.textContent = '\u{1F464}';
  avatar.style.fontSize = '14px';
  userEl.appendChild(avatar);

  const nameSpan = document.createElement('span');
  nameSpan.textContent = state.user.username;
  nameSpan.style.flex = '1';
  userEl.appendChild(nameSpan);

  const changePwdBtn = document.createElement('button');
  changePwdBtn.textContent = '改密';
  changePwdBtn.title = '修改密码';
  changePwdBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;padding:2px 6px;border-radius:4px;';
  changePwdBtn.addEventListener('mouseenter', () => { changePwdBtn.style.color = 'var(--accent)'; changePwdBtn.style.background = 'rgba(137,180,250,0.1)'; });
  changePwdBtn.addEventListener('mouseleave', () => { changePwdBtn.style.color = 'var(--text-muted)'; changePwdBtn.style.background = 'none'; });
  changePwdBtn.addEventListener('click', openChangePassword);
  userEl.appendChild(changePwdBtn);

  const logoutBtn = document.createElement('button');
  logoutBtn.textContent = '退出';
  logoutBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;padding:2px 6px;border-radius:4px;';
  logoutBtn.addEventListener('mouseenter', () => { logoutBtn.style.color = 'var(--danger)'; logoutBtn.style.background = 'rgba(243,139,168,0.1)'; });
  logoutBtn.addEventListener('mouseleave', () => { logoutBtn.style.color = 'var(--text-muted)'; logoutBtn.style.background = 'none'; });
  logoutBtn.addEventListener('click', doLogout);
  userEl.appendChild(logoutBtn);

  const footer = document.querySelector('.sidebar-footer');
  if (footer) footer.before(userEl);
}

init();

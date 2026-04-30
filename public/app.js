// === File Manager App ===

const state = {
  currentPath: '',
  entries: [],
  treeNodes: {},     // path -> { expanded, loaded, children }
  previewFile: null,
  selected: new Set(),      // Set of entry paths for multi-select
  sortKey: 'default',       // sort dropdown value
};

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
  // File operations
  contextMenu: $('#context-menu'),
  ctxRename: $('#ctx-rename'),
  ctxDownload: $('#ctx-download'),
  ctxMove: $('#ctx-move'),
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
  const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `HTTP ${res.status}`);
    console.error(`[apiBrowse] path="${path}" failed:`, err.message);
    throw err;
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
  const res = await fetch('/api/mkdir', {
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
  const res = await fetch('/api/rename', {
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
  const res = await fetch('/api/delete', {
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
  const res = await fetch('/api/move', {
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
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiSave(filePath, content) {
  const res = await fetch('/api/save', {
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

    dom.fileList.appendChild(card);
  });

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
  dom.previewOverlay.classList.add('hidden');
  dom.previewContainer.classList.remove('image-fullscreen');
  dom.previewContent.innerHTML = '';
  document.body.style.overflow = '';
  state.previewFile = null;
  if (state._imageNav) {
    if (state._imageNav.onResize) window.removeEventListener('resize', state._imageNav.onResize);
    state._imageNav = null;
  }
  dom.previewEdit.classList.add('hidden');
  dom.previewRotate.classList.add('hidden');
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

  document.addEventListener('mousemove', (e) => {
    if (!dragging || !state.previewFile) return;
    posX += e.clientX - lastX;
    posY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    img.style.transition = 'none';
    updateTransform();
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      wrapper.style.cursor = scale > baseScale ? 'grab' : 'default';
      img.style.transition = 'transform 0.1s ease';
    }
  });

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
  state._imageNav = { showImage, imageList, index: currentIndex, onResize };
}

function navigateImage(direction) {
  if (!state._imageNav || !state._imageNav.imageList.length) return;
  const { showImage, imageList } = state._imageNav;
  let idx = state._imageNav.index + direction;
  if (idx < 0) idx = imageList.length - 1;
  if (idx >= imageList.length) idx = 0;
  state._imageNav.index = idx;
  showImage(idx);
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
  const res = await fetch(url);
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  // Rendered view
  const viewArea = document.createElement('div');
  viewArea.id = 'text-view';
  const mdContent = document.createElement('div');
  mdContent.className = 'markdown-body';
  mdContent.innerHTML = marked.parse(text);
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
      mdContent.innerHTML = marked.parse(textarea.value);
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
  iframe.src = `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(
    window.location.origin + url
  )}`;
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

// Close overlays on Escape key (priority: context menu > dialog > move > preview > settings)
document.addEventListener('keydown', (e) => {
  // Arrow keys for image navigation (only when image preview is active)
  if (state._imageNav && !dom.previewOverlay.classList.contains('hidden')) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateImage(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateImage(1); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); dom.previewRotate.click(); return; }
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
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('获取配置失败');
  return res.json();
}

async function apiSaveConfig(config) {
  const res = await fetch('/api/config', {
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
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 220) + 'px';

  dom.ctxDownload.classList.toggle('hidden', entry.type === 'directory');

  // Highlight target card
  document.querySelectorAll('.file-card.context-target').forEach(el => el.classList.remove('context-target'));
  e.currentTarget.classList.add('context-target');
}

function hideContextMenu() {
  dom.contextMenu.classList.add('hidden');
  contextTarget = null;
  document.querySelectorAll('.file-card.context-target').forEach(el => el.classList.remove('context-target'));
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

init();

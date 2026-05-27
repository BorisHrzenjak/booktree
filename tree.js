const svg = document.getElementById('treeSvg');
const viewport = document.getElementById('viewport');
const linksLayer = document.getElementById('links');
const nodesLayer = document.getElementById('nodes');
const searchInput = document.getElementById('searchInput');
const summary = document.getElementById('summary');
const message = document.getElementById('message');
const hoverCard = document.getElementById('hoverCard');
const pathBar = document.getElementById('pathBar');

const NODE_W = 176;
const NODE_H = 38;
const X_GAP = 206;
const Y_GAP = 50;
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.8;

let rootNode = null;
let visibleRoot = null;
let visibleNodes = [];
let visibleLinks = [];
let expanded = new Set();
let savedExpanded = null;
let searchQuery = '';
let transform = { x: 40, y: 40, k: 1 };
let dragState = null;
let suppressCanvasClick = false;
let activePathNode = null;
let bookmarkCount = 0;
let folderCount = 0;
let lastBounds = null;

init();

async function init() {
  wireEvents();

  try {
    const tree = await getBookmarkTree();
    rootNode = normalizeRoot(tree);
    expanded.add(rootNode.id);
    render();
    requestAnimationFrame(fitToScreen);
  } catch (error) {
    showMessage(`Could not load bookmarks: ${error.message || String(error)}`);
    summary.textContent = 'Bookmark access failed';
  }
}

function getBookmarkTree() {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.bookmarks?.getTree) {
      reject(new Error('Chrome bookmarks API is unavailable. Open this page from the extension.'));
      return;
    }

    chrome.bookmarks.getTree((tree) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tree);
    });
  });
}

function normalizeRoot(tree) {
  bookmarkCount = 0;
  folderCount = 0;
  const chromeRoot = tree?.[0] || { id: '0', title: 'Bookmarks', children: [] };
  const root = normalizeNode(chromeRoot, null, 0);
  root.title = 'Bookmarks';
  root.type = 'folder';
  root.isRoot = true;
  root.totalBookmarks = countBookmarks(root);
  return root;
}

function normalizeNode(node, parent, depth) {
  const isBookmark = Boolean(node.url);
  const normalized = {
    id: String(node.id),
    title: cleanTitle(node.title) || (isBookmark ? 'Untitled bookmark' : 'Untitled folder'),
    url: node.url || '',
    type: isBookmark ? 'bookmark' : 'folder',
    parent,
    depth,
    children: [],
    totalBookmarks: 0,
    match: false,
    branchMatch: false
  };

  if (isBookmark) {
    bookmarkCount += 1;
    normalized.totalBookmarks = 1;
  } else {
    folderCount += 1;
    normalized.children = (node.children || []).map((child) => normalizeNode(child, normalized, depth + 1));
    normalized.totalBookmarks = normalized.children.reduce((sum, child) => sum + child.totalBookmarks, 0);
  }

  return normalized;
}

function cleanTitle(value) {
  return String(value || '').trim();
}

function countBookmarks(node) {
  if (node.type === 'bookmark') return 1;
  return node.children.reduce((sum, child) => sum + countBookmarks(child), 0);
}

function render() {
  clearMessage();
  if (!rootNode || rootNode.totalBookmarks === 0) {
    summary.textContent = 'No bookmarks found';
    showMessage('No bookmarks found. Add bookmarks in Chrome, then reopen BookTree.');
    return;
  }

  const prepared = searchQuery ? buildSearchTree(rootNode, searchQuery) : buildExpandedTree(rootNode);
  visibleRoot = prepared.root;
  visibleNodes = [];
  visibleLinks = [];

  if (!visibleRoot) {
    clearSvg();
    summary.textContent = `No matches for “${searchQuery}”`;
    updateActivePath();
    return;
  }

  layoutTree(visibleRoot);
  collectVisible(visibleRoot);
  drawLinks();
  drawNodes();

  if (searchQuery) {
    summary.textContent = `${prepared.matches} match${prepared.matches === 1 ? '' : 'es'} in ${bookmarkCount} bookmarks`;
  } else {
    summary.textContent = `${bookmarkCount} bookmarks · ${Math.max(folderCount - 1, 0)} folders`;
  }

  updateActivePath();
}

function buildExpandedTree(node) {
  return { root: cloneVisible(node, false), matches: 0 };
}

function cloneVisible(node, forceChildren) {
  const clone = cloneNodeShell(node);
  const shouldShowChildren = forceChildren || expanded.has(node.id);
  clone.collapsed = node.type === 'folder' && node.children.length > 0 && !shouldShowChildren;
  clone.hiddenCount = clone.collapsed ? node.totalBookmarks : 0;
  clone.children = shouldShowChildren ? node.children.map((child) => cloneVisible(child, false)) : [];
  return clone;
}

function buildSearchTree(node, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let matches = 0;

  function visit(source) {
    const haystack = `${source.title} ${source.url}`.toLowerCase();
    const selfMatch = source.type === 'bookmark' && terms.every((term) => haystack.includes(term));
    const childClones = source.children.map(visit).filter(Boolean);

    if (!selfMatch && childClones.length === 0 && !source.isRoot) return null;

    const clone = cloneNodeShell(source);
    clone.match = selfMatch;
    clone.branchMatch = selfMatch || childClones.length > 0;
    clone.children = childClones;
    clone.collapsed = false;
    clone.hiddenCount = 0;
    if (selfMatch) matches += 1;
    return clone;
  }

  return { root: visit(node), matches };
}

function cloneNodeShell(node) {
  return {
    source: node,
    id: node.id,
    title: node.title,
    url: node.url,
    type: node.type,
    isRoot: node.isRoot,
    totalBookmarks: node.totalBookmarks,
    children: [],
    collapsed: false,
    hiddenCount: 0,
    match: false,
    branchMatch: false,
    x: 0,
    y: 0
  };
}

function layoutTree(root) {
  let leafIndex = 0;

  function assign(node, depth) {
    node.x = depth * X_GAP;
    if (!node.children.length) {
      node.y = leafIndex * Y_GAP;
      leafIndex += 1;
      return node.y;
    }

    node.children.forEach((child) => assign(child, depth + 1));
    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    node.y = (first.y + last.y) / 2;
    return node.y;
  }

  assign(root, 0);
}

function collectVisible(root) {
  function walk(node) {
    visibleNodes.push(node);
    node.children.forEach((child) => {
      visibleLinks.push({ from: node, to: child });
      walk(child);
    });
  }
  walk(root);

  const minX = Math.min(...visibleNodes.map((node) => node.x));
  const maxX = Math.max(...visibleNodes.map((node) => node.x + NODE_W));
  const minY = Math.min(...visibleNodes.map((node) => node.y));
  const maxY = Math.max(...visibleNodes.map((node) => node.y + NODE_H));
  lastBounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function drawLinks() {
  linksLayer.replaceChildren();
  const fragment = document.createDocumentFragment();

  visibleLinks.forEach(({ from, to }) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const mid = x1 + Math.max(24, (x2 - x1) * 0.5);
    path.setAttribute('class', `link${searchQuery && !to.branchMatch && !to.match ? ' dimmed' : ''}`);
    path.setAttribute('d', `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`);
    fragment.append(path);
  });

  linksLayer.append(fragment);
}

function drawNodes() {
  nodesLayer.replaceChildren();
  const fragment = document.createDocumentFragment();

  visibleNodes.forEach((node) => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', `node ${node.type}${node.match ? ' match' : ''}`);
    group.setAttribute('transform', `translate(${node.x},${node.y})`);
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', ariaLabel(node));

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'node-card');
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', '12');
    group.append(rect);

    if (node.type === 'bookmark') drawBookmarkMark(group);
    else drawFolderMark(group, node);

    drawText(group, node);
    drawDeleteButton(group, node);

    group.addEventListener('pointerdown', (event) => event.stopPropagation());
    group.addEventListener('pointerenter', (event) => showHoverCard(event, node));
    group.addEventListener('pointermove', (event) => moveHoverCard(event));
    group.addEventListener('pointerleave', hideHoverCard);
    group.addEventListener('focus', (event) => showHoverCard(event, node));
    group.addEventListener('blur', hideHoverCard);
    group.addEventListener('click', (event) => handleNodeClick(event, node));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleNodeClick(event, node);
      }
    });

    fragment.append(group);
  });

  nodesLayer.append(fragment);
  applyTransform();
}

function drawBookmarkMark(group) {
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('class', 'dot');
  dot.setAttribute('cx', '18');
  dot.setAttribute('cy', NODE_H / 2);
  dot.setAttribute('r', '6.5');
  group.append(dot);
}

function drawFolderMark(group, node) {
  const toggle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  toggle.setAttribute('class', 'toggle');
  toggle.setAttribute('cx', '18');
  toggle.setAttribute('cy', NODE_H / 2);
  toggle.setAttribute('r', '9');
  group.append(toggle);

  const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  symbol.setAttribute('class', 'toggle-text');
  symbol.setAttribute('x', '18');
  symbol.setAttribute('y', NODE_H / 2 + 0.5);
  symbol.textContent = node.children.length ? '−' : node.collapsed ? '+' : '•';
  group.append(symbol);

  if (node.collapsed && node.hiddenCount > 0) {
    const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    pill.setAttribute('class', 'count-pill');
    pill.setAttribute('x', NODE_W - 42);
    pill.setAttribute('y', '9');
    pill.setAttribute('width', '32');
    pill.setAttribute('height', '20');
    pill.setAttribute('rx', '10');
    group.append(pill);

    const count = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    count.setAttribute('class', 'count-text');
    count.setAttribute('x', NODE_W - 26);
    count.setAttribute('y', NODE_H / 2 + 0.5);
    count.textContent = compactNumber(node.hiddenCount);
    group.append(count);
  }
}

function drawDeleteButton(group, node) {
  if (!canDeleteNode(node)) return;

  const button = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  button.setAttribute('class', 'delete-hit');
  button.setAttribute('tabindex', '0');
  button.setAttribute('role', 'button');
  button.setAttribute('aria-label', `Delete ${node.type} ${node.title}`);
  button.setAttribute('transform', `translate(${NODE_W - 32}, 5)`);

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('class', 'delete-bg');
  bg.setAttribute('width', '27');
  bg.setAttribute('height', '27');
  bg.setAttribute('rx', '9');
  button.append(bg);

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  icon.setAttribute('class', 'delete-icon');
  icon.setAttribute('d', 'M9 11.2h9m-7.8 0 .55 8.1c.05.75.55 1.2 1.3 1.2h3.9c.75 0 1.25-.45 1.3-1.2l.55-8.1M12.2 9.3h3.6m-2.8 4.1v4.7m2-4.7v4.7M11.6 9.3l.45-1.05c.14-.33.42-.5.78-.5h2.34c.36 0 .64.17.78.5l.45 1.05');
  button.append(icon);

  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    hideHoverCard();
    confirmAndDelete(node);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      hideHoverCard();
      confirmAndDelete(node);
    }
  });

  group.append(button);
}

function drawText(group, node) {
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('class', 'node-text');
  label.setAttribute('x', '34');
  label.setAttribute('y', NODE_H / 2 + (node.url ? -4 : 0));
  label.textContent = truncate(node.title, node.collapsed ? 16 : node.url ? 21 : 20);
  group.append(label);

  if (node.url) {
    const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sub.setAttribute('class', 'node-subtext');
    sub.setAttribute('x', '34');
    sub.setAttribute('y', NODE_H / 2 + 10);
    sub.textContent = truncate(hostFromUrl(node.url), 22);
    group.append(sub);
  }
}

function handleNodeClick(event, node) {
  if (event.target.closest?.('.delete-hit')) return;
  event.stopPropagation();

  if (node.type === 'folder') {
    if (searchQuery) return;
    activePathNode = node.source;
    if (expanded.has(node.id)) expanded.delete(node.id);
    else expanded.add(node.id);
    render();
    return;
  }

  if (!node.url) return;
  if (event.ctrlKey || event.metaKey) {
    chrome.tabs.create({ url: node.url });
    return;
  }

  chrome.tabs.update({ url: node.url }, () => {
    if (chrome.runtime.lastError) {
      window.location.href = node.url;
    }
  });
}

function canDeleteNode(node) {
  if (!node || node.isRoot) return false;
  const source = node.source;
  // Chrome's permanent top-level bookmark folders should not be deletable here.
  if (source?.type === 'folder' && source.parent?.isRoot) return false;
  return true;
}

function confirmAndDelete(node) {
  const source = node.source;
  if (!source || !canDeleteNode(node)) return;

  const isFolder = source.type === 'folder';
  const message = isFolder
    ? `Delete folder “${source.title}” and all ${source.totalBookmarks} bookmark${source.totalBookmarks === 1 ? '' : 's'} inside it?\n\nThis cannot be undone from BookTree.`
    : `Delete bookmark “${source.title}”?\n\n${source.url}\n\nThis cannot be undone from BookTree.`;

  if (!window.confirm(message)) return;

  const remove = isFolder ? chrome.bookmarks.removeTree : chrome.bookmarks.remove;
  remove(String(source.id), () => {
    const error = chrome.runtime.lastError;
    if (error) {
      showMessage(`Could not delete: ${error.message}`);
      return;
    }

    removeNodeFromTree(rootNode, source.id);
    expanded.delete(source.id);
    activePathNode = null;
    recomputeTreeStats();
    render();
    showTemporaryNotice(isFolder ? 'Folder deleted' : 'Bookmark deleted');
  });
}

function removeNodeFromTree(parent, id) {
  if (!parent?.children?.length) return false;
  const index = parent.children.findIndex((child) => child.id === id);
  if (index >= 0) {
    parent.children.splice(index, 1);
    return true;
  }
  return parent.children.some((child) => removeNodeFromTree(child, id));
}

function recomputeTreeStats() {
  bookmarkCount = 0;
  folderCount = 0;

  function walk(node) {
    if (node.type === 'bookmark') {
      bookmarkCount += 1;
      node.totalBookmarks = 1;
      return 1;
    }
    folderCount += 1;
    node.totalBookmarks = node.children.reduce((sum, child) => sum + walk(child), 0);
    return node.totalBookmarks;
  }

  walk(rootNode);
}

function wireEvents() {
  searchInput.addEventListener('input', () => {
    const next = searchInput.value.trim();
    if (next && !searchQuery) savedExpanded = new Set(expanded);
    if (!next && searchQuery && savedExpanded) {
      expanded = savedExpanded;
      savedExpanded = null;
    }
    searchQuery = next;
    if (searchQuery) activePathNode = null;
    render();
    requestAnimationFrame(fitToScreen);
  });

  document.getElementById('zoomOutButton').addEventListener('click', () => zoomFromCenter(0.78));
  document.getElementById('zoomInButton').addEventListener('click', () => zoomFromCenter(1.28));
  document.getElementById('fitButton').addEventListener('click', fitToScreen);
  document.getElementById('resetButton').addEventListener('click', () => {
    transform = { x: 40, y: 40, k: 1 };
    applyTransform();
  });
  document.getElementById('expandButton').addEventListener('click', () => {
    expanded = new Set();
    collectFolderIds(rootNode, expanded);
    searchInput.value = '';
    searchQuery = '';
    savedExpanded = null;
    activePathNode = null;
    render();
    requestAnimationFrame(fitToScreen);
  });
  document.getElementById('collapseButton').addEventListener('click', () => {
    expanded = new Set([rootNode.id]);
    searchInput.value = '';
    searchQuery = '';
    savedExpanded = null;
    activePathNode = null;
    render();
    requestAnimationFrame(fitToScreen);
  });

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest?.('.node')) return;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('dragging');
    dragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: transform.x, originY: transform.y, moved: false };
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.hypot(dx, dy) > 4) dragState.moved = true;
    transform.x = dragState.originX + dx;
    transform.y = dragState.originY + dy;
    applyTransform();
  });
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('click', (event) => {
    if (suppressCanvasClick || searchQuery || event.target.closest?.('.node')) return;
    activePathNode = null;
    updateActivePath();
  });

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0012);
    zoomAt(pointerX, pointerY, factor);
  }, { passive: false });

  window.addEventListener('resize', () => requestAnimationFrame(fitToScreen));
}

function endDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  suppressCanvasClick = dragState.moved;
  dragState = null;
  svg.classList.remove('dragging');
  if (suppressCanvasClick) window.setTimeout(() => { suppressCanvasClick = false; }, 0);
}

function zoomFromCenter(factor) {
  const rect = svg.getBoundingClientRect();
  zoomAt(rect.width / 2, rect.height / 2, factor);
}

function zoomAt(screenX, screenY, factor) {
  const oldK = transform.k;
  const nextK = clamp(oldK * factor, MIN_ZOOM, MAX_ZOOM);
  const worldX = (screenX - transform.x) / oldK;
  const worldY = (screenY - transform.y) / oldK;
  transform.x = screenX - worldX * nextK;
  transform.y = screenY - worldY * nextK;
  transform.k = nextK;
  applyTransform();
}

function fitToScreen() {
  if (!lastBounds || !visibleNodes.length) return;
  const rect = svg.getBoundingClientRect();
  const pad = 42;
  const scaleX = (rect.width - pad * 2) / Math.max(lastBounds.width, 1);
  const scaleY = (rect.height - pad * 2) / Math.max(lastBounds.height, 1);
  const k = clamp(Math.min(scaleX, scaleY, 1.25), MIN_ZOOM, MAX_ZOOM);
  transform = {
    k,
    x: (rect.width - lastBounds.width * k) / 2 - lastBounds.minX * k,
    y: (rect.height - lastBounds.height * k) / 2 - lastBounds.minY * k
  };
  applyTransform();
}

function applyTransform() {
  viewport.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.k})`);
}

function clearSvg() {
  linksLayer.replaceChildren();
  nodesLayer.replaceChildren();
}

function updateActivePath() {
  if (!activePathNode || searchQuery) {
    pathBar.hidden = true;
    pathBar.replaceChildren();
    return;
  }

  const segments = [];
  let current = activePathNode;
  while (current) {
    segments.unshift(current.title || (current.type === 'folder' ? 'Untitled folder' : 'Untitled bookmark'));
    current = current.parent;
  }

  pathBar.replaceChildren();
  const label = document.createElement('span');
  label.className = 'path-label';
  label.textContent = 'Active path';
  pathBar.append(label);

  segments.forEach((segment, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'path-separator';
      separator.textContent = '/';
      pathBar.append(separator);
    }

    const item = document.createElement('span');
    item.className = 'path-segment';
    item.textContent = segment;
    item.title = segment;
    pathBar.append(item);
  });

  pathBar.hidden = false;
}

function showHoverCard(event, node) {
  if (!node.url) return;
  hoverCard.innerHTML = `
    <div class="hover-card-title"></div>
    <div class="hover-card-url"></div>
    <div class="hover-card-hint">Click to open here · Ctrl/Cmd-click to open in a new tab</div>
  `;
  hoverCard.querySelector('.hover-card-title').textContent = node.title;
  hoverCard.querySelector('.hover-card-url').textContent = node.url;
  hoverCard.hidden = false;
  moveHoverCard(event);
}

function moveHoverCard(event) {
  if (hoverCard.hidden || typeof event.clientX !== 'number') return;
  const stageRect = document.getElementById('stage').getBoundingClientRect();
  const cardRect = hoverCard.getBoundingClientRect();
  const margin = 14;
  let left = event.clientX - stageRect.left + 18;
  let top = event.clientY - stageRect.top + 18;

  if (left + cardRect.width + margin > stageRect.width) {
    left = event.clientX - stageRect.left - cardRect.width - 18;
  }
  if (top + cardRect.height + margin > stageRect.height) {
    top = event.clientY - stageRect.top - cardRect.height - 18;
  }

  hoverCard.style.left = `${Math.max(margin, left)}px`;
  hoverCard.style.top = `${Math.max(margin, top)}px`;
}

function hideHoverCard() {
  hoverCard.hidden = true;
}

function showTemporaryNotice(text) {
  message.textContent = text;
  message.hidden = false;
  window.clearTimeout(showTemporaryNotice.timer);
  showTemporaryNotice.timer = window.setTimeout(clearMessage, 1800);
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

function clearMessage() {
  message.hidden = true;
  message.textContent = '';
}

function ariaLabel(node) {
  if (node.type === 'bookmark') return `Open bookmark ${node.title}`;
  if (node.collapsed) return `Expand folder ${node.title}, ${node.hiddenCount} bookmarks hidden`;
  return `Collapse folder ${node.title}`;
}

function truncate(value, limit) {
  const text = String(value || 'Untitled');
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
}

function hostFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function compactNumber(value) {
  if (value < 1000) return String(value);
  return `${Math.round(value / 100) / 10}k`;
}

function collectFolderIds(node, target) {
  if (!node || node.type !== 'folder') return;
  target.add(node.id);
  node.children.forEach((child) => collectFolderIds(child, target));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

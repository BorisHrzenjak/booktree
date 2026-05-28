// Records a real product demo of the BookTree extension.
//
// Chrome 148 refuses to load unpacked extensions under automation (the
// --load-extension switch is ignored and the CDP Extensions.loadUnpacked
// command never actually enables the extension). So instead of faking the UI,
// this harness runs the extension's REAL, UNMODIFIED files (tree.html, tree.js,
// styles.css straight from the repo) served over localhost, and injects a thin
// chrome.* shim before the page scripts run -- providing exactly the bookmark
// data and the tabs/remove calls that Chrome would hand the extension.
//
// Everything visible in the recording (tree layout, search filtering, zoom,
// pan, expand/collapse, the active-path bar, hover cards, real deletion from
// the live model, opening) is the genuine shipping code executing.
//
// Output: video/booktree-demo.webm (raw) -> mp4 via ffmpeg in run.mjs.

import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const OUT_DIR = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Sample bookmark data, in Chrome's bookmarks-API node shape ----------
let seq = 100;
const id = () => String(++seq);
const F = (title, children) => ({ id: id(), title, children });
const L = (title, url) => ({ id: id(), title, url });

const bookmarkTree = [
  {
    id: '0',
    title: '',
    children: [
      F('Bookmarks bar', [
        F('Development', [
          L('Chrome Extensions docs', 'https://developer.chrome.com/docs/extensions'),
          L('MDN Web Docs', 'https://developer.mozilla.org'),
          L('Can I use', 'https://caniuse.com'),
          F('Frameworks', [
            L('React', 'https://react.dev'),
            L('Svelte', 'https://svelte.dev'),
            L('Playwright', 'https://playwright.dev'),
          ]),
        ]),
        F('Design', [
          L('Figma', 'https://figma.com'),
          L('Refactoring UI', 'https://refactoringui.com'),
          L('Coolors palettes', 'https://coolors.co'),
        ]),
        F('Reading list', [
          L('Hacker News', 'https://news.ycombinator.com'),
          L('Julia Evans blog', 'https://jvns.ca'),
          L('Article queue', 'https://getpocket.com'),
        ]),
        L('GitHub', 'https://github.com'),
      ]),
      F('Other bookmarks', [
        F('Recipes', [
          L('Pasta night', 'https://example.com/pasta'),
          L('Sourdough guide', 'https://example.com/bread'),
        ]),
        L('Local weather', 'https://example.com/weather'),
      ]),
    ],
  },
];

// ---- chrome.* shim injected before tree.js runs -------------------------
// This mirrors the exact surface tree.js uses: chrome.bookmarks.getTree,
// remove, removeTree; chrome.tabs.create, update; chrome.runtime.lastError.
const chromeShim = (tree) => {
  window.chrome = {
    runtime: { lastError: null, getURL: (p) => p },
    bookmarks: {
      getTree: (cb) => cb(JSON.parse(JSON.stringify(tree))),
      remove: (_id, cb) => cb && cb(),
      removeTree: (_id, cb) => cb && cb(),
    },
    tabs: {
      create: ({ url }) => { window.__opened = url; },
      // The extension opens left-clicks here; navigate for a real, visible open.
      update: ({ url }, cb) => { cb && cb(); setTimeout(() => { window.location.href = url; }, 60); },
    },
  };
};

// ---- visible cursor + caption overlay -----------------------------------
const overlayScript = () => {
  const build = () => {
  const style = document.createElement('style');
  style.textContent = `
    #demo-cursor{position:fixed;z-index:2147483647;width:24px;height:24px;left:0;top:0;
      margin:-2px 0 0 -2px;pointer-events:none;transition:transform .05s linear;
      filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))}
    #demo-cursor.click{transform:scale(.78)}
    #demo-caption{position:fixed;z-index:2147483646;left:50%;bottom:30px;transform:translateX(-50%);
      max-width:780px;text-align:center;pointer-events:none;opacity:0;transition:opacity .45s ease;
      font-family:'Instrument Sans',system-ui,sans-serif}
    #demo-caption .t{font-size:27px;font-weight:600;color:#fff;letter-spacing:-.01em;
      text-shadow:0 2px 12px rgba(0,0,0,.65)}
    #demo-caption .s{margin-top:7px;font-size:16px;color:#dbe7f6;
      text-shadow:0 2px 10px rgba(0,0,0,.65)}
    #demo-caption .chip{display:inline-block;margin-bottom:11px;padding:5px 13px;border-radius:999px;
      background:rgba(56,189,248,.18);border:1px solid rgba(56,189,248,.5);color:#bfe6ff;
      font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase}`;
  document.head.appendChild(style);

  const cur = document.createElement('div');
  cur.id = 'demo-cursor';
  cur.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24">
    <path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 14 L19 14 Z"
      fill="#fff" stroke="#0b1220" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  document.documentElement.appendChild(cur);
  addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => cur.classList.add('click'), true);
  addEventListener('mouseup', () => cur.classList.remove('click'), true);

  const cap = document.createElement('div');
  cap.id = 'demo-caption';
  cap.innerHTML = `<div class="chip"></div><div class="t"></div><div class="s"></div>`;
  document.documentElement.appendChild(cap);
  window.__caption = (chip, title, sub) => {
    cap.querySelector('.chip').textContent = chip || '';
    cap.querySelector('.t').textContent = title || '';
    cap.querySelector('.s').textContent = sub || '';
    cap.style.opacity = title ? '1' : '0';
  };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
};

// ---- minimal static file server for the repo ----------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'tree.html';
      const fp = path.join(REPO, rel);
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'booktree-demo-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
    args: ['--no-first-run', '--no-default-browser-check', '--window-size=1300,860', '--hide-crash-restore-bubble'],
  });

  // Accept the native confirm() dialog used when deleting a bookmark.
  context.on('dialog', (d) => d.accept());

  const page = context.pages()[0] || (await context.newPage());
  await page.addInitScript(chromeShim, bookmarkTree);
  await page.addInitScript(overlayScript);
  await page.goto(`http://127.0.0.1:${port}/tree.html`, { waitUntil: 'load' });
  await page.waitForSelector('#nodes .node', { timeout: 15000 });
  await sleep(500);

  // ---- human-paced helpers ----
  let mx = 640, my = 360;
  async function moveTo(x, y, steps = 26) {
    const fx = mx, fy = my;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      mx = fx + (x - fx) * e; my = fy + (y - fy) * e;
      await page.mouse.move(mx, my);
      await sleep(12);
    }
    mx = x; my = y;
  }
  async function centerOf(sel) {
    const box = await page.locator(sel).first().boundingBox();
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  }
  async function moveToSel(sel) { const c = await centerOf(sel); if (c) await moveTo(c.x, c.y); return c; }
  async function clickSel(sel) {
    await moveToSel(sel); await sleep(170);
    await page.mouse.down(); await sleep(90); await page.mouse.up(); await sleep(120);
  }
  const caption = (c, t, s) => page.evaluate(([a, b, d]) => window.__caption(a, b, d), [c, t, s]);
  const nodeByText = (txt) => `g.node:has(text:text-is("${txt}"))`;

  // ===== SCENE 1: intro =====
  await caption('BookTree', 'Your Chrome bookmarks as a living tree', 'Real extension UI, rendered from your bookmark data.');
  await sleep(2600);

  // ===== SCENE 2: expand everything =====
  await caption('Layout', 'Expand the whole tree', 'One click reveals every folder and bookmark.');
  await clickSel('#expandButton'); await sleep(1600);
  await clickSel('#fitButton'); await sleep(1700);

  // ===== SCENE 3: pan =====
  await caption('Navigate', 'Drag the canvas to pan', 'Grab empty space and move around large trees.');
  await moveTo(640, 360);
  await page.mouse.down();
  await moveTo(430, 460, 30);
  await moveTo(770, 300, 30);
  await page.mouse.up();
  await sleep(1200);

  // ===== SCENE 4: zoom =====
  await caption('Navigate', 'Zoom with the buttons or the wheel', 'Get an overview, then dive into detail.');
  await clickSel('#zoomInButton'); await sleep(450);
  await clickSel('#zoomInButton'); await sleep(700);
  await moveTo(640, 360, 16);
  await page.mouse.wheel(0, -260); await sleep(450);
  await page.mouse.wheel(0, 420); await sleep(650);
  await clickSel('#fitButton'); await sleep(1400);

  // ===== SCENE 5: collapse / focus a folder =====
  await caption('Focus', 'Collapse to the top level', 'Hide the noise, keep your bearings.');
  await clickSel('#collapseButton'); await sleep(1500);
  await caption('Focus', 'Click a folder to open just that branch', 'The path bar shows exactly where you are.');
  await clickSel(nodeByText('Bookmarks bar')); await sleep(1400);
  await clickSel(nodeByText('Development')); await sleep(1800);
  await clickSel('#fitButton'); await sleep(1200);

  // ===== SCENE 6: search =====
  await caption('Search', 'Search titles and URLs', 'The tree filters to matching branches as you type.');
  await moveToSel('#searchInput'); await sleep(150);
  await page.locator('#searchInput').click();
  for (const ch of 'react') { await page.keyboard.type(ch); await sleep(250); }
  await sleep(2000);
  await caption('Search', 'Clear the search', 'Your previous expanded view comes right back.');
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Backspace'); await sleep(110); }
  await sleep(1300);

  // ===== SCENE 7: hover card =====
  await caption('Details', 'Hover a bookmark for its full title and URL', 'Plus a hint for how to open it.');
  await clickSel('#expandButton'); await sleep(700);
  await clickSel('#fitButton'); await sleep(800);
  await moveToSel(nodeByText('MDN Web Docs'));
  await sleep(2400);

  // ===== SCENE 8: delete =====
  await caption('Manage', 'Delete a bookmark right from the graph', 'It is removed, then the node disappears.');
  await moveToSel(nodeByText('Coolors palettes')); await sleep(700);
  await clickSel(`${nodeByText('Coolors palettes')} .delete-hit`);
  await sleep(2300);

  // ===== SCENE 9: open =====
  await caption('Open', 'Click a bookmark to open it', 'Ctrl/Cmd-click opens it in a new tab instead.');
  await moveToSel(nodeByText('GitHub')); await sleep(1000);
  await caption('', '', '');
  await sleep(250);
  await clickSel(nodeByText('GitHub')); // shim navigates to https://github.com
  await page.waitForLoadState('load').catch(() => {});
  await sleep(3000);

  const video = page.video();
  await context.close();
  server.close();
  const raw = await video.path();
  const finalWebm = path.join(OUT_DIR, 'booktree-demo.webm');
  fs.copyFileSync(raw, finalWebm);
  console.log('RAW_WEBM=' + finalWebm);
}

main().catch((e) => { console.error(e); process.exit(1); });

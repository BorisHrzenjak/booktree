# Bookmark Tree Chrome Extension Design

## Goal

Create a Chrome extension that opens a bookmark tree graph in a new browser tab when the user clicks the extension toolbar button. The first version prioritizes functionality over final visual polish.

## Scope

In scope:

- Manifest V3 Chrome extension.
- Toolbar button opens the extension page in a new tab.
- Read all Chrome bookmarks using `chrome.bookmarks.getTree()`.
- Render bookmarks as a compact, collapsible tree graph.
- Support pan, zoom, fit-to-screen, and reset view.
- Search bookmark titles and URLs.
- Filter the tree down to matching branches during search.
- Open bookmarks from the graph.

Out of scope for the first version:

- Replacing Chrome's default New Tab page.
- Editing, deleting, moving, or creating bookmarks.
- Syncing external data.
- Final detailed visual design polish.

## User Interaction

### Opening the extension

Clicking the extension icon opens `tree.html` in a new tab. Chrome's normal new-tab behavior remains unchanged.

### Tree graph

- Root node is labeled `Bookmarks`.
- Folder nodes can be expanded or collapsed.
- Bookmark nodes are leaves.
- Folders show a child-count indicator to make collapsed content understandable.
- The graph uses compact spacing to avoid excessive horizontal scrolling.
- The graph canvas supports mouse/touch pan and wheel zoom.
- Fit and reset controls help users recover from navigation or large trees.

### Bookmark clicks

- Left-clicking a bookmark opens its URL in the same tab as the extension page.
- Ctrl-click or Cmd-click opens the bookmark in a new tab.
- Clicking folders toggles expanded/collapsed state.

### Search

- Search matches bookmark titles and URLs.
- While the search field has text, the tree filters to matching branches only.
- Ancestor folders of matching bookmarks remain visible.
- Matching branches auto-expand.
- A result count is shown.
- Clearing search restores the normal collapsible tree state.

## Technical Approach

Use a vanilla JavaScript Chrome extension with no build step.

Files:

- `manifest.json` — Manifest V3 configuration, permissions, action, and extension page registration.
- `background.js` — Handles toolbar icon clicks and opens `tree.html` in a new tab.
- `tree.html` — Main extension UI shell.
- `styles.css` — Functional layout and compact dark canvas styling.
- `tree.js` — Bookmark loading, tree state, search filtering, D3 rendering, and click behavior.
- `vendor/d3.min.js` or CDN fallback decision during implementation — D3 powers tree layout, links, zoom, and SVG updates.

Recommended first implementation: include D3 locally in `vendor/` so the unpacked extension works without remote script restrictions or internet access.

## Data Flow

1. User clicks the extension icon.
2. `background.js` opens `tree.html` in a new tab.
3. `tree.js` calls `chrome.bookmarks.getTree()`.
4. Raw Chrome bookmark nodes are normalized into internal nodes:
   - `id`
   - `title`
   - `url` for bookmark nodes
   - `children` for folder nodes
   - `type`: `folder` or `bookmark`
   - collapsed/expanded state
5. D3 computes the tree layout from the currently visible nodes.
6. Search input updates the visible tree model and re-renders.
7. Node clicks either toggle folders or open bookmark URLs.

## Error Handling

- If bookmark access fails, show an error message in the UI.
- If there are no bookmarks, show an empty state instead of a blank canvas.
- Bookmark nodes without valid URLs do not attempt navigation.
- Rendering should tolerate unnamed folders/bookmarks by displaying fallback labels such as `Untitled`.

## Testing Checklist

Manual testing is sufficient for the first version:

- Load extension as unpacked in Chrome.
- Click toolbar icon and confirm a new tab opens.
- Confirm bookmarks load from Chrome.
- Expand and collapse folders.
- Pan, zoom, fit, and reset the graph.
- Left-click bookmark opens in same tab.
- Ctrl-click/Cmd-click bookmark opens in new tab.
- Search by title.
- Search by URL.
- Confirm search filters to matching branches and clears correctly.
- Test with nested folders and many bookmarks.

## Design Review Notes

This spec intentionally avoids final UI polish decisions. The functional base should be modular enough to improve visual styling later without rewriting bookmark loading or tree behavior.

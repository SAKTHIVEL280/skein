# Zen parity tracker

What Skein takes from Zen Browser's UI (reference checkout kept outside the repo,
github.com/zen-browser/desktop, MPL-2.0), and where Skein goes further.
Each "done" item is covered by `scripts/dev/test_skein.py` unless noted.

## Done

| Feature | How in Skein | Setting / shortcut |
|---|---|---|
| Vertical tabs in a sidebar | Firefox vertical tabs on by default, Zen styling | `sidebar.verticalTabs` |
| Page as a floating card | Rounded content with Zen's shadow and 8px gap | `skein.ui.zen` |
| No search bar in the sidebar | Only navigation buttons at the top of the sidebar; the real address bar floats on Ctrl+L / Ctrl+T / + | `skein.ui.sidebarUrlbar` (false), `skein.ui.topSearchBar` (false) |
| Empty start | A new window shows the empty page, no stray New Tab | — |
| Floating address bar | Focusing the address field floats it centered over the page | — |
| Menu and sidebar toggle at top left | ⋯ menu, then the sidebar button, which slides the sidebar out | sidebar button, `Ctrl+Alt+B` |
| Compact mode | Sidebar glides out while the page widens; hover the edge to glide it back over the page; left or right side | `Ctrl+Alt+C` |
| Floating new-tab bar | `Ctrl+T` / + floats the real address bar (autofill, suggestions, default engine); the pick opens in a new tab | `skein.focus.floatingNewTab` |
| Search results like Firefox/Zen | User agent says `Firefox/<version>`, so Google serves its full page (speed test and other widgets) | patch 0005 |
| Essentials (pinned tiles) | Pinned tabs shown as a tile grid; drag a tab up to pin it | drag, or right-click → Pin |
| Close the last tab | Window stays open and shows an empty home page; no stray "New Tab" in the sidebar | `browser.tabs.closeWindowWithLastTab` (false) |
| Recent-tab switching | Quick `Ctrl+Tab` flips to the last tab; hold to see all tabs | `browser.ctrlTab.sortByRecentlyUsed` |
| Glance | Alt+click or right-click → Open in Glance: floating card over a dimmed page; Open as tab / Close / Esc | `skein.glance.altClick` |
| Split view | Firefox's split view with each page as a card | `Ctrl+Alt+V`, tab menu |
| Essentials per space | Pinned tabs belong to the space they were pinned in | — |
| Tab close on hover | Close button on the right, shown on hover | `skein.ui.tabCloseButton` |
| Hover top bar | Slides down at the top edge; window buttons and drag area | `skein.ui.topBar` |
| Workspaces | Skein Spaces, at the bottom of the sidebar like Zen; never pushed into the >> menu | Spaces widget |

## Better than Zen

- Every layout and theme change can be made by any AI agent through the
  validated customization folder; the `/skein` skill is installed into Claude
  Code, Codex, Antigravity, Gemini CLI, Cursor and `~/.agents` automatically.
- Snapshots and one-click rollback of every customization (`about:skein`).
- A runtime integrity check that rolls back any skill that hides or fakes the
  address bar, padlock or prompts, even in the sidebar layout.
- Privacy mode with proxy kill switch and Tor hand-off.

## Next

- Drag tabs between spaces by dropping them on a space dot.
- Space icons (emoji) in addition to colours.
- Verify every animation on Windows hardware (only tested on Linux so far).

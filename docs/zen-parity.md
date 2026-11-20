# Zen parity tracker

What Skein takes from Zen Browser's UI (reference checkout: `zen-ref/`,
github.com/zen-browser/desktop, MPL-2.0), and where Skein goes further.
Each "done" item is covered by `scripts/dev/test_skein.py` unless noted.

## Done

| Feature | How in Skein | Setting / shortcut |
|---|---|---|
| Vertical tabs in a sidebar | Firefox vertical tabs on by default, Zen styling | `sidebar.verticalTabs` |
| Page as a floating card | Rounded content with Zen's shadow and 8px gap | `skein.ui.zen` |
| No top search bar | Navigation toolbar moves to the top of the sidebar; top of the window only holds bookmarks | `skein.ui.topSearchBar` (false) |
| Floating address bar | Focusing the address field floats it centered over the page | — |
| Menu and sidebar toggle at top left | ⋯ menu, then the sidebar button, which slides the sidebar out | sidebar button, `Ctrl+Alt+B` |
| Compact mode | Sidebar and toolbar hide; reveal at the window edges | `Ctrl+Alt+C` |
| Floating new-tab bar | `Ctrl+T` / + opens a centered search field; Enter opens the tab | `skein.focus.floatingNewTab` |
| Essentials (pinned tiles) | Pinned tabs shown as a tile grid; drag a tab up to pin it | drag, or right-click → Pin |
| Close the last tab | Window stays open and shows an empty home page; no stray "New Tab" in the sidebar | `browser.tabs.closeWindowWithLastTab` (false) |
| Recent-tab switching | Quick `Ctrl+Tab` flips to the last tab; hold to see all tabs | `browser.ctrlTab.sortByRecentlyUsed` |
| Workspaces | Skein Spaces, shown as a row under the address field | Spaces widget |

## Better than Zen

- Every layout and theme change can be made by any AI agent through the
  validated customization folder; the `/skein` skill is installed into Claude
  Code, Codex, Antigravity, Gemini CLI, Cursor and `~/.agents` automatically.
- Snapshots and one-click rollback of every customization (`about:skein`).
- A runtime integrity check that rolls back any skill that hides or fakes the
  address bar, padlock or prompts, even in the sidebar layout.
- Privacy mode with proxy kill switch and Tor hand-off.

## Next

- Split view (two pages side by side).
- Per-space Essentials (Zen keeps Essentials per container).
- Glance (open a link in a floating preview).
- Move the window buttons out of the sidebar on Windows when the toolbar is there.

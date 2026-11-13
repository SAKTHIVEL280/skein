# Example skills

`custom/` is a complete, valid customization folder. Copy its contents into
your own customization folder (path shown in `about:skein`) to try it, or use
it as a reference for what an agent should produce.

| Skill | Touches | What it does |
|---|---|---|
| `midnight` | css | Dark violet theme using only Skein tokens |
| `paper` | css | Warm light theme (not enabled by default; swap it for `midnight`) |
| `tabs-right` | layout | Vertical tabs on the right, compact, no bookmarks bar |
| `work-calm` | css, keybindings | Applies only in a space named "Work" |

These are also the reference skills for update testing: after every Firefox
ESR rebase they must still validate and apply (`node --test skein/tests/validator/`).

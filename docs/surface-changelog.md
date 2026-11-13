# Stable surface changelog

Changes to the tokens and regions skills may rely on (`SkeinSurface.sys.mjs`).
Agents: if a skill you wrote stopped matching, look here for the new name.

## Version 1 (Firefox ESR 153.7.0)

Initial surface: 14 `--skein-*` tokens, 26 regions, root attribute `skein-space`.

Notes for skills written against older Firefox versions or other browsers'
mods:

- The old theme variables `--toolbar-bgcolor`, `--toolbar-color`,
  `--toolbar-field-color`, `--tab-selected-bgcolor`, `--arrowpanel-background`
  do not exist in this version. Use `--skein-toolbar-bg`, `--skein-toolbar-fg`,
  `--skein-field-fg`, `--skein-tab-selected-bg`, `--skein-panel-bg`.
- The address bar background box is the class `.urlbar-background`, not an id.

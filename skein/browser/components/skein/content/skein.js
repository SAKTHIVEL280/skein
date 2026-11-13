/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { SkeinCustomization } = ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinCustomization.sys.mjs");
const { SkeinSpaces, SPACE_COLORS } = ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinSpaces.sys.mjs");
const { SkeinPrivacy, LEAK_TEST_URLS } = ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinPrivacy.sys.mjs");
const { ContextualIdentityService } = ChromeUtils.importESModule("resource://gre/modules/ContextualIdentityService.sys.mjs");

const $ = id => document.getElementById(id);
const browserWindow = () => window.browsingContext.topChromeWindow;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") {
      node.className = value;
    } else if (key.startsWith("on")) {
      node.addEventListener(key.slice(2), value);
    } else if (value !== false && value !== undefined) {
      node[key] = value;
    }
  }
  node.append(...children);
  return node;
}

const STATE_TEXT = {
  starting: ["Starting", "Skein is reading the customization folder."],
  ok: ["Applied", "Your skills are applied."],
  empty: ["No skills", "No skills are enabled. The browser has its stock look."],
  rejected: ["Rejected", "The latest edit was not applied. The previous look is still in place."],
  "integrity-failed": ["Rolled back", "The latest edit hid or covered part of the security interface, so Skein undid it."],
  "safe-mode": ["Safe mode", "All skills are off."],
};

function renderStatus() {
  const status = SkeinCustomization.status;
  const [label, text] = STATE_TEXT[status.state] || [status.state, ""];
  $("status-badge").textContent = label;
  $("status-badge").dataset.state = status.state;
  const when = status.time ? ` Checked ${new Date(status.time).toLocaleTimeString()}.` : "";
  $("status-text").textContent = text + when;

  const problems = [];
  for (const e of status.errors || []) {
    problems.push(el("li", {}, el("code", {}, `${e.file || "folder"}${e.line ? `:${e.line}` : ""}`), ` ${e.message}`));
  }
  for (const i of status.integrity || []) {
    problems.push(el("li", {}, el("code", {}, i.selector || "window"), ` ${i.problem}`));
  }
  $("status-problems").replaceChildren(...problems);
  $("status-warnings").replaceChildren(...(status.warnings || []).map(w => el("li", {}, el("code", {}, w.file), ` ${w.message}`)));
  $("safe-mode-toggle").checked = Services.prefs.getBoolPref("skein.safeMode", false);
  $("custom-dir").textContent = SkeinCustomization.dir;
  $("agent-command").textContent = `cd "${SkeinCustomization.dir}" && claude`;
}

async function renderSkills() {
  const skills = await SkeinCustomization.listSkills();
  $("skills-empty").hidden = !!skills.length;
  $("skills-list").replaceChildren(
    ...skills.map(skill => {
      const checkbox = el("input", {
        type: "checkbox",
        checked: skill.enabled,
        id: `skill-${skill.id}`,
        onchange: () => SkeinCustomization.setSkillEnabled(skill.id, checkbox.checked),
      });
      return el(
        "li",
        {},
        checkbox,
        el("label", { class: "grow", htmlFor: `skill-${skill.id}` }, skill.name, el("span", { class: "sub" }, [skill.description, skill.touches.length ? `Touches: ${skill.touches.join(", ")}` : ""].filter(Boolean).join(" · ")))
      );
    })
  );
}

function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return [...a.map(t => ["del", t]), ...b.map(t => ["add", t])];
  }
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(["same", a[i]]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push(["del", a[i++]]);
    } else {
      out.push(["add", b[j++]]);
    }
  }
  while (i < n) {
    out.push(["del", a[i++]]);
  }
  while (j < m) {
    out.push(["add", b[j++]]);
  }
  return out;
}

async function showDiff(snapshot, older) {
  const now = await SkeinCustomization.readSnapshot(snapshot.id);
  const before = older ? await SkeinCustomization.readSnapshot(older.id) : { files: {}, assets: {} };
  const nodes = [];
  const paths = [...new Set([...Object.keys(before.files), ...Object.keys(now.files)])].sort();
  for (const path of paths) {
    const a = before.files[path];
    const b = now.files[path];
    if (a === b) {
      continue;
    }
    nodes.push(el("span", { class: "file" }, `${path}${a === undefined ? " (new)" : b === undefined ? " (removed)" : ""}`));
    for (const [kind, text] of diffLines(a === undefined ? [] : a.split("\n"), b === undefined ? [] : b.split("\n"))) {
      if (kind !== "same") {
        nodes.push(el("span", { class: kind }, `${kind === "add" ? "+" : "-"} ${text}`));
      }
    }
  }
  const assetPaths = [...new Set([...Object.keys(before.assets || {}), ...Object.keys(now.assets || {})])].sort();
  for (const path of assetPaths) {
    if ((before.assets || {})[path] !== (now.assets || {})[path]) {
      nodes.push(el("span", { class: "file" }, `${path} (binary asset changed)`));
    }
  }
  if (!nodes.length) {
    nodes.push("No differences.");
  }
  $("diff-title").textContent = `Changes in ${new Date(snapshot.time).toLocaleString()}${older ? "" : " (first snapshot)"}`;
  $("diff-body").replaceChildren(...nodes);
  $("diff-view").hidden = false;
}

async function renderHistory() {
  const snapshots = await SkeinCustomization.listSnapshots();
  $("history-empty").hidden = !!snapshots.length;
  $("rollback-button").disabled = !snapshots.some(s => !s.current);
  $("history-list").replaceChildren(
    ...snapshots.map((snapshot, index) =>
      el(
        "li",
        {},
        el(
          "span",
          { class: "grow" },
          `${new Date(snapshot.time).toLocaleString()}${snapshot.current ? " (current)" : ""}`,
          el("span", { class: "sub" }, snapshot.enabled.length ? `Skills: ${snapshot.enabled.join(", ")}` : "No skills enabled")
        ),
        el("button", { onclick: () => showDiff(snapshot, snapshots[index + 1]) }, "Show changes"),
        el("button", { disabled: snapshot.current, onclick: () => SkeinCustomization.rollback(snapshot.id) }, "Restore")
      )
    )
  );
}

function renderSpaces() {
  const identities = ContextualIdentityService.getPublicIdentities();
  $("spaces-list").replaceChildren(
    ...SkeinSpaces.spaces.map(space => {
      const name = el("input", {
        type: "text",
        value: space.name,
        maxLength: 64,
        ariaLabel: "Space name",
        onchange: () => SkeinSpaces.updateSpace(space.id, { name: name.value }),
      });
      const color = el(
        "select",
        { ariaLabel: "Space color", onchange: () => SkeinSpaces.updateSpace(space.id, { color: color.value }) },
        ...SPACE_COLORS.map(c => el("option", { value: c, selected: c === space.color }, c[0].toUpperCase() + c.slice(1)))
      );
      const container = el(
        "select",
        { ariaLabel: "Container for new tabs", onchange: () => SkeinSpaces.updateSpace(space.id, { containerId: Number(container.value) }) },
        el("option", { value: "0", selected: !space.containerId }, "No container"),
        ...identities.map(i => el("option", { value: String(i.userContextId), selected: i.userContextId === space.containerId }, ContextualIdentityService.getUserContextLabel(i.userContextId)))
      );
      return el(
        "li",
        {},
        el("span", { class: "grow" }, name),
        color,
        container,
        el("button", { disabled: SkeinSpaces.spaces.length <= 1, onclick: () => SkeinSpaces.deleteSpace(space.id) }, "Delete")
      );
    })
  );
}

function renderPrivacy() {
  const proxy = SkeinPrivacy.proxy;
  const tor = SkeinPrivacy.findTorBrowser();
  $("privacy-state").textContent = proxy
    ? `Privacy windows route everything through ${proxy.host}:${proxy.port}.`
    : tor
      ? "No proxy set: the Privacy switch opens Tor Browser."
      : "No proxy set and Tor Browser was not found: the Privacy switch opens the Tor Browser download page.";
  $("privacy-open-button").textContent = proxy ? "Open Privacy window" : "Open Tor Browser";
  if (document.activeElement !== $("proxy-host") && document.activeElement !== $("proxy-port")) {
    $("proxy-host").value = proxy?.host || "";
    $("proxy-port").value = proxy?.port || "";
  }
  $("tor-path").textContent = tor ? tor.path : "not found";
}

function renderAll() {
  renderStatus();
  renderSkills();
  renderHistory();
  renderSpaces();
  renderPrivacy();
}

function copy(text) {
  Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
}

$("rollback-button").addEventListener("click", () => SkeinCustomization.rollbackToPrevious());
$("disable-all-button").addEventListener("click", () => SkeinCustomization.disableAll());
$("safe-mode-toggle").addEventListener("change", event => Services.prefs.setBoolPref("skein.safeMode", event.target.checked));
$("copy-dir-button").addEventListener("click", () => copy(SkeinCustomization.dir));
$("copy-command-button").addEventListener("click", () => copy($("agent-command").textContent));
$("open-dir-button").addEventListener("click", () => {
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(SkeinCustomization.dir);
  file.reveal();
});
$("regen-docs-button").addEventListener("click", async () => {
  await SkeinCustomization.writeAgentDocs();
  $("regen-docs-result").textContent = "SKILL.md written.";
});
$("write-permissions-button").addEventListener("click", async () => {
  const path = await SkeinCustomization.writeAgentPermissions();
  $("write-permissions-result").textContent = `Written to ${path}. Check that your agent honours it by asking it to read a denied file.`;
});
$("new-space-form").addEventListener("submit", event => {
  event.preventDefault();
  SkeinSpaces.createSpace($("new-space-name").value);
  $("new-space-name").value = "";
});
$("proxy-form").addEventListener("submit", event => {
  event.preventDefault();
  SkeinPrivacy.setProxy($("proxy-host").value, $("proxy-port").value);
  renderPrivacy();
});
$("proxy-clear-button").addEventListener("click", () => {
  SkeinPrivacy.setProxy("", 0);
  renderPrivacy();
});
$("privacy-open-button").addEventListener("click", () => SkeinPrivacy.openPrivacy(browserWindow()));
$("privacy-test-button").addEventListener("click", () => SkeinPrivacy.openPrivacy(browserWindow(), LEAK_TEST_URLS));

const observer = () => renderAll();
Services.obs.addObserver(observer, "skein-customization-changed");
Services.obs.addObserver(observer, "skein-spaces-changed");
window.addEventListener("unload", () => {
  Services.obs.removeObserver(observer, "skein-customization-changed");
  Services.obs.removeObserver(observer, "skein-spaces-changed");
});

renderAll();

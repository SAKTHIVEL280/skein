# Skein: opinionated, agent-customizable browser on Gecko

> Handoff document for Claude Code. Read section 10 (Rules), section 11 (Phase 0 kickoff checklist) and section 12 (MVP cut line and known gaps) first.
> Facts marked **[VERIFY]** came from memory or secondary sources. Check them against official docs before relying on them.

## 1. Vision

An opinionated, open-source desktop browser for developers and power users, built around deep, effortless customization. Its differentiator is that **an AI agent can safely customize the browser itself** (layout, theme, behavior) from plain-language requests, using a permissioned, reversible "skills" system. **Skein ships no built-in AI chat.** Instead, users connect their own local coding agent (for example Claude Code CLI) which edits Skein's customization files directly, the same way a coding agent edits a project's configuration files. The agent may change only the browser's interface, never page content or user data. The goal is a browser that people try at least once because it is all-in-one and visibly different.

Core idea: if the user does not like the layout, they tell their agent and the browser changes: new themes, a different top bar, vertical tabs moved to another corner. The author has already created several themes and layout changes this way and wants Skein to make that the normal experience.

## 2. Decisions already made

| Decision | Choice | Notes |
|---|---|---|
| Engine | **Gecko, via a Firefox source fork** | Gecko is not separable from the Firefox tree. We patch Firefox. |
| Starting point | Vanilla Firefox source | **No Zen code.** Vertical tabs, spaces and split view are built from scratch as Skein's own implementation. Zen may be studied as a user-experience reference only. |
| License | Open source, **MPL 2.0 [VERIFY]** | Keep MPL notices on MPL files. Do not use Mozilla or Zen trademarks or logos. |
| Search | Any provider, Google selectable as default | Search engine is independent of the browser engine. |
| Solo developer | Yes, Claude Code and Opus-class models as the main leverage | |
| Timeline | 3 to 6 months to a daily-drivable build for the author | A publicly trusted release is a longer, ongoing effort. |
| AI model | **Bring-your-own local agent, interface only** | No in-browser chat sidebar in v1. A settings page helps the user connect a local agent (Claude Code CLI or similar) to Skein's customization folder. Skein itself has no AI provider accounts or keys. |
| Repository | **Public on GitHub from day one** | Keep secrets and signing keys out of the repo. MPL 2.0 applies. |
| Build machine | Windows laptop: i7-11800H (8 cores), 32 GB RAM, RTX 3050 Ti 4 GB, 1 TB SSD | Looks sufficient for building Firefox **[VERIFY against Mozilla's current Windows build requirements]**. The GPU does not matter for building. |
| Target platforms | **Windows first, then Linux, then macOS** | Build, CI and packaging order. Phase 0 happens on Windows. |
| Base release | **Firefox ESR (recommended; confirm with author)** | ESR = Extended Support Release: the long-supported Firefox line that gets security and stability fixes but fewer new features. Current ESR is Firefox 153 (released July 21, 2026, about 15 months of support) **[VERIFY]**. See section 8. |
| Profiles | **One profile in v1, no profile-switcher UI. Spaces plus containers, like Zen.** | Work/Personal separation is done with spaces bound to containers. The Firefox profile system stays underneath as the data root. Multiple profiles open at once is out of v1. |

Not chosen (for the record): Chromium and Helium-style fork. Reasons: C++ UI means every UI change needs a rebuild, which conflicts with AI-editable UI. Helium uses a patch series on Chromium and tracks roughly one major version per month **[VERIFY]**.

## 3. Why Gecko fits the idea

Firefox's browser UI is built from HTML, XHTML/XUL, CSS and JavaScript (including ES modules, `.sys.mjs`) **[VERIFY]**. A skill can change layout, theme and behavior by editing that code, with little or no C++ rebuild. This is the core technical bet. **Prove it in week 1 to 2 before building anything else.** Note: loading custom UI stylesheets in Firefox is controlled by a preference (`toolkit.legacyUserProfileCustomizations.stylesheets`) and applies at startup **[VERIFY]**. In a fork this can be enabled by default, but check whether a live reload without restart is possible, because the "AI changes the UI instantly" experience depends on it.

## 4. Product scope

### Core (must have)
- Fast, stable Gecko-based browser that passes the author's daily-driver test.
- **Vertical tabs, spaces (switchable workspaces) and split view are required.** The author wants these features but not Zen's code. Build them from scratch as Skein's own implementation on the Firefox base. Do not copy or port Zen's patches. Zen can be used as a UX reference only (how it behaves, not how it is coded).
  - **[VERIFY]** Recent upstream Firefox may already ship vertical tabs and tab groups. Using upstream Firefox features is fine (they are not Zen's code). Check what exists before writing duplicates, and extend upstream rather than reinventing where that is cleaner.
- Skills system (see section 6).
- Safe customization: validation, permissions, snapshots, one-click rollback.
- Theme engine: themes and layouts that an agent can create and switch.
- Import from Chrome, Arc, Safari, Firefox (bookmarks, history, passwords where possible).
- Firefox/AMO extension compatibility (inherited from Gecko).

### Organization model: profiles, containers, spaces, folders
The author wants all of these. They solve different problems, so keep the layers distinct and define how they relate before building any of them.

| Layer | What it is | Isolation | Notes |
|---|---|---|---|
| **Profile** | Top-level data root: settings, extensions, passwords, bookmarks, history, installed skills | Strongest (separate data directory) | **v1 decision: one profile, no profile-switcher UI**, matching how Zen presents spaces rather than profiles **[VERIFY how Zen treats profiles internally]**. Firefox's profile system remains underneath. Multiple simultaneous profiles are post-v1. |
| **Container** | Cookie and storage isolation inside one profile (Firefox "contextual identities", the engine behind Multi-Account Containers) | Per-container cookies, storage, cache | Inherited from Gecko **[VERIFY]**. Supports per-site rules (always open domain X in container Y), colors and icons. |
| **Space** | A workspace with its own tabs, folders, theme, layout and skill set | Organizational, not a security boundary by itself | Built from scratch. Each space can be bound to a default container. Fast switching (keyboard and gesture). |
| **Folder** | Grouping inside a space for tabs | None | Nested, collapsible, color and name, drag and drop, save/restore a folder as a session. |

**Also in scope for the organization model:**
- Pinned tabs and "essentials" shared across spaces.
- Split view (already a core requirement) as a saved layout inside a space.
- Session save and restore per space and per folder.
- Tab search and a command palette that can jump across spaces, folders and containers.
- Per-space themes and per-space skill sets (for example a Work space with a calm theme and a Gaming space with a bold one).
- Bookmarks and history that respect profile boundaries, with optional per-space filtering.

**Rules for how the layers interact:**
1. A **space is not a security boundary.** Only profiles and containers isolate data. The UI must not imply otherwise (do not label a space "private" unless it is bound to its own container).
2. Binding a space to a container is allowed and recommended for work/personal separation. Moving a tab between containers must reload it and clearly warn the user.
3. **Skills inherit the scope they were installed in** (profile, then space). A skill must never read or write data in a container, space or profile it was not granted. This extends the rules in section 6.
4. **Decided:** Skein v1 does not expose multiple profiles or run several at once. Use spaces bound to containers for work/personal separation. Revisit multi-profile support after v1 (it may need separate windows or processes).
5. Per-space themes and skills are stored with the space so they travel when the space is exported or synced.

**Suggested build order inside Phase 1:** profiles (reuse Firefox), containers (reuse Firefox), then spaces, then folders, then split-view layouts, then per-space theme and skills. Reuse what Gecko already provides for the first two and build the rest from scratch (no Zen code).

### Privacy, and an optional Tor mode
The author wants strong privacy by default and an optional "full privacy" mode like Tor Browser, with no leaks.

**Baseline privacy (always on):**
- No telemetry, studies, sponsored content or Mozilla service calls by default. Strip or disable them in the fork **[VERIFY each pref against current Firefox source]**.
- Use Firefox's tracking protection and cookie partitioning; evaluate HTTPS-only mode and encrypted DNS as defaults.
- No built-in AI service: Skein sends nothing to AI providers. Any AI help comes from the user's own local agent working on local files.
- Private spaces bound to their own containers (see the organization model).
- References to study: LibreWolf, Mullvad Browser, Tor Browser patches.

**Optional Tor mode: critical constraints (from Tor Project and Privacy Guides material):**
- Tor Browser is based on Firefox ESR with a series of privacy and security patches. The Tor Project says it is technically possible to route other browsers through Tor but strongly discourages it, because of serious deanonymization and leak risks.
- Tor's own design requirements say the browser must not bypass Tor proxy settings for any content, must not expose state from non-Tor browsing modes to the content window, and must not leave evidence of the private mode on disk.
- Extensions and non-standard settings make a user stand out and easier to fingerprint. Privacy Guides notes that a browser with its own Tor window (they cite Brave) is less fingerprint-resistant than Tor Browser and has far fewer Tor users, so those users stand out.
- **Consequence for Skein:** skills, AI, custom themes and extensions directly conflict with Tor's goal of looking identical to every other user. Skein must not claim "anonymous" for a customized browser.
- **Nuance: UI-only customization.** Skills are meant to change the browser's own interface, not web page content, so a purely cosmetic skill (colors, icon style) does not by itself reveal anything to websites. But UI changes can leak indirectly: sidebar width, vertical tab bar size, toolbar layout and zoom change the page viewport size, which sites can read and use to fingerprint. Tor Browser deals with this by standardizing window and viewport sizes **[VERIFY how]**. Rules: (a) the validator must ensure skills cannot inject into page content, (b) in any privacy or Tor mode the layout is locked to a standard one and all skills are disabled, (c) document which UI settings change what a website can observe.
- **Site access:** privacy modes must still load sites. Note that some sites block or challenge Tor exit traffic (CAPTCHAs, blocks) **[VERIFY how common]**, which is a limit of Tor itself, not Skein. Make failures clear in the UI instead of silently weakening protection.

**Options, in order of recommendation:**
1. **Hand-off (v1, recommended):** Skein detects or installs the official Tor Browser and opens it for the user ("Open in Tor Browser"). Cheap, honest, and the anonymity set stays intact.
2. **Hardened Tor mode (v2, only if committed long term):** port and maintain Tor Browser's patches in a separate mode. Requires tracking Tor's ESR-based release line **[VERIFY]**, which may mean basing Skein on Firefox ESR instead of the regular release channel. Treat this as its own security project, ideally reviewed with the Tor Project.
3. **Proxy-only Tor window (not recommended):** routing a private window through a bundled Tor daemon without the Tor Browser patches. Do not market this as anonymity.

**If option 2 is ever built, the mode must:**
- Run in a separate process and ephemeral profile; no sync, history, saved logins or state shared with normal mode.
- Disable all skills, AI features, extensions, custom themes and per-space settings (no user-specific fingerprint).
- Force all traffic, including DNS, through Tor with no bypass; disable WebRTC and other known leak paths.
- Use Tor Browser's fingerprint-resistance behaviors (standardized window size and similar) rather than inventing new ones.
- Show clear UI states and a "new identity" action, and state honestly that no browser can guarantee anonymity.

### User-facing design: two modes only
Decision: Skein shows **two modes** to the user, **Standard** and **Privacy** (alternate label: Secure). One switch, no menu of technical options. The tiers below (VPN, Tor) are implementation details behind the Privacy switch, not extra choices the user must understand.

**Behavior of Privacy mode (target):** hides the user's real IP address and approximate location from the sites they visit, with leak protections (DNS, WebRTC, IPv6, kill switch) and the locked layout and disabled skills described in the Tor subsection.

**Messaging rule (important):** do not tell users "your information won't be sent to the sites you visit" or promise anonymity. That is an overclaim: sites still receive what the user types or signs in with, and no browser can guarantee anonymity. Use accurate copy such as:
- "Privacy mode hides your IP address and location from the sites you visit."
- "Websites see a shared network address instead of yours."
Add a short "What this doesn't do" line in the settings or help page (logging in identifies you; the network provider may see you are using a privacy network).

**Keep it simple, but not hidden:** one small, persistent indicator of the active mode in the toolbar, and a kill switch that blocks traffic if protection drops, so the user is never silently unprotected. Privacy mode opens in its **own separate window** with a visibly different look (so it cannot be mistaken for Standard), and shares no state with Standard windows. This is the recommended design and is settled.

**Implementation staging for Privacy mode:**
1. **v1:** Privacy mode hands off to the official Tor Browser (or a user-supplied VPN/proxy with full leak protection) behind a single switch.
2. **v2 (only if committed long term):** integrated hardened mode based on Tor Browser's patches inside Skein (see feasibility notes in the Tor subsection). Tor Browser is itself a heavily patched Firefox ESR, so this is possible in principle on Gecko, but it needs a dedicated maintenance effort. **[VERIFY]** the license terms of the Tor Browser patches and whether Mullvad Browser (a Tor Browser-derived browser meant for use with a VPN) is a better reference for the VPN-backed variant.

### Network privacy modes (hide IP and location from websites)
Goal: a user-selectable mode in which websites cannot see the user's real IP address or pinpoint their location. Settings are per profile, per space or per container, and can be switched on and off.

**What websites can and cannot see (verify each before relying on it):**
- **IP address: visible to every site** you connect to. This reveals your approximate location and ISP. Only a proxy, VPN or Tor hides it. **HTTPS/encryption does not hide your IP from the destination site**; it only protects content from people in between.
- **MAC address: not sent to websites** over the internet (it only matters on the local network segment). No feature is needed to "hide" it from sites **[VERIFY]**. Randomizing it on public Wi-Fi is an OS-level setting, not a browser one.
- **Other location leaks:** the browser Geolocation API (permission-gated), Wi-Fi-based positioning, time zone, language settings, and WebRTC (can expose local and public IPs), plus DNS requests that bypass the tunnel and IPv6 leaks.

**Backend tiers behind the two user-facing modes (the user only sees Standard and Privacy; these are implementation details):**
1. **Standard:** tracking protection, HTTPS-only, no telemetry. IP is visible.
2. **Proxy/VPN mode:** route browser traffic through a user-supplied VPN or SOCKS5 proxy (for example a WireGuard or commercial VPN config). Sites see the VPN's IP. Trust moves to the VPN provider, who can see the user's real IP. Skein should not run its own VPN servers in v1 (cost and liability).
3. **Tor mode:** strongest IP protection, slower, with the constraints and the hand-off-first plan described in the Tor subsection above.

**Required leak protections for modes 2 and 3 (must be tested, not assumed):**
- Force DNS through the tunnel or proxy; no system-DNS fallback.
- Disable WebRTC or restrict it to the proxy path; block local IP exposure.
- Handle IPv6 (route it or disable it).
- Geolocation API off by default in these modes; time zone and language normalized where feasible.
- **Kill switch:** if the tunnel or proxy drops, block all traffic instead of falling back to the direct connection.
- Small, persistent indicator of the active mode (see the two-mode design), plus a built-in leak test page (IP, DNS, WebRTC).
- Optional per-container or per-space routing (for example, Work space direct, Research space over a VPN). **[VERIFY]** how Firefox's proxy APIs support per-container routing.

**Honest limits to state in the UI and docs:**
- A VPN provider sees your real IP and can log it; Tor hides your IP from sites but your ISP can see that you use Tor.
- Logging in to an account identifies you regardless of IP. Cookies and browser fingerprint can still link sessions.
- Network privacy does not hide your identity from the sites you voluntarily sign in to.

### Features inspired by Zephium (all-in-one goal)
Zephium is a Rust browser that renders through the OS webview (WKWebView on macOS, WebView2 on Windows). It is not a Chromium or Firefox fork, has a single maintainer, and has no Linux or mobile build as of late Oct 2026. Sources: opensourcealternatives.to and SourceForge listings. Its notable features, as listed there:
- **Work canvas** where AI agents research, compare and plan in view, with parallel agents.
- **"Ask" sidebar assistant** aware of the current page, tabs and history.
- **Bring-your-own-model** with keys for OpenAI, Anthropic, Gemini, xAI, Mistral, DeepSeek, Groq, Cerebras, OpenRouter, plus local models. Keys stored in the system keychain.
- **Approval-based automation**: agents ask before acting.
- **Built-in notes, tasks and focus tracking** in the browser.
- **On-device storage and zero first-party telemetry** until the user signs in.
- **One-step import** from other browsers.
- A claimed list of verified-compatible extensions (password managers, Dark Reader, Vimium and others).

**Scope update:** because Skein uses the user's own local agent instead of a built-in assistant, the bring-your-own-keys, sidebar assistant, approval-based agent actions and Work canvas ideas are **out of v1** (candidate post-v1 features). Keep notes, tasks and focus tracking as optional Phase 3 ideas, and keep one-step browser import.

### Ideas beyond the above (optional, validate first)
- Project-aware spaces: one space per git repo, grouping localhost, docs and issues.
- Keyboard-first command palette.
- Skill remixing ("fork this skill and make it purple").
- An MCP or CLI bridge so an external agent can configure the browser. **[VERIFY]** what Firefox exposes before promising this.

### Explicitly out of scope for v1
Mobile apps, sync service, own search engine, own extension store.

## 5. Naming

**Name: Skein** (spelled S-K-E-I-N; confirmed by the author, though final clearance below is still pending). The author says it "Skyen"; the standard dictionary pronunciation is "skayn" (rhymes with "rain"), so expect users to say it that way. Pick one pronunciation and state it on the website. A skein is a length of thread, matching the philosophy: freedom with a line you control. The original codename "Kite" is retired because it collides with existing products: an App Store browser named Kite for news lovers, a Product Hunt "Kite" AI browser companion, a "calm browser" called Kite, and Zerodha's Kite trading platform (dominates "kite" searches, especially in India).

**Name checks only partly done.** The author reports finding no conflicts. One web search by the assistant for "Skein browser" found no browser by that name, but it did find: (a) Skein the cryptographic hash function (used in Haskell crypto libraries); (b) a GitHub project named `skein` (abblake/skein), a companion dashboard for Claude Code. It is not a browser, but it targets the same audience (Claude Code users), so search results and word of mouth may overlap. One search is not proof. Before public branding, complete this checklist:
1. Web search for "Skein browser" and "Skein Firefox".
2. Domains (.com, .app, .dev).
3. GitHub org and social handles.
4. App stores and package managers (Homebrew, Flathub, winget).
5. Trademark search in the author's country and the US.

Fallbacks if Skein fails the checks: Thermik, Tailwynd (weakest, close to Tailwind). Avoid: Aloft, Windward, Updraft (crowded), Glide (likely an existing Firefox-based browser, **[VERIFY]**). Keep the kite and thread metaphor as the tagline.

## 6. Skills system and security model

This is the product's trust core. Treat it as a first-class feature.

**Principles**
1. Skills are **declarative**: CSS, layout manifests, preference values, keybindings. Free-form JavaScript is a separate, stricter tier.
2. The AI may edit appearance and layout freely, but **never** touches: password store, cookies, sessions, form data, page content, or permission and security prompts, without an explicit user permission prompt.
3. Every skill declares what it touches. Show a diff before applying.
4. **Snapshot before every change. One-click rollback.** Keep a safe mode that boots with all skills disabled.
5. Validator rejects dangerous output: remote `url()` loads, hiding or spoofing the address bar, padlock, permission dialogs or download prompts, and anything outside the declared scope.
6. JS-tier skills require review, signing or explicit per-skill consent. Shared skills are a malware channel, so a store needs signing and review before it opens.
7. Treat all page content, skill descriptions and agent inputs as untrusted (prompt-injection risk).
8. Skills are scoped to the profile and space they were installed in. They cannot read or write data from other containers, spaces or profiles without an explicit permission prompt.
9. **Local agent trust boundary.** The external agent edits files on disk with the user's own operating-system permissions. Skein cannot sandbox it. Therefore: (a) keep the customization folder separate from the profile data folder (passwords, cookies, history); (b) Skein treats the customization folder as untrusted input and validates it on every load; (c) tell users in the settings page to give their agent access only to the customization folder (for example through the agent's own permission settings) and to review diffs before applying; (d) never put secrets in the customization folder.
10. **Protecting profile data from a local agent (plain-language summary):** Encryption protects files from someone who steals the disk or copies the folder. It does *not* stop a program running as the same Windows user, because that program can ask Windows to unlock the data the same way the browser does. Firefox's saved passwords are encrypted, but without a Primary Password the unlocking key is effectively available to any process running as the user **[VERIFY]**. So the plan is layered:
    - Keep the agent's customization folder separate from the profile data folder (see principle 9).
    - Encourage or default to setting a **Primary Password** (a passphrase that the agent does not know), which makes saved passwords unreadable without it **[VERIFY behavior and coverage in the current Firefox ESR]**.
    - Evaluate storing secrets in the Windows credential store, and note that this still does not stop a same-user process by itself **[VERIFY]**.
    - Offer an optional "hardened agent setup" guide: run the agent in a separate Windows user account, a virtual machine or WSL, or configure the agent's own permission rules to deny access to the profile folder **[VERIFY each option]**.
    - Never claim that encryption makes an agent-edited setup fully safe. State the limit plainly.

**Format (starting point, mirror existing conventions)**
Zen mods use a folder with `theme.json` (metadata), `preferences.json` (user settings) and `chrome.css`, with preferences exposed to CSS through `-moz-pref` media queries. The community mod manager Sine supports userChrome, userContent and the Zen mod format. Study both before inventing a format. Consider staying compatible.

**Update compatibility process (when Firefox ESR changes)**
Because Skein is a fork, every upstream Firefox update is merged by the maintainer, which is the moment to check what changed in the interface.
1. **Stable surface manifest:** keep a file listing every UI region, element ID, selector and design token that skills and the agent instruction files rely on (the "stable surface").
2. **On every upstream merge:** diff the browser UI source against the previous version (the interface markup, styles and scripts; exact paths to be confirmed in Phase 0 **[VERIFY]**). Automatically check that every item in the manifest still exists. Any miss fails the merge until fixed or mapped to a new name.
3. **Test with sample skills:** build with a set of reference skills (themes, layouts, vertical tabs moved to another corner) and compare screenshots against the last good version.
4. **Update the agent instruction files:** when the stable surface changes, update the `SKILL.md` files and add a short changelog for agents, so new agent-made customizations use the new names.
5. **Protect existing users:** on the user's machine, after a Skein update, run a compatibility check on their customization folder (for example, flag selectors that no longer match any element), then show what may be broken and offer one-click rollback to the last working snapshot. The maintainer's checks cannot see what each user's agent created, so this runtime check is required.
6. **Expect most UI changes at the yearly ESR jump** rather than in monthly point releases **[VERIFY]**. Plan extra time for that merge.
7. **Automate detection, keep a human on decisions.** Run a scheduled job (for example weekly, through GitHub Actions) that checks for a new Firefox ESR release, merges it into a test branch, diffs the UI source, runs the stable-surface check, and opens a pull request with a plain report of what changed. A coding agent may propose fixes to the manifest and instruction files in that pull request. Full Firefox builds and screenshot tests are heavy and may exceed free hosted runners **[VERIFY limits]**, so run those on the author's machine or a self-hosted runner. **Never auto-merge or auto-release:** a person reviews every update before it ships, because browser updates are security-critical.

## 7. Phases

**Phase 0: build pipeline (weeks 1 to 2)**
- Get Firefox source building on the author's machine. Make one visible UI change and run it.
- Measure build and rebuild times. Document the exact commands used.
- Prove the key bet: change a piece of browser UI by editing HTML/CSS/JS only, without a full rebuild.
- Performance gate: build with release optimizations (profile-guided optimization and link-time optimization **[VERIFY availability for the chosen platform]**), then compare against stock Firefox ESR on the same machine: Speedometer, JetStream **[VERIFY current benchmark names]**, startup time, memory with 30 tabs, and the author's 10 most-used sites. If Skein feels clearly slower, find out why before adding features.
- Decision gate: if the no-rebuild test fails, builds are painfully slow, or performance is clearly worse than stock, stop and reassess before more work.

**Phase 1: daily-drivable core (weeks 3 to 8)**
- Baseline privacy defaults: no telemetry, studies or sponsored content; tracking protection; HTTPS-only evaluation.
- Confirm Firefox ESR as the base (see section 8) before heavy patching.
- Windows-first build, CI and installer; Linux packaging next; macOS last.
- Branding (new name, no Mozilla marks), default config, search provider, import tools.
- Organization model (see section 4): profiles and containers (reuse Gecko), then spaces, folders and split view written from scratch (extend upstream Firefox features where they exist; no Zen code), then per-space themes and skills.
- Basic theme engine and skill loader.
- CI for builds on at least one OS. Plan update delivery and signing.

**Validation gate after Phase 1:** put the daily-drivable build in front of 10 to 20 developers (friends, Reddit, communities). Ask whether they would use the skills system daily. Their answers decide how much to invest in Phase 3.

**Phase 2: AI skills and safety (months 2 to 4)**
- Privacy mode v1: separate window, mode indicator, hand-off to official Tor Browser or user-supplied VPN/proxy, leak tests (DNS, WebRTC, IPv6), kill switch.
- **Agent bridge:** a documented customization folder (theme CSS, layout manifest, preference values, keybindings), plus `SKILL.md`-style instruction files that teach a local agent how to edit it safely (a skills folder of instruction files an agent reads before editing). A settings page explains how to connect Claude Code CLI or another local agent, and can generate the agent instruction files for the user.
- Validator on load (rejects anything outside the allowed scope), live reload where possible, diff view, snapshot before every applied change, one-click rollback, and safe mode.
- Optional later: an MCP server so agents can call Skein safely instead of editing files directly **[VERIFY feasibility]**.

**Phase 3: polish and launch (months 4 to 6)**
- Notes/tasks/focus, skill manager UI.
- Public alpha, security review, honest documentation of risks.
- Open-source hygiene: README, CONTRIBUTING, `SECURITY.md` with a vulnerability disclosure process, issue templates, and a clear statement of supported platforms and update policy.
- Windows installer (unsigned until a certificate is funded; see risks); macOS and Linux packaging follow.
- Distribution: GitHub, Reddit, Instagram, developer communities.

## 8. Risks and open questions

- **Update treadmill:** Firefox ships frequently **[VERIFY cadence]**. Falling behind on security patches endangers users. Decide the rebase policy and who ships updates before public release.
- **Build cost:** multi-GB source tree, long builds, C++/Rust toolchain failures **[VERIFY requirements for the author's OS]**.
- **DRM (Widevine):** the author reports streaming works in Zen. Verify on Skein early (see section 12), since streaming sites may not play without it.
- **Update delivery:** a fork needs its own update server, signing keys and release process; Mozilla's update service is for Mozilla's builds **[VERIFY]**. Security updates must reach users quickly. Budget for hosting.
- **Code signing (deferred by the author):** until a code-signing certificate is bought (possibly via sponsors), Windows will likely show an "unknown publisher" SmartScreen warning on install, which users can click through but which hurts trust and downloads **[VERIFY current SmartScreen behavior]**. Document the warning and how to verify downloads (published checksums, open-source build instructions) in the README. Revisit when funding exists.
- **Branding and trademarks:** Firefox's name and logos are Mozilla trademarks. Use the unbranded build configuration, your own name and icons **[VERIFY Mozilla's trademark and distribution policy for forks]**.
- **Add-ons store:** relying on Mozilla's add-ons site (AMO) in a fork may be subject to its terms **[VERIFY]**. Check what other Firefox forks do.
- **Site compatibility:** Gecko has more edge-case bugs on Chromium-tested sites.
- **Distribution:** the author's previous projects shipped fast but have little traffic. A browser needs sustained marketing and trust.
- **Security of AI editing:** the biggest product risk, see section 6. A local agent running as the user can read any file the user can, including the browser profile folder. Skein can reduce harm (separate folders, strict validation, rollback) but cannot prevent a misbehaving or prompt-injected agent from touching other files. State this plainly in the docs.
- **Base release: ESR recommended.** Mainstream Firefox ships every four weeks; ESR is promoted about once a year and gets security fixes for roughly 15 months (Firefox 153 ESR as of this writing **[VERIFY]**). A solo developer carrying many patches benefits from rebasing on a stable line, and Tor Browser also builds on ESR **[VERIFY]**. Costs: fewer new features and web-platform changes, still-regular point-release merges for security, and a large rebase each time the ESR line moves to a new major version (there is an overlap period for the move). Upstream ESR 140 release notes mention vertical-tab features, so check what ESR 153 already ships before building your own **[VERIFY]**.
- **Tor mode:** a customizable browser cannot honestly promise Tor-level anonymity. Ship the hand-off first, and only build a hardened mode as a dedicated security project.
- **Platform scope:** Windows first, then Linux, then macOS. Windows builds need the Mozilla build tools and are heavy **[VERIFY requirements]**; code signing matters for Windows trust and updates.
- **Competitors:** Zen (mods), Sine (mod manager), Dia (natural-language "Skills"), Firefox's own Smart Window AI assistant, Zephium. Differentiate on safe AI editing of the browser itself.

## 9. Author answers and remaining questions
**Answered:**
1. Hardware: Windows laptop, i7-11800H, 32 GB RAM, RTX 3050 Ti (4 GB), 1 TB SSD. More storage is available if needed.
2. Repository: public on GitHub from day one.
3. AI scope: the agent edits the browser interface only. No in-browser chat sidebar. Users connect their own local agent (Claude Code CLI or similar) through a settings page.
4. AI providers: none built in. Providers are whatever the user's own agent uses.

**Still open:**
1. Code-signing certificate: deferred by the author; sponsors may fund it later. Update-server hosting budget is still needed before a public alpha.
2. Name clearance checks (domain, GitHub org, trademarks) for Skein: the author reports no conflicts, but note the hash function and the `skein` Claude Code dashboard project found in research.
3. How agent-generated skills will be shared and reviewed (a store is post-v1).

## 10. Rules for Claude Code

1. Verify every **[VERIFY]** item against official Mozilla, Zen and library docs before acting. Do not trust this file over the source.
2. Start with Phase 0. Do not write features before the build pipeline and the "edit UI without rebuild" test both work.
3. Never weaken the security rules in section 6 to ship faster. If a requirement conflicts, stop and ask.
4. Keep changes small and reversible. Prefer patches over broad edits to Firefox source, so rebases stay cheap.
5. Record build commands, versions and decisions in a `docs/` folder as you go.
6. Do not invent URLs, package names, APIs or file paths. If unsure, search or ask.
7. Respect licenses: keep MPL headers, avoid Mozilla and Zen trademarks and logos.
8. Do not copy Zen source code. Study Zen's behavior as a reference at most. Spaces, vertical tabs and split view are Skein's own implementation.
9. Work Windows-first. Give exact, tested commands for the author's machine, and say what you could not test.
10. Keep a `PATCHES.md` listing every change to upstream Firefox source and why, so rebases onto new ESR point releases stay manageable.
11. Ask before destructive operations (deleting build directories, resetting the source tree, changing signing keys).
12. When a security-relevant requirement is unclear, choose the safer behavior and ask the author.

## 11. Kickoff checklist for Claude Code (Phase 0)
1. Read this whole file, then list every **[VERIFY]** item and check the ones needed for Phase 0.
2. Confirm the build requirements for Firefox ESR on Windows from Mozilla's official docs; check the author's machine against them.
3. Fetch the Firefox ESR source (current ESR line) and get a stock build running.
4. Make one visible change to the browser UI (for example, a distinct toolbar color) and rebuild. Record the time.
5. Prove the live-edit bet: change UI by editing CSS/JS in the profile without a rebuild; find out whether it applies live or needs a restart.
6. Run the performance comparison against stock ESR (see Phase 0).
7. Write `docs/phase0-report.md`: commands used, timings, what failed, and a go/no-go recommendation.

## 12. MVP cut line and known gaps (review before starting)

**Why this section exists:** the feature list above is far larger than one developer can finish in 3 to 6 months. Treat the MVP below as the real target, and everything else as later.

**MVP (v0.1), the 3 to 6 month target:**
- Phase 0 proven: Windows build, live UI edit, performance check.
- Branded Windows build with privacy defaults and telemetry off.
- Vertical tabs and spaces (use upstream Firefox features where they exist; the ESR 140 release notes suggest vertical tabs already ship **[VERIFY]**), plus basic folders.
- Customization folder, structured layout and theme manifest, validator, live reload, snapshots and rollback.
- Agent instruction files (`SKILL.md` style) and a "connect your agent" settings page.
- One flagship demo: an agent redesigns the browser from a plain-language request (new theme, vertical tabs moved to another corner, a different top bar) and the user can roll it back in one click.
- Privacy mode v1 (separate window, hand-off to Tor Browser or user VPN/proxy, leak tests).

**After the MVP:** containers UI polish, split view and session management (unless upstream already provides them), import beyond Firefox and Chrome, notes/tasks/focus, built-in Tor mode, Linux then macOS, a shared skills registry, an MCP server.

**Known gaps and loopholes:**
1. **Customizations can break when Firefox updates.** An agent can restyle and rearrange almost any part of the interface, which is the point. The risk is that the internal names and structure of Firefox's UI change between ESR versions, so an agent-made layout can silently break after an update. Mitigate with a documented list of stable regions and design tokens that Skein maintains across updates, an automatic check on each update that flags broken customizations, and one-click rollback.
2. **Scope versus timeline** (see above). Cut aggressively.
3. **Streaming and DRM (Widevine).** The author reports that streaming works in Zen. Still test Netflix and similar sites on Skein in Phase 0, because a custom build may differ **[VERIFY how a Firefox ESR fork obtains Widevine]**.
4. **No sync.** Users who switch browsers expect bookmarks and settings across devices. Firefox Sync is Mozilla's service and may not be available to a fork **[VERIFY]**. Plan an export/import path at minimum.
5. **The validator is hard.** CSS can hide or overlay security indicators (address bar, padlock, permission prompts). Build an adversarial test suite for the validator and run it on every change.
6. **Shared skills are a prompt-injection channel.** A `SKILL.md` downloaded from the internet can contain instructions aimed at the user's agent (for example, "read the profile folder"). Treat shared skills as untrusted: review, sign, and warn before an agent follows them.
7. **Audience limit.** Users without a local coding agent cannot customize. This narrows the market to developers and power users, which is acceptable for v1. Revisit a built-in option later.
8. **Keep the bridge agent-agnostic.** Do not depend on one vendor's tool. Document the folder format so any agent can use it.
9. **Ecosystem is the moat.** Plan a public skills and themes repository early, even as a plain GitHub repo, so users can share what their agents create.
10. **Testing is not yet specified.** Add automated tests for the validator, rollback, layout rendering (screenshots) and keyboard navigation. Check accessibility of agent-generated layouts.
11. **Market reality.** The realistic goal is a loved niche (developers and customization fans), like Zen, not Chrome's mass market. Competitors can copy features, so speed, safety and community matter more than any single feature.

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Skein default preferences. Every name here was checked against the
// Firefox ESR 153.7.0 source tree (see docs/privacy-defaults.md).

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
pref("app.update.url.manual", "https://github.com/SAKTHIVEL280/skein/releases");
pref("app.update.url.details", "https://github.com/SAKTHIVEL280/skein/releases");
pref("devtools.selfxss.count", 5);

// --- Telemetry, studies, experiments: off -------------------------------
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.usage.uploadEnabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.server", "data:,");
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.updatePing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.coverage.opt-out", true);
pref("toolkit.coverage.endpoint.base", "");
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
pref("nimbus.rollouts.enabled", false);
pref("browser.newtabpage.activity-stream.telemetry", false);
pref("browser.search.serpEventTelemetryCategorization.enabled", false);
pref("dom.private-attribution.submission.enabled", false);
pref("browser.tabs.crashReporting.sendReport", false);
pref("browser.crashReports.unsubmittedCheck.autoSubmit2", false);
pref("breakpad.reportURL", "");

// --- Sponsored content, promotions, recommendations: off ----------------
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.showSponsoredCheckboxes", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.system.showWeather", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
pref("browser.urlbar.quicksuggest.dataCollection.enabled", false);
pref("browser.discovery.enabled", false);
pref("extensions.getAddons.showPane", false);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("browser.vpn_promo.enabled", false);
pref("browser.promo.focus.enabled", false);
pref("browser.preferences.moreFromMozilla", false);
pref("browser.aboutwelcome.enabled", false);
pref("browser.shell.checkDefaultBrowser", false);

// --- No built-in AI: Skein ships none ------------------------------------
pref("browser.ml.chat.enabled", false);
pref("browser.ml.enable", false);

// --- Tracking protection and network hygiene ------------------------------
pref("browser.contentblocking.category", "strict");
pref("dom.security.https_only_mode", true);
pref("network.dns.disablePrefetch", true);
pref("network.prefetch-next", false);
pref("network.http.speculative-parallel-limit", 0);
// WebRTC: never expose local addresses; when a page is loaded through a
// proxy (Privacy windows), WebRTC may only use that proxy.
pref("media.peerconnection.ice.proxy_only_if_behind_proxy", true);
pref("media.peerconnection.ice.default_address_only", true);
pref("media.peerconnection.ice.no_host", true);

// --- Skein interface defaults ---------------------------------------------
pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", true);
pref("browser.tabs.groups.enabled", true);
pref("skein.customization.enabled", true);
pref("skein.customization.dir", "");
pref("skein.customization.managedPrefs", "{}");
pref("skein.safeMode", false);
pref("skein.spaces.list", "[]");
pref("skein.spaces.showLabels", false);
pref("skein.layout.toolbar.position", "top");
pref("skein.privacy.proxy.host", "");
pref("skein.privacy.proxy.port", 0);
pref("skein.privacy.torBrowserPath", "");
pref("media.eme.enabled", true);
pref("sidebar.verticalTabs.dragToPinPromo.dismissed", true);

// Zen-style layout: vertical tabs in an always-visible sidebar, rounded content.
pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", true);
pref("sidebar.visibility", "always-show");
pref("sidebar.revamp.round-content-area", true);
pref("sidebar.main.tools", "history,bookmarks");
pref("skein.ui.zen", true);

// Focus features (SkeinFocus.sys.mjs).
pref("browser.tabs.closeWindowWithLastTab", false);
pref("browser.ctrlTab.sortByRecentlyUsed", true);
pref("browser.toolbars.bookmarks.visibility", "always");
pref("skein.ui.topSearchBar", false);
pref("skein.focus.compact", false);
pref("skein.focus.sidebarHidden", false);
pref("skein.focus.floatingNewTab", true);
pref("skein.agentSkills.install", true);

# Security policy

Skein is a browser. Security reports are the most valuable contribution you can make.

## Reporting a vulnerability

Please report privately, not in a public issue:

- Use GitHub's **Report a vulnerability** button under the Security tab of
  <https://github.com/SAKTHIVEL280/skein> (private vulnerability reporting).

Include the Skein version (`about:support`), your OS, and steps to reproduce.
You should get an acknowledgement within 7 days. Skein is maintained by one
person; please allow time for a fix before public disclosure (90 days by
default, sooner by agreement once a fix ships).

## What is in scope

- **Validator bypasses.** Any file in the customization folder that passes
  validation and then hides, covers, moves, disables or imitates the address
  bar, site identity area, permission prompts, download prompts or dialogs; or
  that loads a remote resource; or that affects web page content; or that sets
  a preference outside the allowlist. These are treated as high severity.
- **Runtime integrity check bypasses** (a bundle that is applied although a
  protected element is no longer visible and readable).
- **Privacy mode leaks** with a proxy configured: any request from a Privacy
  window that reaches the network without going through the proxy, including
  DNS and WebRTC, or that continues after the proxy stops.
- Rollback or safe mode failing to restore a working browser.
- Anything in Skein's own code (`browser/components/skein`, the patches listed
  in `PATCHES.md`, the build and release scripts).

## What is upstream

Bugs in Gecko or Firefox itself should go to Mozilla
(<https://www.mozilla.org/security/>). If you are unsure, report it here and
it will be forwarded.

## Known limits (not vulnerabilities)

- Skein cannot sandbox a local agent. An agent runs with the user's operating
  system permissions and can read any file the user can, including the browser
  profile. See `docs/hardened-agent-setup.md`.
- A space is not a security boundary. Only containers and profiles isolate data.
- Privacy mode is not anonymity. For anonymity use Tor Browser.
- Windows builds are currently unsigned.

## Supported versions

Only the latest release receives fixes. Skein tracks the Firefox ESR line and
aims to ship each upstream security point release promptly; see
`docs/release.md` for the update process.

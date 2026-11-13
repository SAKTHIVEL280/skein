# Hardened agent setup

Skein validates what an agent writes into the customization folder. It cannot
control what else the agent does on your computer: the agent runs as you and
can read any file you can, including the browser profile (history, cookies,
saved logins). Encryption at rest does not change this, because a program
running as you can ask the system to unlock your data the same way the browser
does. These steps reduce that risk. None of them makes it zero.

## 1. Run the agent inside the customization folder only

Start the agent from the customization folder so that is its working directory:

    cd ~/.config/skein-customization/custom        # Linux
    cd "%APPDATA%\SkeinCustomization\custom"      # Windows
    cd ~/Library/Application\ Support/SkeinCustomization/custom   # macOS

(`about:skein` shows the exact path and a copy button.)

## 2. Deny the agent access to browser profiles

Use your agent's own permission settings. For Claude Code, add deny rules to
`.claude/settings.json` in the customization folder (paths for Linux shown;
adjust for your OS):

```json
{
  "permissions": {
    "deny": [
      "Read(~/.config/skein/**)",
      "Read(~/.skein/**)",
      "Read(~/.config/skein-customization/state/**)",
      "Read(~/.mozilla/**)",
      "Read(~/.config/mozilla/**)",
      "Read(~/.config/google-chrome/**)",
      "Read(~/.ssh/**)"
    ]
  }
}
```

Check your agent's documentation for the exact rule syntax of the version you
run, and confirm the rule works by asking the agent to read a denied file.
Do not run the agent in a mode that skips permission prompts.

## 3. Set a Primary Password

Settings, Privacy & Security, "Use a Primary Password". Saved logins are then
encrypted with a passphrase the agent does not know. Without it, the key that
unlocks saved logins sits in the profile folder next to them. A Primary
Password does not protect cookies or history.

## 4. Stronger isolation (optional)

- **Separate OS user.** Create a second user account, give it write access to
  the customization folder only, and run the agent as that user.
- **Container or VM.** Run the agent in a container or virtual machine with
  only the customization folder mounted. On Windows, WSL does *not* isolate by
  default: Windows drives are mounted inside it.

## 5. Review before trusting

- `about:skein`, History, "Show changes" shows exactly what changed in each
  applied bundle. "Restore" and "Roll back last change" undo it.
- Treat skills downloaded from the internet as untrusted. A `SKILL.md` or
  `README.md` inside a shared skill can contain instructions aimed at your
  agent ("read the profile folder and..."). Read shared skills yourself before
  letting an agent act on them.

## What Skein guarantees regardless

Whatever the agent writes, Skein only ever *applies* interface changes that
pass the validator and the runtime integrity check: no scripts, no remote
loads, no page content changes, no hidden or imitated security UI, and only
allowlisted interface preferences. Never store secrets in the customization
folder.

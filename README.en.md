# Canvas Course Hub

Automatically pull your Canvas course materials, assignments, grades and announcements to your own computer, organise them into folders, and surface everything in a web dashboard plus Feishu / macOS reminders.

**Everyone runs their own copy**: you supply your own Canvas token, all data stays on your machine, nothing is uploaded to a third-party server.

## Features

- Dynamic course discovery: every sync reads your active courses from Canvas (nothing hard-coded); new courses automatically get a folder
- Incremental downloads: keyed by file id + updated time; files you already have are never downloaded twice
- Smart classification: keyword rules first, DeepSeek as fallback
- Grade tracking: current scores from Canvas + assessment weights parsed from your syllabus PDF, with a "what do I need on the final to stay safe" calculation
- Action list: pending assignments ranked by urgency x weight
- Dashboard: week calendar, deadline heatmap, course cards, one-click open local files
- Reminders: macOS notifications / Feishu messages / Feishu calendar events (1 day + 1 hour before)
- Daily digest in Markdown, weekly rollup on Sundays
- Scheduled jobs: sync at 08:00 and deadline check at 20:00 every day (missed runs catch up on wake)

## Quick start (5 minutes)

Requirements: macOS (core features work on Linux/Windows but without scheduled jobs and system notifications) and Node.js 18+. If Node is missing, the installer offers to run brew install node for you.

### 1. Get the project

Unzip the canvas-hub folder anywhere (Desktop is fine), or clone this repository.

### 2. Create a Canvas token

1. Open Canvas (e.g. https://canvas.cityu.edu.hk) and sign in
2. Avatar (top right) -> Account -> Settings
3. Find Approved Integrations -> + New Access Token
4. Give it any purpose, click generate, copy the string (looks like 1839~xxxx)

The token is stored only in your local secrets.json (mode 600).

### 3. Run the installer

    cd path/to/canvas-hub
    bash install.sh

The wizard asks for: install directory (default ~/Desktop/canvas-hub), course files directory (default ~/Desktop/CityU-Courses), Canvas URL, Canvas token, optional DeepSeek API key, feature toggles (macOS notifications / web dashboard / scheduled jobs / Feishu), interface language (Chinese or English) and whether to generate demo data.

It then runs a first sync, installs background jobs, opens the dashboard at http://127.0.0.1:8788 and finishes with a health check.

### 4. Use it

- Dashboard: course cards, "what to do next", 10-day deadlines, recent files (click a file name to open it locally)
- Calendar: week view + deadline heatmap + next 30 days
- Chat: ask "which course is most at risk" or "update my data" (it will actually run a sync)
- Settings: DeepSeek key, Canvas token, manual sync, language and theme toggles

### Unattended install

    NONINTERACTIVE=1 \
      CANVAS_TOKEN=your_token \
      FILES_DIR="$HOME/Desktop/CityU-Courses" \
      DEEPSEEK_KEY=sk-xxx \
      ENABLE_MACOS=1 ENABLE_WEB=1 ENABLE_SCHEDULE=1 ENABLE_LARK=0 \
      bash install.sh

## Optional features

### Demo data (no Canvas token needed)

    node cli.mjs demo          # 3 fake courses with grades and safety lines
    node cli.mjs demo --off    # restore your real data

### DeepSeek (chat assistant, syllabus parsing, smart classification)

Add your API key under Settings in the web dashboard (create one at platform.deepseek.com). Everything else works without it. Cost is usage-based: typically a few cents to a couple of dollars per month; parsing syllabi the first time costs a bit more.

### Feishu (calendar + Bitable + message push)

Why bother: deadlines become Feishu calendar events with reminders, all course data lands in a Bitable you can filter, and the daily digest is pushed to a Feishu bot chat. It is entirely optional.

    npx @larksuite/cli@latest install     # install lark-cli
    node cli.mjs lark-setup               # authorise with your own Feishu account
    node cli.mjs lark-init                # create the "Canvas 课程中心" Bitable and bind it

## Commands

    node cli.mjs doctor              # health check (run this first when something is off)
    node cli.mjs daily               # full pipeline (same as the 08:00 job)
    node cli.mjs evening             # sync + next-day deadline reminder
    node cli.mjs sync                # sync and download only
    node cli.mjs analyze [--force]   # re-parse syllabus assessment weights
    node cli.mjs classify [--all]    # smart classification
    node cli.mjs due 10              # deadlines within 10 days
    node cli.mjs demo [--off]        # demo data on/off
    node cli.mjs server              # run the web dashboard in the foreground

## Scheduled jobs (macOS)

    launchctl list | grep canvashub                                # list jobs
    launchctl kickstart -k gui/$(id -u)/com.canvashub.morning      # run the morning job now
    launchctl bootout gui/$(id -u)/com.canvashub.morning           # stop it
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.canvashub.morning.plist   # re-enable

Logs: logs/launchd-morning.log, logs/launchd-evening.log, logs/launchd-web.log

## Packaging for others

    bash package.sh

Produces dist/canvas-hub-<date>.zip with source, installer and docs, excluding your secrets.json, data/, logs/ and personal config.

## FAQ

**Token invalid (HTTP 401)?** Regenerate it in Canvas -> Account -> Settings -> Approved Integrations, then paste the new one in the web Settings page (or edit secrets.json).

**Dashboard will not open?** Check the port: lsof -nP -i :8788. If it is taken, change web.port in config.json and run launchctl kickstart -k gui/$(id -u)/com.canvashub.web.

**Scheduled job did not run?** Run node cli.mjs doctor and read logs/launchd-morning.log.

**My materials live elsewhere.** Point download.root in config.json at your existing folder; files with the same name are detected and not downloaded again.

**How do I uninstall?** bash uninstall.sh removes the background jobs (your course files are untouched); then delete the program folder.

## Privacy

- Canvas token lives in secrets.json (600), DeepSeek key in data/settings.json (600)
- No data leaves your machine; the web server binds to 127.0.0.1 only
- Never commit or share secrets.json / data/ (already covered by .gitignore)

## License

MIT. See LICENSE.

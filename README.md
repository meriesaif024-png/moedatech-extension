# Moedatech Detector

A Chrome extension for leaving feedback notes (with screenshots) on the team's web apps, shared across everyone who installs it.

## Setup (for each team member)

1. **Download this repo.**
   - Easiest: click the green **Code** button on GitHub → **Download ZIP** → unzip it somewhere.
2. **Get the API key** from whoever shared this repo with you (it's not in the repo for security reasons — ask in Slack/DM, don't post it publicly).
3. Inside the `extension/` folder, copy `config.example.js` to a new file named `config.js`, and paste the real API key in:
   ```js
   const API_KEY = "PASTE_THE_REAL_KEY_HERE";
   ```
4. Open Chrome and go to `chrome://extensions`.
5. Turn on **Developer mode** (top-right toggle).
6. Click **Load unpacked** and select the `extension/` folder.
7. You should see the Moedatech logo appear in your extensions list and toolbar.

## Using it

- On any of the covered sites (`ai.moedatech.net`, `web-beta.moedatech.net`, `os.moedatech.net`), click the extension icon.
- **"+ Add note"** — click or drag-select something on the page, pick a category, write a note (optional), and save. A full-page screenshot with the spot highlighted is captured automatically.
- The popup shows notes for the current page; **"View all notes across the site"** opens a dashboard with everything, filterable by person.
- Notes can be **assigned** to a team member, **marked complete** (records who resolved it), or **deleted**.
- Everyone with the extension installed gets a native notification when a note is marked complete.

## If something isn't loading

- Make sure you reloaded the extension (refresh icon on its card in `chrome://extensions`) *and* refreshed the page after any update.
- If it was just installed/updated with new permissions, remove and re-add the extension instead of just refreshing.

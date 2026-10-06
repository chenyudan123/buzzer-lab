# Buzzer Lab

A Science Bowl practice app for phones and tablets. It uses the official sample rounds that the U.S. Department of Energy publishes for the National Science Bowl (245 middle school rounds, 257 high school rounds), reads toss-ups aloud like a moderator, and tracks accuracy and buzz speed by category.

Everything is stored on the device. No accounts, no server.

## 1. Put it online (one time, about 10 minutes)

The app is a set of plain files. It needs to be served over `https` so phones can install it. GitHub Pages is free and permanent:

1. Create a free account at github.com, then click **New repository**. Name it `buzzer-lab`, make it **Public**, and create it.
2. On the new repository page, click **uploading an existing file**. Drag in everything inside this folder (`index.html`, `manifest.webmanifest`, `sw.js`, and the `js` and `icons` folders). Click **Commit changes**.
3. Go to **Settings → Pages**. Under "Branch," choose `main` and `/ (root)`, then **Save**.
4. After a minute the page shows your address, for example `https://yourname.github.io/buzzer-lab/`.

## 2. Install it on his device

- **iPhone or iPad:** open the address in **Safari**, tap the Share button, then **Add to Home Screen**.
- **Android:** open it in **Chrome**, tap the ⋮ menu, then **Install app** (or **Add to Home screen**).

It then opens full screen from its own icon and works offline once rounds are added.

## 3. Add official rounds

Open the **Rounds** tab. Every DOE set is listed by year.

- Tap **Add** on a round. If DOE's site lets the app download the PDF directly, the questions appear right away.
- If not, the app switches to the manual path: tap **Open PDF**, save or download the file, then tap **Import PDFs** and choose one or more saved files. The app reads the questions from the PDF on the device.
- Choose **Middle school** or **High school** before importing so files with generic names (like `Round1.pdf`) are labeled correctly.

## 4. Practice

- **Mixed practice:** pick categories, toss-ups or bonuses, and "Not seen yet" or "Missed last time."
- **A full round, in order:** plays a round as a match would, with bonuses only after a correct toss-up.
- **Read aloud / Listen only:** the device voice reads each question. "Listen only" hides the text until he buzzes, which is closest to real competition.
- Toss-ups: +4, 5 seconds to buzz after the reading ends; a wrong interrupt is −4. Bonuses: +10, 20 seconds.
- Short answers are checked against DOE's answer and its listed alternatives. Since a moderator would judge some answers, he can tap **I was right** or **Actually, mark it wrong**.

## Progress

The **Progress** tab shows accuracy by category, buzz point (how much of the question had been read when he buzzed) and reaction time by category, trends across rounds, and the questions he missed. Use **Save backup file** occasionally; progress lives only on that device.

## Files

- `index.html` – app shell and styles
- `js/app.js` – practice, scoring, progress, import
- `js/parser.js` – turns the text of a DOE round PDF into questions
- `js/catalog.js` – links to every official DOE sample round
- `sw.js`, `manifest.webmanifest`, `icons/` – offline support and home-screen install

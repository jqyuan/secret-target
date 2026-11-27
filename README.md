# Secret Target

A party game for phones. Everyone gets a secret target and a task. Get your target to do the task, they confirm on their phone, and you take over their target and task. Most tags at the end of the night wins.

Players don't need an account. They open the link, type a name and the 4-letter game code.

## One-time setup (about 10 minutes)

### 1. Make the free Firebase database
1. Go to <https://console.firebase.google.com> and click **Create a project**. Any name works. You can turn off Google Analytics.
2. In the left menu open **Build → Firestore Database** and click **Create database**. Pick a location near you and choose **Start in production mode**.
3. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.
4. Click the gear icon (**Project settings**) → **General**. Under **Your apps**, click the **</>** (Web) icon, give it a nickname, and register it. You don't need Firebase Hosting.
5. Copy the `firebaseConfig` values it shows into `firebase-config.js`.

### 2. Put it on GitHub Pages
1. Create a new public repository on GitHub, for example `secret-target`.
2. Upload these files to it: `index.html`, `app.js`, `style.css`, `firebase-config.js` (README and rules are optional).
3. In the repo go to **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
4. After a minute your game is live at `https://<your-username>.github.io/secret-target/`.

## Playing
1. The host opens the link, types a name and taps **Host a new game**.
2. The host taps **Share game link** and sends it. Friends tap it, type a name, and tap **Join game**. (They can also open the main link and type the code.)
3. The host edits the task list if they want and taps **Start the game** (3+ players).
4. Tap **Show** to see your target and pick one of two starting tasks. Stuck on a task? Each player gets one **Reset task** for the whole night. When your target does it, tap **Mission complete**.
5. Your target gets a pop-up and confirms. You get their target and task automatically.
6. The game ends when one player is left, or when the host taps **End the game**.

## Notes
- Each phone remembers its player through the browser. If someone switches browsers or clears their data mid-game, the host can remove them from **Host controls**.
- Targets are hidden in the app, but anyone with the link and some tech skill could read the game data. It's built for fun, not secrecy.
- The free Firebase plan easily covers a party (50,000 reads and 20,000 writes a day).

## Test it locally
Browsers block these module files when opened straight from disk, so run a tiny server in this folder:

```
python -m http.server 8000
```

Then open <http://localhost:8000>.

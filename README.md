# BCC Golf

A phone-first app for the BCC Golf League at Avon Fields. It installs from the browser ("Add to Home Screen") and works like an app.

## What works today

- Home: this week's event, skins game (admins edit), player standings with Best 15, team standings, season stats.
- Score: hole-by-hole entry for your group with putts, fairways and greens, live leaderboard with weekly points.
- Rounds: any week's results and team matchups, upcoming tee sheets, Ringer and Net Ringer boards.
- GPS: front, middle and back yardages for each green, plus an admin tool to map the greens on the course.
- Menu: league rules and skins winners.

## Limits for now

League data is a built-in copy of the 2026 season from GolfSoftware. Scores entered here stay on the phone.
GolfSoftware's service only answers its own website, so live data and posting scores wait on GolfSoftware granting access.
Sign-in is a demo: any email and an 8+ character password work, and you pick Admin or Player.

## Mapping the greens

1. Sign in as Admin and open GPS. Tap "Turn on GPS" and allow location.
2. Pick the nine and hole, stand on the front edge of the green, wait for accuracy under about 5 yards, and tap "Set front". Do the same for middle and back.
3. When finished, tap "Share green data" and send the text over so the greens can be built in for everyone.

## Files

- `index.html` – the whole app (HTML, CSS and JavaScript in one file)
- `manifest.webmanifest`, `icons/` – home-screen install
- `sw.js` – offline cache for weak signal on the course

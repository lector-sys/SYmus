# SYmuS

A personal desktop music player. Searches YouTube, streams audio, and keeps your
playlists, likes and listening history in a local SQLite database. Nothing is
uploaded anywhere and nothing is written to disk except the library itself.

- **App ID** `com.madhusudan.symusplayer` · **Product name** SYmuS

## Install

Build artifacts land in `dist/`.

### Windows

```bash
npm run build:win        # -> dist/symus-desktop-1.0.0-setup.exe
```

Run the `.exe`. It is an assisted installer: pick the install location, and tick
the desktop-shortcut box if you want one. It installs per-user, so Windows does
not prompt for admin rights.

Afterwards SYmuS appears in the Start Menu and in Start-menu search, and launches
like any other installed app. Uninstall from **Settings → Apps → SYmuS**.

### Linux

```bash
npm run build:linux      # -> dist/symus-desktop-1.0.0-x86_64.AppImage
chmod +x dist/symus-desktop-1.0.0-x86_64.AppImage
./dist/symus-desktop-1.0.0-x86_64.AppImage
```

The AppImage carries a desktop entry with `Categories=AudioVideo;Player;Music;`,
so it shows up under Sound & Video. To register it with the launcher permanently,
install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher), or
move the file to `~/Applications/` where most desktops pick it up automatically.

### macOS

```bash
npm run build:mac        # -> dist/symus-desktop-1.0.0-arm64.dmg
```

Open the `.dmg` and drag SYmuS to Applications; it then appears in Launchpad.

The build is ad-hoc signed, not signed with a Developer ID, so Gatekeeper will
refuse it on first launch. Either right-click the app and choose **Open**, or:

```bash
xattr -cr /Applications/SYmuS.app
```

### Build these on the OS they target

`better-sqlite3` is a native module, so a Linux or macOS build produced on
Windows ships a Windows `.node` and will not start. AppImage assembly also needs
Linux tooling. Run each platform's build on that platform (or in CI).

## Using it

- **Home** — recently played, recommendations, your playlists, most listened, and
  a genre browser. All of it is built from your own listening history.
- **Search** — a query, or paste any YouTube video or playlist URL. Playlists are
  pulled in whole; endless `RD…` auto-mixes are not.
- Tracks are auto-tagged with a genre from their title, artist, and the search
  they came from. Retag any track with the tag button on its row.
- Closing the window hides SYmuS to the tray; **Quit** is in the tray menu.
  Media keys work while the app is in the background.

## Icon

`build/icon.svg` is the single source. Replace it with any 1024×1024 square SVG
and run `npm run icons` to regenerate `build/icon.png`, the `build/icons/` PNG set
for Linux, and `resources/icon.png` for the window and tray. electron-builder
derives the Windows `.ico` and macOS `.icns` from `build/icon.png` at package time.

## Development

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm test` | Queue engine and URL-parsing unit tests |
| `npm run smoke` | Library layer against a real SQLite file with real migrations |
| `npm run drive` | Launches the built app and drives it over the DevTools protocol, hitting YouTube for real; screenshots land in `scripts/shots/` |
| `npm run typecheck` | Main, preload and renderer |
| `npm run icons` | Regenerate icons from `build/icon.svg` |
| `npm run db:migrate` | Create a Prisma migration after editing `prisma/schema.prisma` |

`npm run drive` also accepts a packaged binary, which is how a release is checked
before shipping:

```bash
SYMUS_BIN=./dist/win-unpacked/SYmuS.exe node scripts/drive.mjs
```

Migrations are inlined into the bundle at build time, so the packaged app needs
no Prisma CLI and applies any pending migration itself on boot.

# Rkarousel (Wayland Optimized)

**Rkarousel** is a tiling script with scrolling for KWin. It works exceptionally well on ultrawide monitors.

Unlike standard tiling, this script doesn't force all windows onto a single screen, shrinking them to an unreadable size. Instead, it arranges windows into an infinite horizontal ribbon (a carousel). You control the window widths, and the script simply centers the active window.

This approach is similar to window managers like [PaperWM](https://github.com/paperwm/PaperWM), [Niri](https://github.com/YaLTeR/niri), and [Cardboard](https://gitlab.com/cardboardwm/cardboard).

> 💡 **Tip:** For smooth animations when moving windows, it's recommended to install [this effect](https://github.com/peterfajdiga/kwin4_effect_geometry_change).

## Features of This Fork
This is a modified version of the original [Karousel](https://github.com/peterfajdiga/karousel), tailored specifically for **KDE Plasma 6** and **Wayland sessions**.
*   **Wayland Only:** X11 support code has been removed, improving performance.
*   **Optimization:** Redundant geometry checks have been eliminated, making the script faster and smoother.

## Dependencies
The script requires the following QML modules (usually present in the system, but please verify):
- `QtQuick 6.0`
- `org.kde.kwin 3.0`
- `org.kde.notification 1.0` (package `qml-module-org-kde-notifications` on Ubuntu/Debian or `kwin` on Arch).

## Limitations
*   **Wayland only** (will not work on X11).
*   No multi-monitor support yet.
*   Does not support pinning windows to "All Desktops".
*   Does not support Activities.

## Installation

### Manual Installation
1.  Download the source code.
2.  Open a terminal in the project directory.
3.  Run the installation command:

```bash
kpackagetool6 --type KWin/Script -i .
```

To update the script (if you downloaded a new version), use the `-u` flag:

```bash
kpackagetool6 --type KWin/Script -u .
```

### Enabling the Script

1.  Go to **System Settings** -> **Window Management** -> **KWin Scripts**.
2.  Find **Rkarousel**, check the box, and click **Apply**.

## Hotkeys

Keys can be reconfigured in **System Settings** -> **Shortcuts** -> **KWin**. The default list is provided below.

| Shortcut | Action |
| :--- | :--- |
| **Meta + Space** | Toggle window mode (Floating <-> Tiling) |
| **Meta + A** | Focus left |
| **Meta + D** | Focus right *(May conflict with defaults, reassign)* |
| **Meta + W** | Focus up *(May conflict)* |
| **Meta + S** | Focus down *(May conflict)* |
| **(not assigned)** | Focus next window in grid |
| **(not assigned)** | Focus previous window in grid |
| **Meta + Home** | Focus to the very beginning of the list |
| **Meta + End** | Focus to the very end of the list |
| **Meta + Shift + A** | Move window left |
| **Meta + Shift + D** | Move window right |
| **Meta + Shift + W** | Move window up |
| **Meta + Shift + S** | Move window down |
| **Meta + Shift + Home** | Move window to the beginning |
| **Meta + Shift + End** | Move window to the end |
| **Meta + X** | "Stack" mode for a column (only the active window in the column is visible) |
| **Meta + Ctrl + Shift + A** | Move the entire column left |
| **Meta + Ctrl + Shift + D** | Move the entire column right |
| **Meta + Ctrl + Shift + Home** | Move column to the beginning |
| **Meta + Ctrl + Shift + End** | Move column to the end |
| **Meta + Ctrl + +** | Increase column width |
| **Meta + Ctrl + -** | Decrease column width |
| **Meta + R** | Toggle width (from presets: 50%, 100%, etc.) |
| **Meta + Shift + R** | Toggle width (reverse order) |
| **Meta + Ctrl + X** | Equalize width of all visible columns |
| **Meta + Ctrl + A** | Squeeze left column onto the screen |
| **Meta + Ctrl + D** | Squeeze right column onto the screen |
| **Meta + Alt + Return** | Center the active window (scroll the carousel to it) |
| **Meta + Alt + A** | Scroll one column left |
| **Meta + Alt + D** | Scroll one column right |
| **Meta + Alt + PgUp** | Scroll left (freely) |
| **Meta + Alt + PgDown** | Scroll right (freely) |
| **Meta + Alt + Home** | Scroll to the beginning |
| **Meta + Alt + End** | Scroll to the end |
| **Meta + Ctrl + Return** | Move the Karousel grid to the current monitor |
| **Meta + [Number]** | Focus on column number [Number] |
| **Meta + Shift + [Number]** | Move window to column number [Number] |
| **Meta + Ctrl + Shift + [Number]** | Move column to position number [Number] |
| **Meta + Ctrl + Shift + F[Number]** | Move column to virtual desktop F[Number] |

> *Note: **Meta** is the Super key (Windows key).*

## License and Authors

Based on code from [Karousel](https://github.com/peterfajdiga/karousel) by Peter Fajdiga.
License: GPLv3.

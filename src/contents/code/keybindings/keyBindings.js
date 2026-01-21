"use strict";

class ShortcutAction {
    constructor(keyBinding, callback, qmlBase) {
        this.shortcutHandler = ShortcutAction.createShortcutHandler(keyBinding, qmlBase);
        if (this.shortcutHandler) {
            this.shortcutHandler.activated.connect(callback);
        }
    }

    destroy() {
        if (this.shortcutHandler) {
            this.shortcutHandler.destroy();
        }
    }

    static createShortcutHandler(keyBinding, qmlBase) {
        if (!qmlBase) {
            log("Warning: qmlBase not provided to ShortcutAction.createShortcutHandler()");
            return null;
        }

        try {
            const sequenceLine = keyBinding.defaultKeySequence
                ? `    sequence: "${keyBinding.defaultKeySequence}";\n`
                : '';

            const qmlCode = `
                import QtQuick 6.0
                import org.kde.kwin 3.0

                ShortcutHandler {
                    name: "karousel-${keyBinding.name}";
                    text: "Karousel: ${keyBinding.description}";
                    ${sequenceLine}
                }
            `;

            return Qt.createQmlObject(qmlCode, qmlBase);
        } catch (error) {
            log("Error creating ShortcutHandler for", keyBinding.name, ":", error);
            return null;
        }
    }
}

function catchWrap(f) {
    return () => {
        try {
            f();
        }
        catch (error) {
            log(error);
            log(error.stack);
        }
    };
}

function registerKeyBinding(shortcutActions, keyBinding, qmlBase) {
    const wrappedAction = catchWrap(keyBinding.action);
    const shortcutAction = new ShortcutAction(keyBinding, wrappedAction, qmlBase);
    if (shortcutAction.shortcutHandler) {
        shortcutActions.push(shortcutAction);
    }
}

function registerNumKeyBindings(shortcutActions, numKeyBinding, qmlBase) {
    const numPrefix = numKeyBinding.fKeys ? "F" : "";
    const n = numKeyBinding.fKeys ? 12 : 9;

    for (let i = 0; i < 12; i++) {
        const numKey = String(i + 1);

        const keySequence = i < n
            ? numKeyBinding.defaultModifiers + "+" + numPrefix + numKey
            : "";

        const actionName = applyMacro(numKeyBinding.name, numKey);
        const actionDescription = applyMacro(numKeyBinding.description, numKey);
        const actionWrapper = catchWrap(() => numKeyBinding.action(i));

        const shortcutAction = new ShortcutAction({
            name: actionName,
            description: actionDescription,
            defaultKeySequence: keySequence,
        }, actionWrapper, qmlBase);

        if (shortcutAction.shortcutHandler) {
            shortcutActions.push(shortcutAction);
        }
    }
}

function getKeyBindings(world, actions) {
    return [
        {
            name: "window-toggle-floating",
            description: "Toggle floating",
            defaultKeySequence: "Meta+Space",
            action: () => world.do(actions.windowToggleFloating),
        },
        {
            name: "focus-left",
            description: "Move focus left",
            defaultKeySequence: "Meta+A",
            action: () => world.doIfTiledFocused(actions.focusLeft),
        },
        {
            name: "focus-right",
            description: "Move focus right",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultKeySequence: "Meta+D",
            action: () => world.doIfTiledFocused(actions.focusRight),
        },
        {
            name: "focus-up",
            description: "Move focus up",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultKeySequence: "Meta+W",
            action: () => world.doIfTiledFocused(actions.focusUp),
        },
        {
            name: "focus-down",
            description: "Move focus down",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultKeySequence: "Meta+S",
            action: () => world.doIfTiledFocused(actions.focusDown),
        },
        {
            name: "focus-next",
            description: "Move focus to the next window in grid",
            action: () => world.doIfTiledFocused(actions.focusNext),
        },
        {
            name: "focus-previous",
            description: "Move focus to the previous window in grid",
            action: () => world.doIfTiledFocused(actions.focusPrevious),
        },
        {
            name: "focus-start",
            description: "Move focus to start",
            defaultKeySequence: "Meta+Home",
            action: () => world.do(actions.focusStart),
        },
        {
            name: "focus-end",
            description: "Move focus to end",
            defaultKeySequence: "Meta+End",
            action: () => world.do(actions.focusEnd),
        },
        {
            name: "window-move-left",
            description: "Move window left",
            comment: "Moves window out of and into columns",
            defaultKeySequence: "Meta+Shift+A",
            action: () => world.doIfTiledFocused(actions.windowMoveLeft),
        },
        {
            name: "window-move-right",
            description: "Move window right",
            comment: "Moves window out of and into columns",
            defaultKeySequence: "Meta+Shift+D",
            action: () => world.doIfTiledFocused(actions.windowMoveRight),
        },
        {
            name: "window-move-up",
            description: "Move window up",
            defaultKeySequence: "Meta+Shift+W",
            action: () => world.doIfTiledFocused(actions.windowMoveUp),
        },
        {
            name: "window-move-down",
            description: "Move window down",
            defaultKeySequence: "Meta+Shift+S",
            action: () => world.doIfTiledFocused(actions.windowMoveDown),
        },
        {
            name: "window-move-next",
            description: "Move window to the next position in grid",
            action: () => world.doIfTiledFocused(actions.windowMoveNext),
        },
        {
            name: "window-move-previous",
            description: "Move window to the previous position in grid",
            action: () => world.doIfTiledFocused(actions.windowMovePrevious),
        },
        {
            name: "window-move-start",
            description: "Move window to start",
            defaultKeySequence: "Meta+Shift+Home",
            action: () => world.doIfTiledFocused(actions.windowMoveStart),
        },
        {
            name: "window-move-end",
            description: "Move window to end",
            defaultKeySequence: "Meta+Shift+End",
            action: () => world.doIfTiledFocused(actions.windowMoveEnd),
        },
        {
            name: "column-toggle-stacked",
            description: "Toggle stacked layout for focused column",
            comment: "Only the active window visible",
            defaultKeySequence: "Meta+X",
            action: () => world.doIfTiledFocused(actions.columnToggleStacked),
        },
        {
            name: "column-move-left",
            description: "Move column left",
            defaultKeySequence: "Meta+Ctrl+Shift+A",
            action: () => world.doIfTiledFocused(actions.columnMoveLeft),
        },
        {
            name: "column-move-right",
            description: "Move column right",
            defaultKeySequence: "Meta+Ctrl+Shift+D",
            action: () => world.doIfTiledFocused(actions.columnMoveRight),
        },
        {
            name: "column-move-start",
            description: "Move column to start",
            defaultKeySequence: "Meta+Ctrl+Shift+Home",
            action: () => world.doIfTiledFocused(actions.columnMoveStart),
        },
        {
            name: "column-move-end",
            description: "Move column to end",
            defaultKeySequence: "Meta+Ctrl+Shift+End",
            action: () => world.doIfTiledFocused(actions.columnMoveEnd),
        },
        {
            name: "column-width-increase",
            description: "Increase column width",
            defaultKeySequence: "Meta+Ctrl++",
            action: () => world.doIfTiledFocused(actions.columnWidthIncrease),
        },
        {
            name: "column-width-decrease",
            description: "Decrease column width",
            defaultKeySequence: "Meta+Ctrl+-",
            action: () => world.doIfTiledFocused(actions.columnWidthDecrease),
        },
        {
            name: "cycle-preset-widths",
            description: "Cycle through preset column widths",
            defaultKeySequence: "Meta+R",
            action: () => world.doIfTiledFocused(actions.cyclePresetWidths),
        },
        {
            name: "cycle-preset-widths-reverse",
            description: "Cycle through preset column widths in reverse",
            defaultKeySequence: "Meta+Shift+R",
            action: () => world.doIfTiledFocused(actions.cyclePresetWidthsReverse),
        },
        {
            name: "columns-width-equalize",
            description: "Equalize widths of visible columns",
            defaultKeySequence: "Meta+Ctrl+X",
            action: () => world.do(actions.columnsWidthEqualize),
        },
        {
            name: "columns-squeeze-left",
            description: "Squeeze left column onto the screen",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultKeySequence: "Meta+Ctrl+A",
            action: () => world.doIfTiledFocused(actions.columnsSqueezeLeft),
        },
        {
            name: "columns-squeeze-right",
            description: "Squeeze right column onto the screen",
            defaultKeySequence: "Meta+Ctrl+D",
            action: () => world.doIfTiledFocused(actions.columnsSqueezeRight),
        },
        {
            name: "grid-scroll-focused",
            description: "Center focused window",
            comment: "Scrolls so that the focused window is centered in the screen",
            defaultKeySequence: "Meta+Alt+Return",
            action: () => world.doIfTiledFocused(actions.gridScrollFocused),
        },
        {
            name: "grid-scroll-left-column",
            description: "Scroll one column to the left",
            defaultKeySequence: "Meta+Alt+A",
            action: () => world.do(actions.gridScrollLeftColumn),
        },
        {
            name: "grid-scroll-right-column",
            description: "Scroll one column to the right",
            defaultKeySequence: "Meta+Alt+D",
            action: () => world.do(actions.gridScrollRightColumn),
        },
        {
            name: "grid-scroll-left",
            description: "Scroll left",
            defaultKeySequence: "Meta+Alt+PgUp",
            action: () => world.do(actions.gridScrollLeft),
        },
        {
            name: "grid-scroll-right",
            description: "Scroll right",
            defaultKeySequence: "Meta+Alt+PgDown",
            action: () => world.do(actions.gridScrollRight),
        },
        {
            name: "grid-scroll-start",
            description: "Scroll to start",
            defaultKeySequence: "Meta+Alt+Home",
            action: () => world.do(actions.gridScrollStart),
        },
        {
            name: "grid-scroll-end",
            description: "Scroll to end",
            defaultKeySequence: "Meta+Alt+End",
            action: () => world.do(actions.gridScrollEnd),
        },
        {
            name: "screen-switch",
            description: "Move Karousel grid to the current screen",
            defaultKeySequence: "Meta+Ctrl+Return",
            action: () => world.do(actions.screenSwitch),
        },
    ];
}

function getNumKeyBindings(world, actions) {
    return [
        {
            name: "focus-{}",
            description: "Move focus to column {}",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultModifiers: "Meta",
            fKeys: false,
            action: (i) => world.do(actions.focus.partial(i)),
        },
        {
            name: "window-move-to-column-{}",
            description: "Move window to column {}",
            comment: "Requires manual remapping according to your keyboard layout, e.g. Meta+Shift+1 -> Meta+!",
            defaultModifiers: "Meta+Shift",
            fKeys: false,
            action: (i) => world.doIfTiledFocused(actions.windowMoveToColumn.partial(i)),
        },
        {
            name: "column-move-to-column-{}",
            description: "Move column to position {}",
            comment: "Requires manual remapping according to your keyboard layout, e.g. Meta+Ctrl+Shift+1 -> Meta+Ctrl+!",
            defaultModifiers: "Meta+Ctrl+Shift",
            fKeys: false,
            action: (i) => world.doIfTiledFocused(actions.columnMoveToColumn.partial(i)),
        },
        {
            name: "column-move-to-desktop-{}",
            description: "Move column to desktop {}",
            defaultModifiers: "Meta+Ctrl+Shift",
            fKeys: true,
            action: (i) => world.doIfTiledFocused(actions.columnMoveToDesktop.partial(i)),
        },
        {
            name: "tail-move-to-desktop-{}",
            description: "Move this and all following columns to desktop {}",
            defaultModifiers: "Meta+Ctrl+Shift+Alt",
            fKeys: true,
            action: (i) => world.doIfTiledFocused(actions.tailMoveToDesktop.partial(i)),
        },
    ];
}

function registerKeyBindings(world, config, qmlBase) {
    const actions = new Actions(config);
    const shortcutActions = [];

    const keyBindings = getKeyBindings(world, actions);
    const numKeyBindings = getNumKeyBindings(world, actions);

    for (const keyBinding of keyBindings) {
        registerKeyBinding(shortcutActions, keyBinding, qmlBase);
    }

    for (const numKeyBinding of numKeyBindings) {
        registerNumKeyBindings(shortcutActions, numKeyBinding, qmlBase);
    }

    return shortcutActions;
}

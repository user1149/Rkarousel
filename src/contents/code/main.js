"use strict";
console.log("load Rkarousel");

// ============================================================================
// Инициализация обработчиков сигналов рабочего пространства
// ============================================================================

function initWorkspaceSignalHandlers(world, focusPasser) {
    const manager = new SignalManager();

    const handleWindow = (world, action) => (kwinClient) => {
        world.do((clientManager, desktopManager) => {
            action(clientManager, kwinClient);
        });
    };

    manager.connect(Workspace.windowAdded, handleWindow(world, (cm, client) => {
        cm.addClient(client);
    }));

    manager.connect(Workspace.windowRemoved, handleWindow(world, (cm, client) => {
        cm.removeClient(client, 1 /* FocusPassing.Type.Immediate */);
    }));

    manager.connect(Workspace.windowActivated, (kwinClient) => {
        if (kwinClient === null) {
            focusPasser.activate();
        } else {
            focusPasser.clearIfDifferent(kwinClient);
            world.do((clientManager) => {
                clientManager.onClientFocused(kwinClient);
            });
        }
    });

    manager.connect(Workspace.currentDesktopChanged, () => {
        world.do(() => { /* re-arrange desktop */ });
    });

    manager.connect(Workspace.currentActivityChanged, () => {
        world.do(() => { /* re-arrange desktop */ });
    });

    manager.connect(Workspace.screensChanged, () => {
        world.do((clientManager, desktopManager) => {
            desktopManager.selectScreen(Workspace.activeScreen);
        });
    });

    manager.connect(Workspace.activitiesChanged, () => {
        world.do((clientManager, desktopManager) => {
            desktopManager.updateActivities();
        });
    });

    manager.connect(Workspace.desktopsChanged, () => {
        world.do((clientManager, desktopManager) => {
            desktopManager.updateDesktops();
        });
    });

    manager.connect(Workspace.virtualScreenSizeChanged, () => {
        world.onScreenResized();
    });

    return manager;
}

class PresetWidths {
    constructor(presetWidths, spacing) {
        this.presets = PresetWidths.parsePresetWidths(presetWidths, spacing);
    }

    next(currentWidth, minWidth, maxWidth) {
        const widths = this.getWidths(minWidth, maxWidth);
        const nextIndex = widths.findIndex(width => width > currentWidth);
        return nextIndex >= 0 ? widths[nextIndex] : widths[0];
    }

    prev(currentWidth, minWidth, maxWidth) {
        const widths = this.getWidths(minWidth, maxWidth).reverse();
        const nextIndex = widths.findIndex(width => width < currentWidth);
        return nextIndex >= 0 ? widths[nextIndex] : widths[0];
    }

    getWidths(minWidth, maxWidth) {
        const widths = this.presets.map(f => clamp(f(maxWidth), minWidth, maxWidth));
        widths.sort((a, b) => a - b);
        return uniq(widths);
    }

    static parsePresetWidths(presetWidths, spacing) {
        function getRatioFunction(ratio) {
            return (maxWidth) => Math.floor((maxWidth + spacing) * ratio - spacing);
        }

        return presetWidths.split(",").map((widthStr) => {
            widthStr = widthStr.trim();

            const widthPx = PresetWidths.parseNumberWithSuffix(widthStr, "px");
            if (widthPx !== undefined) return () => widthPx;

            const widthPct = PresetWidths.parseNumberWithSuffix(widthStr, "%");
            if (widthPct !== undefined) {
                return getRatioFunction(widthPct / 100.0);
            }

            return getRatioFunction(PresetWidths.parseNumberSafe(widthStr));
        });
    }

    static parseNumberSafe(str) {
        const num = Number(str);
        if (isNaN(num) || num <= 0) {
            throw new Error("Invalid number: " + str);
        }
        return num;
    }

    static parseNumberWithSuffix(str, suffix) {
        if (!str.endsWith(suffix)) return undefined;

        const numberStr = str.substring(0, str.length - suffix.length).trim();
        return PresetWidths.parseNumberSafe(numberStr);
    }
}

class ContextualResizer {
    constructor(presetWidths) {
        this.presetWidths = presetWidths;
    }

    increaseWidth(column) {
        const grid = column.grid;
        const desktop = grid.desktop;
        const visibleRange = desktop.getCurrentVisibleRange();
        const minWidth = column.getMinWidth();
        const maxWidth = column.getMaxWidth();

        if (!Range.contains(visibleRange, column) || column.getWidth() >= maxWidth) {
            return;
        }

        const leftVisibleColumn = grid.getLeftmostVisibleColumn(visibleRange, true);
        const rightVisibleColumn = grid.getRightmostVisibleColumn(visibleRange, true);

        if (leftVisibleColumn === null || rightVisibleColumn === null) {
            console.assert(false); // should at least see self
            return;
        }

        const leftSpace = leftVisibleColumn.getLeft() - visibleRange.getLeft();
        const rightSpace = visibleRange.getRight() - rightVisibleColumn.getRight();

        const availableExpansions = [
            column.getWidth() + leftSpace + rightSpace,
            column.getWidth() + leftSpace + rightSpace + leftVisibleColumn.getWidth() + grid.config.gapsInnerHorizontal,
            column.getWidth() + leftSpace + rightSpace + rightVisibleColumn.getWidth() + grid.config.gapsInnerHorizontal,
            ...this.presetWidths.getWidths(minWidth, maxWidth),
        ];

        const newWidth = findMinPositive(
            availableExpansions,
            width => width - column.getWidth()
        );

        if (newWidth === undefined) return;

        column.setWidth(newWidth, true);
        desktop.scrollCenterVisible(column);
    }

    decreaseWidth(column) {
        const grid = column.grid;
        const desktop = grid.desktop;
        const visibleRange = desktop.getCurrentVisibleRange();
        const minWidth = column.getMinWidth();
        const maxWidth = column.getMaxWidth();

        if (!Range.contains(visibleRange, column) || column.getWidth() <= minWidth) {
            return;
        }

        const leftVisibleColumn = grid.getLeftmostVisibleColumn(visibleRange, true);
        const rightVisibleColumn = grid.getRightmostVisibleColumn(visibleRange, true);

        if (leftVisibleColumn === null || rightVisibleColumn === null) {
            console.assert(false); // should at least see self
            return;
        }

        let leftOffScreenColumn = grid.getLeftColumn(leftVisibleColumn);
        if (leftOffScreenColumn === column) leftOffScreenColumn = null;

        let rightOffScreenColumn = grid.getRightColumn(rightVisibleColumn);
        if (rightOffScreenColumn === column) rightOffScreenColumn = null;

        const visibleColumnsWidth = rightVisibleColumn.getRight() - leftVisibleColumn.getLeft();
        const unusedWidth = visibleRange.getWidth() - visibleColumnsWidth;

        const leftOffScreen = leftOffScreenColumn === null
            ? 0
            : leftOffScreenColumn.getWidth() + grid.config.gapsInnerHorizontal - unusedWidth;

        const rightOffScreen = rightOffScreenColumn === null
            ? 0
            : rightOffScreenColumn.getWidth() + grid.config.gapsInnerHorizontal - unusedWidth;

        const availableReductions = [
            column.getWidth() - leftOffScreen,
            column.getWidth() - rightOffScreen,
            ...this.presetWidths.getWidths(minWidth, maxWidth),
        ];

        const newWidth = findMinPositive(
            availableReductions,
            width => column.getWidth() - width
        );

        if (newWidth === undefined) return;

        column.setWidth(newWidth, true);
        desktop.scrollCenterVisible(column);
    }
}

class RawResizer {
    constructor(presetWidths) {
        this.presetWidths = presetWidths;
    }

    increaseWidth(column) {
        const candidateWidths = this.presetWidths.getWidths(
            column.getMinWidth(),
            column.getMaxWidth()
        );

        const newWidth = findMinPositive(
            candidateWidths,
            width => width - column.getWidth()
        );

        if (newWidth === undefined) return;

        column.setWidth(newWidth, true);
    }

    decreaseWidth(column) {
        const candidateWidths = this.presetWidths.getWidths(
            column.getMinWidth(),
            column.getMaxWidth()
        );

        const newWidth = findMinPositive(
            candidateWidths,
            width => column.getWidth() - width
        );

        if (newWidth === undefined) return;

        column.setWidth(newWidth, true);
    }
}

class CenterClamper {
    clampScrollX(desktop, x) {
        const firstColumn = desktop.grid.getFirstColumn();
        if (firstColumn === null) return 0;

        const lastColumn = desktop.grid.getLastColumn();
        const minScroll = Math.round((firstColumn.getWidth() - desktop.tilingArea.width) / 2);
        const maxScroll = Math.round(
            desktop.grid.getWidth() - (desktop.tilingArea.width + lastColumn.getWidth()) / 2
        );

        return clamp(x, minScroll, maxScroll);
    }
}

class EdgeClamper {
    clampScrollX(desktop, x) {
        const minScroll = 0;
        const maxScroll = desktop.grid.getWidth() - desktop.tilingArea.width;

        if (maxScroll < 0) {
            return Math.round(maxScroll / 2);
        }

        return clamp(x, minScroll, maxScroll);
    }
}

class CenteredScroller {
    scrollToColumn(desktop, column) {
        desktop.scrollCenterRange(column);
    }
}

class GroupedScroller {
    scrollToColumn(desktop, column) {
        desktop.scrollCenterVisible(column);
    }
}

class LazyScroller {
    scrollToColumn(desktop, column) {
        desktop.scrollIntoView(column);
    }
}

const defaultWindowRules = `[
    {
        "class": "(org\\\\.kde\\\\.)?plasmashell",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?polkit-kde-authentication-agent-1",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?kded6",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?kcalc",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?kfind",
        "tile": true
    },
    {
        "class": "(org\\\\.kde\\\\.)?kruler",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?krunner",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?yakuake",
        "tile": false
    },
    {
        "class": "steam",
        "caption": "Steam Big Picture Mode",
        "tile": false
    },
    {
        "class": "zoom",
        "caption": "Zoom Cloud Meetings|zoom|zoom <2>",
        "tile": false
    },
    {
        "class": "jetbrains-.*",
        "caption": "splash",
        "tile": false
    },
    {
        "class": "jetbrains-.*",
        "caption": "Unstash Changes|Paths Affected by stash@.*",
        "tile": true
    }
]`;

const configDef = [
    {
        name: "gapsOuterTop",
        type: "UInt",
        default: 16,
    },
    {
        name: "gapsOuterBottom",
        type: "UInt",
        default: 16,
    },
    {
        name: "gapsOuterLeft",
        type: "UInt",
        default: 16,
    },
    {
        name: "gapsOuterRight",
        type: "UInt",
        default: 16,
    },
    {
        name: "gapsInnerHorizontal",
        type: "UInt",
        default: 8,
    },
    {
        name: "gapsInnerVertical",
        type: "UInt",
        default: 8,
    },
    {
        name: "stackOffsetX",
        type: "UInt",
        default: 8,
    },
    {
        name: "stackOffsetY",
        type: "UInt",
        default: 32,
    },
    {
        name: "manualScrollStep",
        type: "UInt",
        default: 200,
    },
    {
        name: "presetWidths",
        type: "String",
        default: "50%, 100%",
    },
    {
        name: "offScreenOpacity",
        type: "UInt",
        default: 100,
    },
    {
        name: "untileOnDrag",
        type: "Bool",
        default: true,
    },
    {
        name: "stackColumnsByDefault",
        type: "Bool",
        default: false,
    },
    {
        name: "resizeNeighborColumn",
        type: "Bool",
        default: false,
    },
    {
        name: "reMaximize",
        type: "Bool",
        default: false,
    },
    {
        name: "skipSwitcher",
        type: "Bool",
        default: false,
    },
    {
        name: "scrollingLazy",
        type: "Bool",
        default: true,
    },
    {
        name: "scrollingCentered",
        type: "Bool",
        default: false,
    },
    {
        name: "scrollingGrouped",
        type: "Bool",
        default: false,
    },
    {
        name: "gestureScroll",
        type: "Bool",
        default: false,
    },
    {
        name: "gestureScrollInvert",
        type: "Bool",
        default: false,
    },
    {
        name: "gestureScrollStep",
        type: "UInt",
        default: 1920,
    },
    {
        name: "tiledKeepBelow",
        type: "Bool",
        default: true,
    },
    {
        name: "floatingKeepAbove",
        type: "Bool",
        default: false,
    },
    {
        name: "noLayering",
        type: "Bool",
        default: false,
    },
    {
        name: "windowRules",
        type: "String",
        default: defaultWindowRules,
    },
    {
        name: "tiledDesktops",
        type: "String",
        default: ".*",
    },
];

class Actions {
    constructor(config) {
        this.config = config;
        this._initFocusActions();
        this._initWindowMoveActions();
        this._initColumnActions();
        this._initWidthActions();
        this._initGridScrollActions();
        this._initDesktopActions();
        this._initIndexedActions();
    }

    // Инициализация действий для управления фокусом
    _initFocusActions() {
        this.focusLeft = (cm, dm, window, column, grid) => {
            const leftColumn = grid.getLeftColumn(column);
            if (leftColumn === null) return;
            leftColumn.getWindowToFocus().focus();
        };

        this.focusRight = (cm, dm, window, column, grid) => {
            const rightColumn = grid.getRightColumn(column);
            if (rightColumn === null) return;
            rightColumn.getWindowToFocus().focus();
        };

        this.focusUp = (cm, dm, window, column, grid) => {
            const aboveWindow = column.getAboveWindow(window);
            if (aboveWindow === null) return;
            aboveWindow.focus();
        };

        this.focusDown = (cm, dm, window, column, grid) => {
            const belowWindow = column.getBelowWindow(window);
            if (belowWindow === null) return;
            belowWindow.focus();
        };

        this.focusNext = (cm, dm, window, column, grid) => {
            const belowWindow = column.getBelowWindow(window);
            if (belowWindow !== null) {
                belowWindow.focus();
                return;
            }

            const rightColumn = grid.getRightColumn(column);
            if (rightColumn === null) return;
            rightColumn.getFirstWindow().focus();
        };

        this.focusPrevious = (cm, dm, window, column, grid) => {
            const aboveWindow = column.getAboveWindow(window);
            if (aboveWindow !== null) {
                aboveWindow.focus();
                return;
            }

            const leftColumn = grid.getLeftColumn(column);
            if (leftColumn === null) return;
            leftColumn.getLastWindow().focus();
        };

        this.focusStart = (cm, dm) => {
            this._withCurrentDesktopGrid(dm, (desktop, grid) => {
                const firstColumn = grid.getFirstColumn();
                if (firstColumn === null) return;
                firstColumn.getWindowToFocus().focus();
            });
        };

        this.focusEnd = (cm, dm) => {
            this._withCurrentDesktopGrid(dm, (desktop, grid) => {
                const lastColumn = grid.getLastColumn();
                if (lastColumn === null) return;
                lastColumn.getWindowToFocus().focus();
            });
        };
    }

    // Инициализация действий для перемещения окон
    _initWindowMoveActions() {
        this.windowMoveLeft = (cm, dm, window, column, grid) => {
            if (column.getWindowCount() === 1) {
                const leftColumn = grid.getLeftColumn(column);
                if (leftColumn === null) return;
                window.moveToColumn(leftColumn, true, 0 /* FocusPassing.Type.None */);
                grid.desktop.autoAdjustScroll();
            } else {
                const newColumn = new Column(grid, grid.getLeftColumn(column));
                window.moveToColumn(newColumn, true, 0 /* FocusPassing.Type.None */);
            }
        };

        this.windowMoveRight = (cm, dm, window, column, grid, bottom = true) => {
            if (column.getWindowCount() === 1) {
                const rightColumn = grid.getRightColumn(column);
                if (rightColumn === null) return;
                window.moveToColumn(rightColumn, bottom, 0 /* FocusPassing.Type.None */);
                grid.desktop.autoAdjustScroll();
            } else {
                const newColumn = new Column(grid, column);
                window.moveToColumn(newColumn, true, 0 /* FocusPassing.Type.None */);
            }
        };

        this.windowMoveUp = (cm, dm, window, column, grid) => {
            column.moveWindowUp(window);
        };

        this.windowMoveDown = (cm, dm, window, column, grid) => {
            column.moveWindowDown(window);
        };

        this.windowMoveNext = (cm, dm, window, column, grid) => {
            const canMoveDown = window !== column.getLastWindow();
            if (canMoveDown) {
                column.moveWindowDown(window);
            } else {
                this.windowMoveRight(cm, dm, window, column, grid, false);
            }
        };

        this.windowMovePrevious = (cm, dm, window, column, grid) => {
            const canMoveUp = window !== column.getFirstWindow();
            if (canMoveUp) {
                column.moveWindowUp(window);
            } else {
                this.windowMoveLeft(cm, dm, window, column, grid);
            }
        };

        this.windowMoveStart = (cm, dm, window, column, grid) => {
            const newColumn = new Column(grid, null);
            window.moveToColumn(newColumn, true, 0 /* FocusPassing.Type.None */);
        };

        this.windowMoveEnd = (cm, dm, window, column, grid) => {
            const newColumn = new Column(grid, grid.getLastColumn());
            window.moveToColumn(newColumn, true, 0 /* FocusPassing.Type.None */);
        };

        this.windowToggleFloating = (cm, dm) => {
            if (Workspace.activeWindow === null) return;
            cm.toggleFloatingClient(Workspace.activeWindow);
        };
    }

    // Инициализация действий с колонками
    _initColumnActions() {
        this.columnMoveLeft = (cm, dm, window, column, grid) => {
            grid.moveColumnLeft(column);
        };

        this.columnMoveRight = (cm, dm, window, column, grid) => {
            grid.moveColumnRight(column);
        };

        this.columnMoveStart = (cm, dm, window, column, grid) => {
            grid.moveColumn(column, null);
        };

        this.columnMoveEnd = (cm, dm, window, column, grid) => {
            grid.moveColumn(column, grid.getLastColumn());
        };

        this.columnToggleStacked = (cm, dm, window, column, grid) => {
            column.toggleStacked();
        };
    }

    // Инициализация действий для изменения ширины колонок
    _initWidthActions() {
        this.columnWidthIncrease = (cm, dm, window, column, grid) => {
            this.config.columnResizer.increaseWidth(column);
        };

        this.columnWidthDecrease = (cm, dm, window, column, grid) => {
            this.config.columnResizer.decreaseWidth(column);
        };

        this.cyclePresetWidths = (cm, dm, window, column, grid) => {
            const nextWidth = this.config.presetWidths.next(
                column.getWidth(),
                column.getMinWidth(),
                column.getMaxWidth()
            );
            column.setWidth(nextWidth, true);
        };

        this.cyclePresetWidthsReverse = (cm, dm, window, column, grid) => {
            const nextWidth = this.config.presetWidths.prev(
                column.getWidth(),
                column.getMinWidth(),
                column.getMaxWidth()
            );
            column.setWidth(nextWidth, true);
        };

        this.columnsWidthEqualize = (cm, dm) => {
            this._withCurrentDesktopGrid(dm, (desktop, grid) => {
                const visibleRange = desktop.getCurrentVisibleRange();
                const visibleColumns = Array.from(grid.getVisibleColumns(visibleRange, true));
                const availableSpace = desktop.tilingArea.width;
                const gapsWidth = grid.config.gapsInnerHorizontal * (visibleColumns.length - 1);

                const widths = fillSpace(
                    availableSpace - gapsWidth,
                    visibleColumns.map(column => ({
                        min: column.getMinWidth(),
                        max: column.getMaxWidth()
                    }))
                );

                visibleColumns.forEach((column, index) => column.setWidth(widths[index], true));
                desktop.scrollCenterRange(Range.fromRanges(
                    visibleColumns[0],
                    visibleColumns[visibleColumns.length - 1]
                ));
            });
        };

        this.columnsSqueezeLeft = (cm, dm, window, focusedColumn, grid) => {
            this._squeezeColumnsInDirection(dm, focusedColumn, grid, 'left');
        };

        this.columnsSqueezeRight = (cm, dm, window, focusedColumn, grid) => {
            this._squeezeColumnsInDirection(dm, focusedColumn, grid, 'right');
        };
    }

    // Инициализация действий для прокрутки сетки окон
    _initGridScrollActions() {
        this.gridScrollLeft = (cm, dm) => {
            this._gridScroll(dm, -this.config.manualScrollStep);
        };

        this.gridScrollRight = (cm, dm) => {
            this._gridScroll(dm, this.config.manualScrollStep);
        };

        this.gridScrollStart = (cm, dm) => {
            this._withCurrentDesktopGrid(dm, (desktop, grid) => {
                const firstColumn = grid.getFirstColumn();
                if (firstColumn === null) return;
                grid.desktop.scrollToColumn(firstColumn, false);
            });
        };

        this.gridScrollEnd = (cm, dm) => {
            this._withCurrentDesktopGrid(dm, (desktop, grid) => {
                const lastColumn = grid.getLastColumn();
                if (lastColumn === null) return;
                grid.desktop.scrollToColumn(lastColumn, false);
            });
        };

        this.gridScrollFocused = (cm, dm, window, column, grid) => {
            const scrollAmount = Range.minus(column, grid.desktop.getCurrentVisibleRange());
            if (scrollAmount !== 0) {
                grid.desktop.adjustScroll(scrollAmount, true);
            } else {
                grid.desktop.scrollToColumn(column, true);
            }
        };

        this.gridScrollLeftColumn = (cm, dm) => {
            this._withCurrentDesktopGrid(dm, (desktop, grid) => {
                const column = grid.getLeftmostVisibleColumn(desktop.getCurrentVisibleRange(), true);
                if (column === null) return;

                const leftColumn = grid.getLeftColumn(column);
                if (leftColumn === null) return;

                grid.desktop.scrollToColumn(leftColumn, false);
            });
        };

        this.gridScrollRightColumn = (cm, dm) => {
            this._withCurrentDesktopGrid(dm, (desktop, grid) => {
                const column = grid.getRightmostVisibleColumn(desktop.getCurrentVisibleRange(), true);
                if (column === null) return;

                const rightColumn = grid.getRightColumn(column);
                if (rightColumn === null) return;

                grid.desktop.scrollToColumn(rightColumn, false);
            });
        };
    }

    // Инициализация действий с рабочими столами
    _initDesktopActions() {
        this.screenSwitch = (cm, dm) => {
            dm.selectScreen(Workspace.activeScreen);
        };

        this.columnMoveToDesktop = (desktopIndex, cm, dm, window, column, oldGrid) => {
            this._moveColumnOrTailToDesktop(desktopIndex, dm, column, oldGrid, false);
        };

        this.tailMoveToDesktop = (desktopIndex, cm, dm, window, column, oldGrid) => {
            this._moveColumnOrTailToDesktop(desktopIndex, dm, column, oldGrid, true);
        };
    }

    // Инициализация действий с индексами (горячие клавиши для колонок 1-9)
    _initIndexedActions() {
        this.focus = (columnIndex, cm, dm) => {
            this._withCurrentDesktopGrid(dm, (desktop, grid) => {
                const targetColumn = grid.getColumnAtIndex(columnIndex);
                if (targetColumn === null) return;
                targetColumn.getWindowToFocus().focus();
            });
        };

        this.windowMoveToColumn = (columnIndex, cm, dm, window, column, grid) => {
            const targetColumn = grid.getColumnAtIndex(columnIndex);
            if (targetColumn === null) return;

            window.moveToColumn(targetColumn, true, 0 /* FocusPassing.Type.None */);
            grid.desktop.autoAdjustScroll();
        };

        this.columnMoveToColumn = (columnIndex, cm, dm, window, column, grid) => {
            const targetColumn = grid.getColumnAtIndex(columnIndex);
            if (targetColumn === null || targetColumn === column) return;

            if (targetColumn.isToTheRightOf(column)) {
                grid.moveColumn(column, targetColumn);
            } else {
                grid.moveColumn(column, grid.getLeftColumn(targetColumn));
            }
        };
    }

    // Вспомогательные методы для действий
    _withCurrentDesktopGrid(dm, callback) {
        const desktop = dm.getCurrentDesktop();
        if (desktop === undefined) return;
        callback(desktop, desktop.grid);
    }

    _gridScroll(desktopManager, amount) {
        const desktop = desktopManager.getCurrentDesktop();
        if (desktop !== undefined) {
            desktop.adjustScroll(amount, false);
        }
    }

    _squeezeColumnsInDirection(dm, focusedColumn, grid, direction) {
        const visibleRange = grid.desktop.getCurrentVisibleRange();
        if (!Range.contains(visibleRange, focusedColumn)) return;

        const currentVisibleColumns = Array.from(grid.getVisibleColumns(visibleRange, true));
        console.assert(
            currentVisibleColumns.includes(focusedColumn),
            "должна содержать хотя бы сфокусированную колонку"
        );

        let targetColumn, wantedVisibleColumns;

        if (direction === 'left') {
            targetColumn = grid.getLeftColumn(currentVisibleColumns[0]);
            if (targetColumn === null) return;
            wantedVisibleColumns = [targetColumn, ...currentVisibleColumns];
        } else { // 'right'
            targetColumn = grid.getRightColumn(currentVisibleColumns[currentVisibleColumns.length - 1]);
            if (targetColumn === null) return;
            wantedVisibleColumns = [...currentVisibleColumns, targetColumn];
        }

        while (true) {
            const success = this._squeezeColumns(wantedVisibleColumns);
            if (success) break;

            const removedColumn = direction === 'left'
                ? wantedVisibleColumns.pop()
                : wantedVisibleColumns.shift();

            if (removedColumn === focusedColumn) break; // не прокручивать дальше фокусированной колонки
        }
    }

    _squeezeColumns(columns) {
        const firstColumn = columns[0];
        const lastColumn = columns[columns.length - 1];
        const grid = firstColumn.grid;
        const desktop = grid.desktop;
        const availableSpace = desktop.tilingArea.width;
        const gapsWidth = grid.config.gapsInnerHorizontal * (columns.length - 1);

        const columnConstraints = columns.map(column => ({
            min: column.getMinWidth(),
            max: column.getWidth()
        }));

        const minTotalWidth = gapsWidth + columnConstraints.reduce((acc, constraint) =>
            acc + constraint.min, 0
        );

        if (minTotalWidth > availableSpace) {
            return false; // there's nothing we can do
        }

        const widths = fillSpace(availableSpace - gapsWidth, columnConstraints);
        columns.forEach((column, index) => column.setWidth(widths[index], true));

        desktop.scrollCenterRange(Range.fromRanges(firstColumn, lastColumn));
        return true;
    }

    _moveColumnOrTailToDesktop(desktopIndex, dm, column, oldGrid, evacuateTail) {
        const kwinDesktop = Workspace.desktops[desktopIndex];
        if (kwinDesktop === undefined) return;

        const newDesktop = dm.getDesktopInCurrentActivity(kwinDesktop);
        if (newDesktop === undefined) return;

        const newGrid = newDesktop.grid;
        if (newGrid === null || newGrid === oldGrid) return;

        if (evacuateTail) {
            oldGrid.evacuateTail(newGrid, column);
        } else {
            column.moveToGrid(newGrid, newGrid.getLastColumn());
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
            description: "Move Rkarousel grid to the current screen",
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

function registerKeyBinding(shortcutActions, keyBinding) {
    const wrappedAction = catchWrap(keyBinding.action);
    const shortcutAction = new ShortcutAction(keyBinding, wrappedAction);
    shortcutActions.push(shortcutAction);
}

function registerNumKeyBindings(shortcutActions, numKeyBinding) {
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
        }, actionWrapper);

        shortcutActions.push(shortcutAction);
    }
}

function registerKeyBindings(world, config) {
    const actions = new Actions(config);
    const shortcutActions = [];

    const keyBindings = getKeyBindings(world, actions);
    const numKeyBindings = getNumKeyBindings(world, actions);

    for (const keyBinding of keyBindings) {
        registerKeyBinding(shortcutActions, keyBinding);
    }

    for (const numKeyBinding of numKeyBindings) {
        registerNumKeyBindings(shortcutActions, numKeyBinding);
    }

    return shortcutActions;
}

class Column {
    constructor(grid, leftColumn) {
        this.gridX = 0;
        this.width = 0;
        this.windows = new LinkedList();
        this.stacked = grid.config.stackColumnsByDefault;
        this.focusTaker = null;
        this.grid = grid;

        this.grid.onColumnAdded(this, leftColumn);
    }

    moveToGrid(targetGrid, leftColumn) {
        if (targetGrid === this.grid) {
            this.grid.moveColumn(this, leftColumn);
            return;
        }

        const focusPassing = this.isFocused()
            ? FocusPassing.Type.Immediate
            : FocusPassing.Type.None;

        this.grid.onColumnRemoved(this, focusPassing);
        this.grid = targetGrid;

        targetGrid.onColumnAdded(this, leftColumn);

        for (const window of this.windows.iterator()) {
            window.client.kwinClient.desktops = [targetGrid.desktop.kwinDesktop];
        }
    }

    isToTheLeftOf(other) {
        return this.gridX < other.gridX;
    }

    isToTheRightOf(other) {
        return this.gridX > other.gridX;
    }

    moveWindowUp(window) {
        this.windows.moveBack(window);
        this.grid.desktop.onLayoutChanged();
    }

    moveWindowDown(window) {
        this.windows.moveForward(window);
        this.grid.desktop.onLayoutChanged();
    }

    getWindowCount() {
        return this.windows.length();
    }

    isEmpty() {
        return this.getWindowCount() === 0;
    }

    getFirstWindow() {
        return this.windows.getFirst();
    }

    getLastWindow() {
        return this.windows.getLast();
    }

    getAboveWindow(window) {
        return this.windows.getPrev(window);
    }

    getBelowWindow(window) {
        return this.windows.getNext(window);
    }

    getWidth() {
        return this.width;
    }

    getMinWidth() {
        const { minWidth } = Column;
        let maxMinWidth = minWidth;

        for (const window of this.windows.iterator()) {
            const windowMinWidth = window.client.kwinClient.minSize.width;
            if (windowMinWidth > maxMinWidth) {
                maxMinWidth = windowMinWidth;
            }
        }

        return maxMinWidth;
    }

    getMaxWidth() {
        return this.grid.desktop.tilingArea.width;
    }

    setWidth(width, setPreferred = false) {
        const clampedWidth = clamp(
            width,
            this.getMinWidth(),
            this.getMaxWidth()
        );

        if (clampedWidth === this.width) {
            return;
        }

        this.width = clampedWidth;

        if (setPreferred) {
            for (const window of this.windows.iterator()) {
                window.client.preferredWidth = clampedWidth;
            }
        }

        this.grid.onColumnWidthChanged(this);
    }

    adjustWidth(widthDelta, setPreferred = false) {
        this.setWidth(this.width + widthDelta, setPreferred);
    }

    updateWidth() {
        let minError = Infinity;
        let closestPreferredWidth = this.width;

        for (const window of this.windows.iterator()) {
            const error = Math.abs(window.client.preferredWidth - this.width);

            if (error < minError) {
                minError = error;
                closestPreferredWidth = window.client.preferredWidth;
            }
        }

        this.setWidth(closestPreferredWidth, false);
    }

    getLeft() {
        return this.gridX;
    }

    getRight() {
        return this.gridX + this.width;
    }

    onUserResizeWidth(startWidth, currentDelta, resizingLeftSide, neighbor) {
        const oldColumnWidth = this.getWidth();

        this.setWidth(startWidth + currentDelta, true);

        const actualDelta = this.getWidth() - startWidth;
        let leftEdgeDeltaStep = resizingLeftSide
            ? oldColumnWidth - this.getWidth()
            : 0;

        if (neighbor !== undefined) {
            const oldNeighborWidth = neighbor.column.getWidth();
            neighbor.column.setWidth(neighbor.startWidth - actualDelta, true);

            if (resizingLeftSide) {
                leftEdgeDeltaStep -= neighbor.column.getWidth() - oldNeighborWidth;
            }
        }

        this.grid.desktop.adjustScroll(-leftEdgeDeltaStep, true);
    }

    adjustWindowHeight(window, heightDelta, top) {
        const otherWindow = top
            ? this.windows.getPrev(window)
            : this.windows.getNext(window);

        if (otherWindow === null) {
            return;
        }

        window.height += heightDelta;
        otherWindow.height -= heightDelta;

        this.grid.desktop.onLayoutChanged();
    }

    resizeWindows() {
        const windowCount = this.windows.length();

        if (windowCount === 0) {
            return;
        }

        // Если окно одно, проверяем, нужно ли его стакать
        if (windowCount === 1) {
            this.stacked = this.grid.config.stackColumnsByDefault;
        }

        const { gapsInnerVertical } = this.grid.config;
        const totalHeight = this.grid.desktop.tilingArea.height;

        // Рассчитаем доступное пространство по вертикали
        const availableSpace = totalHeight - (windowCount - 1) * gapsInnerVertical;

        // Формируем массив ограничений для функции fillSpace
        const constraints = [];
        const windowsList = [];

        // Итерируемся по окнам в этой колонке
        for (const window of this.windows.iterator()) {
            // Получаем минимальную высоту, которую требует само окно
            const minHeight = window.client.kwinClient.minSize.height;

            constraints.push({
                // Если minHeight не задан или 0, ставим хотя бы 1 пиксель
                min: minHeight > 0 ? minHeight : 1,
                // Максимальная высота окна не может превышать доступное пространство
                max: availableSpace
            });
            windowsList.push(window);
        }

        // Используем функцию fillSpace для распределения пространства
        const heights = fillSpace(availableSpace, constraints);

        // Применяем рассчитанные высоты к окнам
        windowsList.forEach((window, index) => {
            window.height = heights[index];
        });

        // Сообщаем десктопу об изменении раскладки
        this.grid.desktop.onLayoutChanged();
    }

    getFocusTaker() {
        if (this.focusTaker === null || !this.windows.contains(this.focusTaker)) {
            return null;
        }
        return this.focusTaker;
    }

    getWindowToFocus() {
        return this.getFocusTaker() ?? this.windows.getFirst();
    }

    isFocused() {
        const lastFocusedWindow = this.grid.getLastFocusedWindow();

        if (lastFocusedWindow === null) {
            return false;
        }

        return lastFocusedWindow.column === this && lastFocusedWindow.isFocused();
    }

    arrange(x, visibleRange, forceOpaque = false) {
        const { config } = this.grid;

        if (config.offScreenOpacity < 1.0 && !forceOpaque) {
            const opacity = Range.contains(visibleRange, this)
                ? 100
                : config.offScreenOpacity;

            for (const window of this.windows.iterator()) {
                window.client.kwinClient.opacity = opacity;
            }
        }

        if (this.stacked && this.windows.length() >= 2) {
            this.arrangeStacked(x);
            return;
        }

        let y = this.grid.desktop.tilingArea.y;

        for (const window of this.windows.iterator()) {
            window.arrange(x, y, this.width, window.height);
            y += window.height + config.gapsInnerVertical;
        }
    }

    arrangeStacked(x) {
        const { stackOffsetX, stackOffsetY } = this.grid.config;
        const { tilingArea } = this.grid.desktop;
        const windowCount = this.windows.length();

        const windowWidth = this.width - (windowCount - 1) * stackOffsetX;
        const windowHeight = tilingArea.height - (windowCount - 1) * stackOffsetY;

        let windowX = x;
        let windowY = tilingArea.y;

        for (const window of this.windows.iterator()) {
            window.arrange(windowX, windowY, windowWidth, windowHeight);

            windowX += stackOffsetX;
            windowY += stackOffsetY;
        }
    }

    toggleStacked() {
        if (this.windows.length() < 2) {
            return;
        }

        this.stacked = !this.stacked;
        this.grid.desktop.onLayoutChanged();
    }

    onWindowAdded(window, bottom = true) {
        if (bottom) {
            this.windows.insertEnd(window);
        } else {
            this.windows.insertStart(window);
        }

        if (this.width === 0) {
            this.setWidth(window.client.preferredWidth, false);
        }

        // TODO: also change column width if the new window requires it
        this.resizeWindows();

        if (window.isFocused()) {
            this.onWindowFocused(window);
        }

        this.grid.desktop.onLayoutChanged();
    }

    onWindowRemoved(window, passFocus) {
        const wasLastWindow = this.windows.length() === 1;
        const windowToFocus = this.getAboveWindow(window) ?? this.getBelowWindow(window);

        this.windows.remove(window);

        if (window === this.focusTaker) {
            this.focusTaker = windowToFocus;
        }

        if (wasLastWindow) {
            console.assert(this.isEmpty());
            this.destroy(passFocus);
        } else {
            this.resizeWindows();

            if (windowToFocus !== null) {
                switch (passFocus) {
                    case FocusPassing.Type.Immediate:
                        windowToFocus.focus();
                        break;

                    case FocusPassing.Type.OnUnfocus:
                        this.grid.focusPasser.request(windowToFocus.client.kwinClient);
                        break;
                }
            }
        }

        this.grid.desktop.onLayoutChanged();
    }

    onWindowFocused(window) {
        this.grid.onColumnFocused(this, window);
        this.focusTaker = window;
    }

    restoreToTiled(focusedWindow) {
        const lastFocusedWindow = this.getFocusTaker();

        if (lastFocusedWindow !== null && lastFocusedWindow !== focusedWindow) {
            lastFocusedWindow.restoreToTiled();
        }
    }

    destroy(passFocus) {
        this.grid.onColumnRemoved(this, passFocus);
    }
}
Column.minWidth = 40;

class Desktop {
    constructor(kwinDesktop, pinManager, config, getScreen, layoutConfig, focusPasser) {
        // Инициализация состояния прокрутки
        this.scrollX = 0;
        this.gestureScrollXInitial = null;

        this.dirty = true;
        this.dirtyScroll = true;
        this.dirtyPins = true;

        // Основная инициализация
        this.kwinDesktop = kwinDesktop;
        this.pinManager = pinManager;
        this.config = config;
        this.getScreen = getScreen;

        this.grid = new Grid(this, layoutConfig, focusPasser);
        this.clientArea = Desktop.getClientArea(this.getScreen(), kwinDesktop);
        this.tilingArea = Desktop.getTilingArea(this.clientArea, kwinDesktop, pinManager, config);
    }

    // Методы для работы с геометрией и областями экрана

    updateArea() {
        const newClientArea = Desktop.getClientArea(this.getScreen(), this.kwinDesktop);

        if (rectEquals(newClientArea, this.clientArea) && !this.dirtyPins) {
            return;
        }

        this.clientArea = newClientArea;
        this.tilingArea = Desktop.getTilingArea(newClientArea, this.kwinDesktop, this.pinManager, this.config);

        this.dirty = true;
        this.dirtyScroll = true;
        this.dirtyPins = false;

        this.grid.onScreenSizeChanged();
        this.autoAdjustScroll();
    }

    static getClientArea(screen, kwinDesktop) {
        return Workspace.clientArea(0 /* ClientAreaOption.PlacementArea */, screen, kwinDesktop);
    }

    static getTilingArea(clientArea, kwinDesktop, pinManager, config) {
        const availableSpace = pinManager.getAvailableSpace(kwinDesktop, clientArea);
        const top = availableSpace.top + config.marginTop;
        const bottom = availableSpace.bottom - config.marginBottom;
        const left = availableSpace.left + config.marginLeft;
        const right = availableSpace.right - config.marginRight;
        return Qt.rect(left, top, right - left, bottom - top);
    }

    getVisibleRange(scrollX) {
        return Range.create(scrollX, this.tilingArea.width);
    }

    getCurrentVisibleRange() {
        return this.getVisibleRange(this.scrollX);
    }

    // Методы для управления прокруткой

    scrollIntoView(range) {
        const left = range.getLeft();
        const right = range.getRight();
        const initialVisibleRange = this.getCurrentVisibleRange();
        let targetScrollX;

        if (left < initialVisibleRange.getLeft()) {
            targetScrollX = left;
        } else if (right > initialVisibleRange.getRight()) {
            targetScrollX = right - this.tilingArea.width;
        } else {
            targetScrollX = initialVisibleRange.getLeft();
        }
        this.setScroll(targetScrollX, false);
    }

    scrollCenterRange(range) {
        const scrollAmount = Range.minus(range, this.getCurrentVisibleRange());
        this.adjustScroll(scrollAmount, true);
    }

    scrollCenterVisible(focusedColumn) {
        const columnRange = new ColumnRange(focusedColumn);
        columnRange.addNeighbors(this.getCurrentVisibleRange(), this.grid.config.gapsInnerHorizontal);
        this.scrollCenterRange(columnRange);
    }

    autoAdjustScroll() {
        const focusedColumn = this.grid.getLastFocusedColumn();
        if (focusedColumn === null || focusedColumn.grid !== this.grid) {
            return;
        }
        this.scrollToColumn(focusedColumn, false);
    }

    scrollToColumn(column, force) {
        if (force || this.dirtyScroll || !Range.contains(this.getCurrentVisibleRange(), column)) {
            this.config.scroller.scrollToColumn(this, column);
        }
    }

    clampScrollX(x) {
        return this.config.clamper.clampScrollX(this, x);
    }

    setScroll(x, force) {
        const oldScrollX = this.scrollX;
        this.scrollX = force ? x : this.clampScrollX(x);
        if (this.scrollX !== oldScrollX) {
            this.onLayoutChanged();
        }
        this.dirtyScroll = false;
    }

    adjustScroll(dx, force) {
        this.setScroll(this.scrollX + dx, force);
    }

    // Методы для жестов (touch/trackpad)

    gestureScroll(amount) {
        if (!this.config.gestureScroll) return;

        if (this.gestureScrollXInitial === null) {
            this.gestureScrollXInitial = this.scrollX;
        }
        if (this.config.gestureScrollInvert) {
            amount = -amount;
        }
        this.setScroll(this.gestureScrollXInitial + this.config.gestureScrollStep * amount, false);
    }

    gestureScrollFinish() {
        this.gestureScrollXInitial = null;
    }

    // Методы для рендеринга и управления жизненным циклом

    arrange() {
        // обновляем только если что-то изменилось
        this.updateArea();

        if (!this.dirty) {
            return;
        }

        const x = this.tilingArea.x - this.scrollX;
        // Grid.arrange отфильтрует невидимые окна сам
        this.grid.arrange(x, this.getCurrentVisibleRange());
        this.dirty = false;
    }

    forceArrange() {
        this.dirty = true;
    }

    onLayoutChanged() {
        this.dirty = true;
        this.dirtyScroll = true;
    }

    onPinsChanged() {
        this.dirty = true;
        this.dirtyScroll = true;
        this.dirtyPins = true;
    }

    destroy() {
        this.grid.destroy();
    }
}

class ColumnRange {
    constructor(initialColumn) {
        this.left = initialColumn;
        this.right = initialColumn;
        this.width = initialColumn.getWidth();
    }

    addNeighbors(visibleRange, gap) {
        const grid = this.left.grid;
        const range = this;

        function canFit(column) {
            return range.width + gap + column.getWidth() <= visibleRange.getWidth();
        }
        function isUsable(column) {
            return column !== null && canFit(column);
        }

        let leftColumn = grid.getLeftColumn(this.left);
        let rightColumn = grid.getRightColumn(this.right);

        function checkColumns() {
            if (!isUsable(leftColumn)) leftColumn = null;
            if (!isUsable(rightColumn)) rightColumn = null;
        }

        checkColumns();
        const visibleCenter = visibleRange.getLeft() + visibleRange.getWidth() / 2;

        while (leftColumn !== null || rightColumn !== null) {
            const leftToCenter = leftColumn === null ? Infinity : Math.abs(leftColumn.getLeft() - visibleCenter);
            const rightToCenter = rightColumn === null ? Infinity : Math.abs(rightColumn.getRight() - visibleCenter);

            if (leftToCenter < rightToCenter) {
                this.addLeft(leftColumn, gap);
                leftColumn = grid.getLeftColumn(leftColumn);
            } else {
                this.addRight(rightColumn, gap);
                rightColumn = grid.getRightColumn(rightColumn);
            }
            checkColumns();
        }
    }

    addLeft(column, gap) {
        this.left = column;
        this.width += column.getWidth() + gap;
    }

    addRight(column, gap) {
        this.right = column;
        this.width += column.getWidth() + gap;
    }

    getLeft() {
        return this.left.getLeft();
    }

    getRight() {
        return this.right.getRight();
    }

    getWidth() {
        return this.width;
    }
}
// Привязка для обратной совместимости
Desktop.ColumnRange = ColumnRange;

// ============================================================================
// Сетка окон (управление колонками, рендеринг, фокус)
// ============================================================================

class Grid {
    constructor(desktop, config, focusPasser) {
        // Зависимости
        this.desktop = desktop;
        this.config = config;
        this.focusPasser = focusPasser;

        // Состояние
        this.columns = new LinkedList();
        this.lastFocusedColumn = null;
        this.width = 0; // Общая ширина всех колонок, включая отступы

        // Состояние взаимодействия пользователя
        this.userResize = false;
        // Delayer предотвращает зависание UI после частых событий
        this.userResizeFinishedDelayer = new Delayer(50, () => {
            this.desktop.onLayoutChanged();
            this.desktop.autoAdjustScroll();
            this.desktop.arrange();
        });
    }

    // Управление жизненным циклом
    destroy() {
        this.userResizeFinishedDelayer.destroy();
    }

    // Управление колонками (перемещение и порядок)
    /**
     * Перемещает колонку на определенную позицию относительно другой.
     * @param {Column} column - Перемещаемая колонка
     * @param {Column|null} leftColumn - Колонка, после которой поместить 'column'. Если null, помещается в начало
     */
    moveColumn(column, leftColumn) {
        if (column === leftColumn) {
            return;
        }

        // Определяем направление для оптимизации обновления координат
        const isMovingLeft = leftColumn === null ? true : column.isToTheRightOf(leftColumn);
        const firstAffectedColumn = isMovingLeft ? column : this.getRightColumn(column);

        this.columns.move(column, leftColumn);
        this.columnsSetX(firstAffectedColumn);

        this.desktop.onLayoutChanged();
        this.desktop.autoAdjustScroll();
    }

    moveColumnLeft(column) {
        this.columns.moveBack(column);
        this.columnsSetX(column);

        this.desktop.onLayoutChanged();
        this.desktop.autoAdjustScroll();
    }

    moveColumnRight(column) {
        const rightColumn = this.columns.getNext(column);
        if (rightColumn === null) {
            return; // Уже в конце
        }
        // Смена местами вправо равносильна смене следующей колонки влево
        this.moveColumnLeft(rightColumn);
    }

    evacuateTail(targetGrid, startColumn) {
        for (const column of this.columns.iteratorFrom(startColumn)) {
            column.moveToGrid(targetGrid, targetGrid.getLastColumn());
        }
    }

    evacuate(targetGrid) {
        for (const column of this.columns.iterator()) {
            column.moveToGrid(targetGrid, targetGrid.getLastColumn());
        }
    }

    // Геттеры и навигация по колонкам
    getWidth() {
        return this.width;
    }

    isUserResizing() {
        return this.userResize;
    }

    getLeftColumn(column) {
        return this.columns.getPrev(column);
    }

    getRightColumn(column) {
        return this.columns.getNext(column);
    }

    getFirstColumn() {
        return this.columns.getFirst();
    }

    getLastColumn() {
        return this.columns.getLast();
    }

    getColumnAtIndex(i) {
        return this.columns.getItemAtIndex(i);
    }

    // Макет и расчет геометрии
    /**
     * Пересчитывает X координату для колонок, начиная с указанной.
     * @param {Column|null} startColumn - Колонка, с которой начать пересчет
     */
    columnsSetX(startColumn) {
        // Определяем, откуда начать расчет X
        const prevColumn = startColumn === null ? this.columns.getLast() : this.columns.getPrev(startColumn);

        let currentX = 0;

        // Если есть предыдущая колонка, начинаем расчет координат после нее
        if (prevColumn !== null) {
            currentX = prevColumn.getRight() + this.config.gapsInnerHorizontal;
        }

        // Итерируемся от измененной колонки до конца списка
        if (startColumn !== null) {
            for (const column of this.columns.iteratorFrom(startColumn)) {
                column.gridX = currentX;
                currentX += column.getWidth() + this.config.gapsInnerHorizontal;
            }
        }

        // Обновляем общую ширину (вычитаем последний отступ, если колонки есть)
        this.width = currentX > 0 ? currentX - this.config.gapsInnerHorizontal : 0;
    }

    /**
     * Основной цикл рендеринга колонок.
     * @param {number} x - Текущее смещение прокрутки X
     * @param {Range} visibleRange - Видимая область экрана
     */
    arrange(x, visibleRange) {
        // Буфер помогает при плавном скролле, рендеря элементы чуть за пределами видимости
        const RENDER_BUFFER = 500;
        const viewStart = visibleRange.getLeft() - RENDER_BUFFER;
        const viewEnd = visibleRange.getRight() + RENDER_BUFFER;

        const gap = this.config.gapsInnerHorizontal;
        const lazy = this.config.scrollingLazy;

        for (const column of this.columns.iterator()) {
            const colWidth = column.getWidth();
            const colStart = x;
            const colEnd = x + colWidth;

            // Проверяем, пересекается ли колонка с видимой областью + буфером
            const isVisible = (colEnd > viewStart) && (colStart < viewEnd);

            // Рендерим, если видно, или если нужен точный расчет (ленивый режим выключен)
            if (isVisible || !lazy) {
                column.arrange(x, visibleRange, this.userResize);
            }

            x += colWidth + gap;
        }

        // Убеждаемся, что временные окна сфокусированного окна остаются видимыми
        const focusedWindow = this.getLastFocusedWindow();
        if (focusedWindow !== null) {
            focusedWindow.client.ensureTransientsVisible(this.desktop.clientArea);
        }
    }

    getLeftmostVisibleColumn(visibleRange, fullyVisible) {
        for (const column of this.columns.iterator()) {
            if (Range.contains(visibleRange, column)) {
                return column;
            }
        }
        return null;
    }

    getRightmostVisibleColumn(visibleRange, fullyVisible) {
        let lastVisible = null;
        for (const column of this.columns.iterator()) {
            if (Range.contains(visibleRange, column)) {
                lastVisible = column;
            } else if (lastVisible !== null) {
                // Мы прошли видимую область, прекращаем поиск
                break;
            }
        }
        return lastVisible;
    }

    *getVisibleColumns(visibleRange, fullyVisible) {
        for (const column of this.columns.iterator()) {
            if (Range.contains(visibleRange, column)) {
                yield column;
            }
        }
    }

    // Управление фокусом
    getLastFocusedColumn() {
        // Убеждаемся, что кешированная ссылка все еще принадлежит этому гриду
        if (this.lastFocusedColumn === null || this.lastFocusedColumn.grid !== this) {
            return null;
        }
        return this.lastFocusedColumn;
    }

    getLastFocusedWindow() {
        const lastFocusedColumn = this.getLastFocusedColumn();
        return lastFocusedColumn ? lastFocusedColumn.getFocusTaker() : null;
    }

    onColumnFocused(column, window) {
        const lastFocusedColumn = this.getLastFocusedColumn();

        // Восстанавливаем предыдущее окно из максимизации/полного экрана, если нужно
        if (lastFocusedColumn !== null) {
            lastFocusedColumn.restoreToTiled(window);
        }

        this.lastFocusedColumn = column;
        this.desktop.scrollToColumn(column, false);
    }

    // События (добавление/удаление/изменение размера колонок)
    onColumnAdded(column, leftColumn) {
        if (leftColumn === null) {
            this.columns.insertStart(column);
        } else {
            this.columns.insertAfter(column, leftColumn);
        }

        this.columnsSetX(column);
        this.desktop.onLayoutChanged();
        this.desktop.autoAdjustScroll();
    }

    onColumnRemoved(column, passFocus) {
        const isLastColumn = this.columns.length() === 1;
        const rightColumn = this.getRightColumn(column);

        const columnToFocus = isLastColumn
            ? null
            : (this.getLeftColumn(column) ?? rightColumn);

        if (column === this.lastFocusedColumn) {
            this.lastFocusedColumn = columnToFocus;
        }

        this.columns.remove(column);
        this.columnsSetX(rightColumn);

        this.desktop.onLayoutChanged();

        if (columnToFocus !== null) {
            if (passFocus === FocusPassing.Type.Immediate) {
                columnToFocus.getWindowToFocus().focus();
            } else if (passFocus === FocusPassing.Type.OnUnfocus) {
                this.focusPasser.request(columnToFocus.getWindowToFocus().client.kwinClient);
            }
            this.desktop.scrollToColumn(columnToFocus, true);
        } else {
            this.desktop.autoAdjustScroll();
        }
    }

    onColumnWidthChanged(column) {
        const rightColumn = this.columns.getNext(column);
        this.columnsSetX(rightColumn);

        this.desktop.onLayoutChanged();

        if (!this.userResize) {
            this.desktop.autoAdjustScroll();
        }
    }

    onScreenSizeChanged() {
        for (const column of this.columns.iterator()) {
            column.updateWidth();
            column.resizeWindows();
        }
    }

    onUserResizeStarted() {
        this.userResize = true;
    }

    onUserResizeFinished() {
        this.userResize = false;
        this.userResizeFinishedDelayer.run();
    }
}

// ============================================================================
// Диапазон (Range) для работы с видимостью элементов
// ============================================================================

var Range;
(function (Range) {
    const MaximizedMode = {
        Unmaximized: 0,
        Vertically: 1,
        Horizontally: 2,
        Maximized: 3
    };

    class BasicRange {
        constructor(x, width) {
            this.x = x;
            this.width = width;
        }

        getLeft() {
            return this.x;
        }

        getRight() {
            return this.x + this.width;
        }

        getWidth() {
            return this.width;
        }
    }

    function create(x, width) {
        return new BasicRange(x, width);
    }

    function fromRanges(leftRange, rightRange) {
        const left = leftRange.getLeft();
        const right = rightRange.getRight();
        return new BasicRange(left, right - left);
    }

    function contains(parent, child) {
        const isLeftWithin = child.getLeft() >= parent.getLeft();
        const isRightWithin = child.getRight() <= parent.getRight();
        return isLeftWithin && isRightWithin;
    }

    function minus(a, b) {
        const aCenter = a.getLeft() + a.getWidth() / 2;
        const bCenter = b.getLeft() + b.getWidth() / 2;
        return Math.round(aCenter - bCenter);
    }

    // Присваивание публичных методов
    Range.create = create;
    Range.fromRanges = fromRanges;
    Range.contains = contains;
    Range.minus = minus;
})(Range || (Range = {}));

// ============================================================================
// Окно в тайловом менеджере
// ============================================================================

class Window {
    constructor(client, column) {
        this.client = client;
        this.column = column;
        this.height = client.kwinClient.frameGeometry.height;

        this._initializeFocusedState();
        this._determineSkipArrangeFlag();

        column.onWindowAdded(this, true);
    }

    moveToColumn(targetColumn, placeAtBottom, passFocus) {
        if (targetColumn === this.column) return;

        this.column.onWindowRemoved(this, passFocus);
        this.column = targetColumn;
        targetColumn.onWindowAdded(this, placeAtBottom);
    }

    arrange(x, y, width, height) {
        if (this.skipArrange) return;

        const shouldReMaximize = this.column.grid.config.reMaximize;
        const isRestoringMaximizedState = shouldReMaximize && this._restorePreviousMaximizedState();

        if (!isRestoringMaximizedState) {
            this.client.place(x, y, width, height);
        }
    }

    focus() {
        this.client.focus();

        if (!this.isFocused()) {
            const { kwinClient } = this.client;
            this.column.grid.focusPasser.request(kwinClient);
        }
    }

    isFocused() {
        return this.client.isFocused();
    }

    onFocused() {
        const { reMaximize } = this.column.grid.config;
        const wasMaximizedOrFullscreen = this.focusedState.maximizedMode !== 0 ||
                                         this.focusedState.fullScreen;

        if (reMaximize && wasMaximizedOrFullscreen) {
            this.column.grid.desktop.forceArrange();
        }

        this.column.onWindowFocused(this);
    }

    restoreToTiled() {
        if (this.isFocused()) return;

        this.client.setFullScreen(false);
        this.client.setMaximize(false, false);
    }

    onMaximizedChanged(maximizedMode) {
        const isMaximized = maximizedMode !== 0;
        this.skipArrange = isMaximized;

        this._updateWindowDecorations(isMaximized, this.focusedState.fullScreen);

        if (this.isFocused()) {
            this.focusedState.maximizedMode = maximizedMode;
        }

        this.column.grid.desktop.onLayoutChanged();
    }

    onFullScreenChanged(fullScreen) {
        this.skipArrange = fullScreen;

        this._updateWindowDecorations(this.focusedState.maximizedMode !== 0, fullScreen);

        if (this.isFocused()) {
            this.focusedState.fullScreen = fullScreen;
        }

        this.column.grid.desktop.onLayoutChanged();
    }

    onFrameGeometryChanged() {
        const { width } = this.client.kwinClient.frameGeometry;
        this.column.setWidth(width, true);
        this.column.grid.desktop.onLayoutChanged();
    }

    destroy(passFocus) {
        this.column.onWindowRemoved(this, passFocus);
    }

    // Приватные методы
    _initializeFocusedState() {
        const UNMAXIMIZED = 0;
        let maximizedMode = this.client.getMaximizedMode();

        if (maximizedMode === undefined) {
            maximizedMode = UNMAXIMIZED;
        }

        this.focusedState = {
            fullScreen: this.client.kwinClient.fullScreen,
            maximizedMode: maximizedMode
        };
    }

    _determineSkipArrangeFlag() {
        const UNMAXIMIZED = 0;
        const { fullScreen } = this.client.kwinClient;
        const { maximizedMode } = this.focusedState;

        this.skipArrange = fullScreen || maximizedMode !== UNMAXIMIZED;
    }

    _restorePreviousMaximizedState() {
        const UNMAXIMIZED = 0;
        const { maximizedMode, fullScreen } = this.focusedState;
        let wasRestored = false;

        if (maximizedMode !== UNMAXIMIZED) {
            const horizontally = maximizedMode === 2 || maximizedMode === 3;
            const vertically = maximizedMode === 1 || maximizedMode === 3;

            this.client.setMaximize(horizontally, vertically);
            wasRestored = true;
        }

        if (fullScreen) {
            this.client.setFullScreen(true);
            wasRestored = true;
        }

        return wasRestored;
    }

    _updateWindowDecorations(isMaximized, isFullScreen) {
        const { kwinClient } = this.client;
        const { tiledKeepBelow, maximizedKeepAbove } = this.column.grid.config;

        if (tiledKeepBelow) {
            kwinClient.keepBelow = !(isMaximized || isFullScreen);
        }

        if (maximizedKeepAbove) {
            kwinClient.keepAbove = isMaximized || isFullScreen;
        }
    }
}

// ============================================================================
// Вспомогательные классы для правил окон
// ============================================================================

class ClientMatcher {
    constructor(regex) {
        this.regex = regex;
    }

    matches(kwinClient) {
        return this.regex.test(ClientMatcher.getClientString(kwinClient));
    }

    static getClientString(kwinClient) {
        return ClientMatcher.getRuleString(kwinClient.resourceClass, kwinClient.caption);
    }

    static getRuleString(ruleClass, ruleCaption) {
        return ruleClass + "\0" + ruleCaption;
    }
}

class DesktopFilter {
    constructor(desktopsConfig) {
        this.desktopRegex = DesktopFilter.parseDesktopConfig(desktopsConfig);
    }

    shouldWorkOnDesktop(kwinDesktop) {
        if (this.desktopRegex === null) {
            return true; // Work on all desktops
        }
        return this.desktopRegex.test(kwinDesktop.name);
    }

    static parseDesktopConfig(config) {
        const trimmed = config.trim();
        if (trimmed.length === 0) {
            return null; // Empty config means work on all desktops
        }
        try {
            return new RegExp(`^${trimmed}$`);
        }
        catch (e) {
            notificationInvalidTiledDesktops.sendEvent();
            log(`Invalid regex pattern in tiledDesktops config: ${trimmed}. Working on all desktops.`);
            return null; // Invalid regex means work on all desktops as fallback
        }
    }
}

class WindowRuleEnforcer {
    constructor(windowRules) {
        const [floatRegex, tileRegex, followCaptionRegex] = WindowRuleEnforcer.createWindowRuleRegexes(windowRules);
        this.preferFloating = new ClientMatcher(floatRegex);
        this.preferTiling = new ClientMatcher(tileRegex);
        this.followCaption = followCaptionRegex;
    }

    shouldTile(kwinClient) {
        const prefersTiling = this.preferTiling.matches(kwinClient);
        if (prefersTiling) return true;

        const isNormalWindow = kwinClient.normalWindow;
        const isNotTransient = !kwinClient.transient;
        const isManaged = kwinClient.managed;
        const hasValidPid = kwinClient.pid > -1;
        const isNotFullScreen = !kwinClient.fullScreen;
        const hasNoFullscreenGeometry = !Clients.isFullScreenGeometry(kwinClient);
        const prefersFloating = this.preferFloating.matches(kwinClient);

        return isNormalWindow &&
               isNotTransient &&
               isManaged &&
               hasValidPid &&
               isNotFullScreen &&
               hasNoFullscreenGeometry &&
               !prefersFloating;
    }

    initClientSignalManager(world, kwinClient) {
        const shouldFollowCaption = this.followCaption.test(kwinClient.resourceClass);
        if (!shouldFollowCaption) {
            return null;
        }

        const enforcer = this;
        const manager = new SignalManager();

        manager.connect(kwinClient.captionChanged, function() {
            const canTileNow = Clients.canTileNow(kwinClient);
            const shouldTile = canTileNow && enforcer.shouldTile(kwinClient);

            world.do(function(clientManager, desktopManager) {
                const desktop = desktopManager.getDesktopForClient(kwinClient);
                const hasDesktop = desktop !== undefined;

                if (shouldTile && hasDesktop) {
                    clientManager.tileKwinClient(kwinClient, desktop.grid);
                } else {
                    clientManager.floatKwinClient(kwinClient);
                }
            });
        });

        return manager;
    }

    static createWindowRuleRegexes(windowRules) {
        const floatRegexes = [];
        const tileRegexes = [];
        const followCaptionRegexes = [];

        for (const windowRule of windowRules) {
            const ruleClass = WindowRuleEnforcer.parseRegex(windowRule.class);
            const ruleCaption = WindowRuleEnforcer.parseRegex(windowRule.caption);
            const ruleString = ClientMatcher.getRuleString(
                WindowRuleEnforcer.wrapParens(ruleClass),
                WindowRuleEnforcer.wrapParens(ruleCaption)
            );

            if (windowRule.tile) {
                tileRegexes.push(ruleString);
            } else {
                floatRegexes.push(ruleString);
            }

            if (ruleCaption !== ".*") {
                followCaptionRegexes.push(ruleClass);
            }
        }

        return [
            WindowRuleEnforcer.joinRegexes(floatRegexes),
            WindowRuleEnforcer.joinRegexes(tileRegexes),
            WindowRuleEnforcer.joinRegexes(followCaptionRegexes),
        ];
    }

    static parseRegex(rawRule) {
        const isEmptyOrDefault = rawRule === undefined || rawRule === "" || rawRule === ".*";
        return isEmptyOrDefault ? ".*" : rawRule;
    }

    static joinRegexes(regexes) {
        if (regexes.length === 0) {
            return new RegExp("a^"); // match nothing
        }

        if (regexes.length === 1) {
            return new RegExp("^(" + regexes[0] + ")$");
        }

        const wrappedRegexes = regexes.map(function(regex) {
            return WindowRuleEnforcer.wrapParens(regex);
        });
        const joinedRegexes = wrappedRegexes.join("|");

        return new RegExp("^(" + joinedRegexes + ")$");
    }

    static wrapParens(str) {
        return "(" + str + ")";
    }
}

// ============================================================================
// Вспомогательные классы для задержек и таймеров
// ============================================================================

class Delayer {
    constructor(delay, f) {
        this.timer = initQmlTimer();
        this.timer.interval = delay;
        this.timer.triggered.connect(f);
    }

    run() {
        this.timer.restart();
    }

    destroy() {
        this.timer.destroy();
    }
}

function initQmlTimer() {
    return Qt.createQmlObject(`import QtQuick 6.0
        Timer {}`, qmlBase);
}

class Doer {
    constructor() {
        this.nCalls = 0;
    }
    do(f) {
        this.nCalls++;
        try {
            f();
        } finally {
            // Этот код выполнится даже если f() вызовет ошибку
            this.nCalls--;
        }
    }
    isDoing() {
        return this.nCalls > 0;
    }
}

// ============================================================================
// Двусвязный список (LinkedList)
// ============================================================================

class LinkedList {
    constructor() {
        this.firstNode = null;
        this.lastNode = null;
        this.itemMap = new Map();
    }

    getNode(item) {
        const node = this.itemMap.get(item);
        if (node === undefined) {
            throw new Error('Item not in list');
        }
        return node;
    }

    insertBefore(item, nextItem) {
        const nextNode = this.getNode(nextItem);
        this.insert(item, nextNode.prev, nextNode);
    }

    insertAfter(item, prevItem) {
        const prevNode = this.getNode(prevItem);
        this.insert(item, prevNode, prevNode.next);
    }

    insertStart(item) {
        this.insert(item, null, this.firstNode);
    }

    insertEnd(item) {
        this.insert(item, this.lastNode, null);
    }

    insert(item, prevNode, nextNode) {
        const node = new LinkedList.Node(item);
        this.itemMap.set(item, node);
        this.insertNode(node, prevNode, nextNode);
    }

    insertNode(node, prevNode, nextNode) {
        node.prev = prevNode;
        node.next = nextNode;

        if (nextNode !== null) {
            console.assert(nextNode.prev === prevNode);
            nextNode.prev = node;
        }

        if (prevNode !== null) {
            console.assert(prevNode.next === nextNode);
            prevNode.next = node;
        }

        if (this.firstNode === nextNode) {
            this.firstNode = node;
        }

        if (this.lastNode === prevNode) {
            this.lastNode = node;
        }
    }

    getPrev(item) {
        const prevNode = this.getNode(item).prev;
        return prevNode?.item ?? null;
    }

    getNext(item) {
        const nextNode = this.getNode(item).next;
        return nextNode?.item ?? null;
    }

    getFirst() {
        return this.firstNode?.item ?? null;
    }

    getLast() {
        return this.lastNode?.item ?? null;
    }

    getItemAtIndex(index) {
        let node = this.firstNode;

        for (let i = 0; i < index && node !== null; i++) {
            node = node.next;
        }

        return node?.item ?? null;
    }

    remove(item) {
        const node = this.getNode(item);
        this.itemMap.delete(item);
        this.removeNode(node);
    }

    removeNode(node) {
        const { prev, next } = node;

        if (prev !== null) prev.next = next;
        if (next !== null) next.prev = prev;

        if (this.firstNode === node) this.firstNode = next;
        if (this.lastNode === node) this.lastNode = prev;
    }

    contains(item) {
        return this.itemMap.has(item);
    }

    swap(node0, node1) {
        console.assert(node0.next === node1 && node1.prev === node0);

        const prevNode = node0.prev;
        const nextNode = node1.next;

        if (prevNode !== null) prevNode.next = node1;
        node1.next = node0;
        node0.next = nextNode;

        if (nextNode !== null) nextNode.prev = node0;
        node0.prev = node1;
        node1.prev = prevNode;

        if (this.firstNode === node0) this.firstNode = node1;
        if (this.lastNode === node1) this.lastNode = node0;
    }

    move(item, prevItem) {
        const node = this.getNode(item);
        this.removeNode(node);

        if (prevItem === null) {
            this.insertNode(node, null, this.firstNode);
        } else {
            const prevNode = this.getNode(prevItem);
            this.insertNode(node, prevNode, prevNode.next);
        }
    }

    moveBack(item) {
        const node = this.getNode(item);
        if (node.prev !== null) {
            console.assert(node !== this.firstNode);
            this.swap(node.prev, node);
        }
    }

    moveForward(item) {
        const node = this.getNode(item);
        if (node.next !== null) {
            console.assert(node !== this.lastNode);
            this.swap(node, node.next);
        }
    }

    length() {
        return this.itemMap.size;
    }

    iterator() {
        const result = [];
        for (let node = this.firstNode; node !== null; node = node.next) {
            result.push(node.item);
        }
        return result;
    }

    iteratorFrom(startItem) {
        const result = [];
        // Проверка на случай, если node не найдется, чтобы не крашнулось
        let node = null;
        try {
             node = this.getNode(startItem);
        } catch(e) { return []; }

        for (; node !== null; node = node.next) {
            result.push(node.item);
        }
        return result;
    }
}

(function(LinkedList) {
    // TODO (optimization): reuse nodes
    class Node {
        constructor(item) {
            this.item = item;
            this.prev = null;
            this.next = null;
        }
    }
    LinkedList.Node = Node;
})(LinkedList || (LinkedList = {}));

// ============================================================================
// Ограничитель скорости (RateLimiter)
// ============================================================================

class RateLimiter {
    constructor(maxRequests, intervalMs) {
        this.maxRequests = maxRequests;
        this.intervalMs = intervalMs;
        this.requestCount = 0;
        this.intervalStart = 0;
    }

    acquire() {
        const now = Date.now();

        if (now - this.intervalStart >= this.intervalMs) {
            this.requestCount = 0;
            this.intervalStart = now;
        }

        if (this.requestCount < this.maxRequests) {
            this.requestCount++;
            return true;
        }

        return false;
    }
}

// ============================================================================
// Действия с клавиатурой (ShortcutAction)
// ============================================================================

class ShortcutAction {
    constructor(keyBinding, callback) {
        this.shortcutHandler = ShortcutAction.createShortcutHandler(keyBinding);
        this.shortcutHandler.activated.connect(callback);
    }

    destroy() {
        this.shortcutHandler.destroy();
    }

    static createShortcutHandler(keyBinding) {
        const sequenceLine = keyBinding.defaultKeySequence
            ? `    sequence: "${keyBinding.defaultKeySequence}";\n`
            : '';

        const qmlCode = `
            import QtQuick 6.0
            import org.kde.kwin 3.0

            ShortcutHandler {
                name: "rkarousel-${keyBinding.name}";
                text: "Rkarousel: ${keyBinding.description}";
                ${sequenceLine}
            }
        `;

        return Qt.createQmlObject(qmlCode, qmlBase);
    }
}

// ============================================================================
// Менеджер сигналов (SignalManager)
// ============================================================================

class SignalManager {
    constructor() {
        this.connections = [];
    }

    connect(signal, handler) {
        signal.connect(handler);
        this.connections.push({ signal, handler });
    }

    destroy() {
        for (const { signal, handler } of this.connections) {
            signal.disconnect(handler);
        }
        this.connections = [];
    }
}

// ============================================================================
// Вспомогательные функции (утилиты)
// ============================================================================

function union(array1, array2) {
    return [...new Set([...array1, ...array2])];
}

function uniq(sortedArray) {
    const result = [];
    let previousItem;

    for (const item of sortedArray) {
        if (item !== previousItem) {
            result.push(item);
            previousItem = item;
        }
    }

    return result;
}

function mapGetOrInit(map, key, defaultValue) {
    if (map.has(key)) {
        return map.get(key);
    }

    map.set(key, defaultValue);
    return defaultValue;
}

function findMinPositive(items, evaluate) {
    let bestScore = Infinity;
    let bestItem;

    for (const item of items) {
        const score = evaluate(item);

        if (score > 0 && score < bestScore) {
            bestScore = score;
            bestItem = item;
        }
    }

    return bestItem;
}

function fillSpace(availableSpace, items) {
    if (items.length === 0) {
        return [];
    }

    const middleSize = calculateMiddleSize(availableSpace, items);
    const sizes = items.map(item => clamp(middleSize, item.min, item.max));

    if (middleSize !== Math.floor(availableSpace / items.length)) {
        distributeRemainingSpace(availableSpace, middleSize, sizes, items);
    }

    return sizes;
}

function calculateMiddleSize(availableSpace, items) {
    const ranges = buildRanges(items);
    let requiredSpace = items.reduce((sum, item) => sum + item.min, 0);

    for (const range of ranges) {
        const rangeSize = range.end - range.start;
        const maxSpaceDelta = rangeSize * range.count;

        if (requiredSpace + maxSpaceDelta >= availableSpace) {
            const positionInRange = (availableSpace - requiredSpace) / maxSpaceDelta;
            return Math.floor(range.start + rangeSize * positionInRange);
        }

        requiredSpace += maxSpaceDelta;
    }

    return ranges[ranges.length - 1].end;
}

function buildRanges(items) {
    const fenceposts = extractFenceposts(items);

    if (fenceposts.length === 1) {
        return [{
            start: fenceposts[0].value,
            end: fenceposts[0].value,
            count: items.length,
        }];
    }

    const ranges = [];
    let currentCount = 0;

    for (let i = 1; i < fenceposts.length; i++) {
        const prevFence = fenceposts[i - 1];
        const currentFence = fenceposts[i];

        currentCount = currentCount - prevFence.nMax + prevFence.nMin;

        ranges.push({
            start: prevFence.value,
            end: currentFence.value,
            count: currentCount,
        });
    }

    return ranges;
}

function extractFenceposts(items) {
    const fencepostMap = new Map();

    for (const item of items) {
        const minEntry = mapGetOrInit(fencepostMap, item.min, {
            value: item.min, nMin: 0, nMax: 0
        });
        minEntry.nMin++;

        const maxEntry = mapGetOrInit(fencepostMap, item.max, {
            value: item.max, nMin: 0, nMax: 0
        });
        maxEntry.nMax++;
    }

    const fenceposts = Array.from(fencepostMap.values());
    fenceposts.sort((a, b) => a.value - b.value);

    return fenceposts;
}

function distributeRemainingSpace(availableSpace, middleSize, sizes, constraints) {
    const middleSizeIndexes = sizes
        .map((size, index) => size === middleSize ? index : -1)
        .filter(index => index !== -1);

    middleSizeIndexes.sort((a, b) => constraints[a].max - constraints[b].max);

    let remainingSpace = availableSpace - sizes.reduce((sum, size) => sum + size, 0);
    let itemsLeft = middleSizeIndexes.length;

    for (const index of middleSizeIndexes) {
        if (remainingSpace <= 0) break;

        const maxEnlargable = constraints[index].max - sizes[index];

        if (maxEnlargable > 0) {
            const enlargeAmount = Math.min(maxEnlargable, Math.ceil(remainingSpace / itemsLeft));
            sizes[index] += enlargeAmount;
            remainingSpace -= enlargeAmount;
        }

        itemsLeft--;
    }
}

Function.prototype.partial = function (...initialArgs) {
    return (...additionalArgs) => this(...initialArgs, ...additionalArgs);
};

function log(...args) {
    console.log("Rkarousel:", ...args);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sum(...numbers) {
    return numbers.reduce((total, num) => total + num, 0);
}

function rectEquals(rectA, rectB) {
    return rectA.x === rectB.x &&
           rectA.y === rectB.y &&
           rectA.width === rectB.width &&
           rectA.height === rectB.height;
}

function pointEquals(pointA, pointB) {
    return pointA.x === pointB.x && pointA.y === pointB.y;
}

function rectContainsPoint(rect, point) {
    return rect.left <= point.x &&
           rect.right >= point.x &&
           rect.top <= point.y &&
           rect.bottom >= point.y;
}

function applyMacro(template, value) {
    return template.replace("{}", String(value));
}

// ============================================================================
// Основной менеджер клиентов (ClientManager)
// ============================================================================

class ClientManager {
    constructor(config, world, desktopManager, pinManager) {
        this.config = config;
        this.world = world;
        this.desktopManager = desktopManager;
        this.pinManager = pinManager;

        this.clientMap = new Map();
        this.lastFocusedClient = null;

        this.windowRuleEnforcer = this.initializeWindowRuleEnforcer(config);
    }

    initializeWindowRuleEnforcer(config) {
        try {
            const parsedWindowRules = JSON.parse(config.windowRules);
            return new WindowRuleEnforcer(parsedWindowRules);
        } catch (error) {
            notificationInvalidWindowRules.sendEvent();
            log("Failed to parse windowRules:", error);
            return new WindowRuleEnforcer([]);
        }
    }

    addClient(kwinClient) {
        console.assert(!this.hasClient(kwinClient));

        const client = this.createClientWrapper(kwinClient);
        this.clientMap.set(kwinClient, client);
    }

    createClientWrapper(kwinClient) {
        const constructState = this.determineInitialState(kwinClient);
        const transientFor = this.findTransientFor(kwinClient);
        const signalManager = this.windowRuleEnforcer.initClientSignalManager(this.world, kwinClient);

        return new ClientWrapper(kwinClient, constructState, transientFor, signalManager);
    }

    determineInitialState(kwinClient) {
        if (kwinClient.dock) {
            return (client) => new ClientState.Docked(this.world, kwinClient);
        }

        if (this.shouldBeTiled(kwinClient)) {
            Clients.makeTileable(kwinClient);
            console.assert(Clients.canTileNow(kwinClient));

            const desktop = this.desktopManager.getDesktopForClient(kwinClient);
            return (client) => new ClientState.Tiled(this.world, client, desktop.grid);
        }

        return (client) => new ClientState.Floating(this.world, client, this.config, false);
    }

    shouldBeTiled(kwinClient) {
        return Clients.canTileEver(kwinClient) &&
               this.windowRuleEnforcer.shouldTile(kwinClient) &&
               this.desktopManager.getDesktopForClient(kwinClient) !== undefined;
    }

    removeClient(kwinClient, passFocus) {
        console.assert(this.hasClient(kwinClient));

        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        if (kwinClient !== this.lastFocusedClient) {
            passFocus = FocusPassing.Type.None;
        }

        client.destroy(passFocus);
        this.clientMap.delete(kwinClient);
    }

    findTransientFor(kwinClient) {
        if (!kwinClient.transient || !kwinClient.transientFor) {
            return null;
        }

        return this.clientMap.get(kwinClient.transientFor) || null;
    }

    minimizeClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        if (client.stateManager.getState() instanceof ClientState.Tiled) {
            const passFocus = kwinClient === this.lastFocusedClient
                ? FocusPassing.Type.Immediate
                : FocusPassing.Type.None;

            client.stateManager.setState(
                () => new ClientState.TiledMinimized(this.world, client),
                passFocus
            );
        }
    }

    tileClient(client, grid) {
        if (client.stateManager.getState() instanceof ClientState.Tiled) {
            return;
        }

        client.stateManager.setState(
            () => new ClientState.Tiled(this.world, client, grid),
            FocusPassing.Type.None
        );
    }

    floatClient(client) {
        if (client.stateManager.getState() instanceof ClientState.Floating) {
            return;
        }

        client.stateManager.setState(
            () => new ClientState.Floating(this.world, client, this.config, true),
            FocusPassing.Type.None
        );
    }

    tileKwinClient(kwinClient, grid) {
        const client = this.clientMap.get(kwinClient);
        if (client) {
            this.tileClient(client, grid);
        }
    }

    floatKwinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (client) {
            this.floatClient(client);
        }
    }

    pinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        if (client.getMaximizedMode() !== MaximizedMode.Unmaximized) {
            // The client is not really kwin-tiled, just maximized
            kwinClient.tile = null;
            return;
        }

        client.stateManager.setState(
            () => new ClientState.Pinned(this.world, this.pinManager, this.desktopManager, kwinClient, this.config),
            FocusPassing.Type.None
        );

        this.pinManager.addClient(kwinClient);
        this.notifyDesktopsAboutPinChange(kwinClient);
    }

    unpinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        console.assert(client.stateManager.getState() instanceof ClientState.Pinned);

        client.stateManager.setState(
            () => new ClientState.Floating(this.world, client, this.config, false),
            FocusPassing.Type.None
        );

        this.pinManager.removeClient(kwinClient);
        this.notifyDesktopsAboutPinChange(kwinClient);
    }

    notifyDesktopsAboutPinChange(kwinClient) {
        for (const desktop of this.desktopManager.getDesktopsForClient(kwinClient)) {
            desktop.onPinsChanged();
        }
    }

    toggleFloatingClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        const clientState = client.stateManager.getState();

        if (this.canToggleToTiled(clientState, kwinClient)) {
            this.tileClient(client, this.getDesktopGridForClient(kwinClient));
        } else if (clientState instanceof ClientState.Tiled) {
            this.floatClient(client);
        }
    }

    canToggleToTiled(clientState, kwinClient) {
        return (clientState instanceof ClientState.Floating || clientState instanceof ClientState.Pinned) &&
               Clients.canTileEver(kwinClient);
    }

    getDesktopGridForClient(kwinClient) {
        Clients.makeTileable(kwinClient);
        const desktop = this.desktopManager.getDesktopForClient(kwinClient);
        return desktop ? desktop.grid : null;
    }

    hasClient(kwinClient) {
        return this.clientMap.has(kwinClient);
    }

    onClientFocused(kwinClient) {
        this.lastFocusedClient = kwinClient;

        const window = this.findTiledWindow(kwinClient);
        if (window) {
            window.onFocused();
        }
    }

    findTiledWindow(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        return client ? this.findTiledWindowOfClient(client) : null;
    }

    findTiledWindowOfClient(client) {
        const clientState = client.stateManager.getState();

        if (clientState instanceof ClientState.Tiled) {
            return clientState.window;
        }

        if (client.transientFor) {
            return this.findTiledWindowOfClient(client.transientFor);
        }

        return null;
    }

    removeAllClients() {
        for (const kwinClient of Array.from(this.clientMap.keys())) {
            this.removeClient(kwinClient, FocusPassing.Type.None);
        }
    }

    destroy() {
        this.removeAllClients();
    }
}

// ============================================================================
// Обертка над KWin клиентом (ClientWrapper)
// ============================================================================

class ClientWrapper {
    constructor(kwinClient, constructInitialState, transientFor, rulesSignalManager) {
        this.kwinClient = kwinClient;
        this.transientFor = transientFor;
        this.transients = [];
        this.rulesSignalManager = rulesSignalManager;
        this.signalManager = null;
        this.manipulatingGeometry = new Doer();
        this.lastPlacement = null;
        this.maximizedMode = undefined;

        this.initializeTransientRelationship(transientFor);
        this.initializeSignals();
        this.initializeState(constructInitialState);
    }

    initializeTransientRelationship(transientFor) {
        if (transientFor !== null) {
            transientFor.addTransient(this);
        }
    }

    initializeSignals() {
        this.signalManager = ClientWrapper.createSignalManager(this);
    }

    initializeState(constructInitialState) {
        this.preferredWidth = this.kwinClient.frameGeometry.width;
        this.stateManager = new ClientState.Manager(constructInitialState(this));
    }

    static createSignalManager(client) {
        const manager = new SignalManager();

        manager.connect(client.kwinClient.maximizedAboutToChange, (maximizedMode) => {
            if (maximizedMode !== 0 /* MaximizedMode.Unmaximized */ &&
                client.kwinClient.tile !== null) {
                client.kwinClient.tile = null;
            }
            client.maximizedMode = maximizedMode;
        });

        return manager;
    }

    place(x, y, width, height) {
        this.manipulatingGeometry.do(() => {
            if (this.kwinClient.resize) {
                // Window is being manually resized, prevent fighting with the user
                return;
            }

            this.lastPlacement = Qt.rect(x, y, width, height);
            this.applyPlacementWithWaylandWorkaround();
        });
    }

    applyPlacementWithWaylandWorkaround() {
        this.kwinClient.frameGeometry = this.lastPlacement;
    }

    moveTransient(dx, dy, kwinDesktops) {
        if (!(this.stateManager.getState() instanceof ClientState.Floating)) {
            return;
        }

        if (Clients.isOnOneOfVirtualDesktops(this.kwinClient, kwinDesktops)) {
            this.moveWindowBy(dx, dy);
        }

        this.moveChildTransients(dx, dy, kwinDesktops);
    }

    moveWindowBy(dx, dy) {
        const frame = this.kwinClient.frameGeometry;
        this.kwinClient.frameGeometry = Qt.rect(
            frame.x + dx,
            frame.y + dy,
            frame.width,
            frame.height
        );
    }

    moveChildTransients(dx, dy, kwinDesktops) {
        for (const transient of this.transients) {
            transient.moveTransient(dx, dy, kwinDesktops);
        }
    }

    moveTransients(dx, dy) {
        for (const transient of this.transients) {
            transient.moveTransient(dx, dy, this.kwinClient.desktops);
        }
    }

    focus() {
        Workspace.activeWindow = this.kwinClient;
    }

    isFocused() {
        return Workspace.activeWindow === this.kwinClient;
    }

    setMaximize(horizontally, vertically) {
        if (!this.kwinClient.maximizable) {
            this.maximizedMode = 0 /* MaximizedMode.Unmaximized */;
            return;
        }

        this.updateMaximizedMode(horizontally, vertically);
        this.applyMaximization(horizontally, vertically);
    }

    updateMaximizedMode(horizontally, vertically) {
        if (this.maximizedMode !== undefined) return;

        if (horizontally && vertically) {
            this.maximizedMode = 3 /* MaximizedMode.Maximized */;
        } else if (horizontally) {
            this.maximizedMode = 2 /* MaximizedMode.Horizontally */;
        } else if (vertically) {
            this.maximizedMode = 1 /* MaximizedMode.Vertically */;
        } else {
            this.maximizedMode = 0 /* MaximizedMode.Unmaximized */;
        }
    }

    applyMaximization(horizontally, vertically) {
        this.manipulatingGeometry.do(() => {
            this.kwinClient.setMaximize(vertically, horizontally);
        });
    }

    setFullScreen(fullScreen) {
        if (!this.kwinClient.fullScreenable) {
            return;
        }

        this.manipulatingGeometry.do(() => {
            this.kwinClient.fullScreen = fullScreen;
        });
    }

    getMaximizedMode() {
        return this.maximizedMode;
    }

    isManipulatingGeometry(newGeometry) {
        if (newGeometry !== null && newGeometry === this.lastPlacement) {
            return true;
        }
        return this.manipulatingGeometry.isDoing();
    }

    addTransient(transient) {
        this.transients.push(transient);
    }

    removeTransient(transient) {
        const index = this.transients.indexOf(transient);
        if (index !== -1) {
            this.transients.splice(index, 1);
        }
    }

    ensureTransientsVisible(screenSize) {
        for (const transient of this.transients) {
            if (transient.stateManager.getState() instanceof ClientState.Floating) {
                transient.ensureVisible(screenSize);
                transient.ensureTransientsVisible(screenSize);
            }
        }
    }

    ensureVisible(screenSize) {
        if (!Clients.isOnVirtualDesktop(this.kwinClient, Workspace.currentDesktop)) {
            return;
        }

        const frame = this.kwinClient.frameGeometry;

        if (frame.left < screenSize.left) {
            frame.x = screenSize.left;
        } else if (frame.right > screenSize.right) {
            frame.x = screenSize.right - frame.width;
        }
    }

    destroy(passFocus) {
        this.stateManager.destroy(passFocus);
        this.signalManager.destroy();

        if (this.rulesSignalManager !== null) {
            this.rulesSignalManager.destroy();
        }

        if (this.transientFor !== null) {
            this.transientFor.removeTransient(this);
        }

        this.clearTransientRelationships();
    }

    clearTransientRelationships() {
        for (const transient of this.transients) {
            transient.transientFor = null;
        }
    }
}

// ============================================================================
// Утилиты для работы с KWin клиентами (Clients)
// ============================================================================

var Clients = (function() {
    const prohibitedClasses = [
        "ksmserver-logout-greeter",
        "xwaylandvideobridge",
    ];

    function canTileEver(kwinClient) {
        const isShapeable = (kwinClient.moveable && kwinClient.resizeable) ||
                           kwinClient.fullScreen; // Full-screen windows may become shapeable after exiting

        return isShapeable &&
               !kwinClient.popupWindow &&
               !prohibitedClasses.includes(kwinClient.resourceClass);
    }

    function canTileNow(kwinClient) {
        return canTileEver(kwinClient) &&
               !kwinClient.minimized &&
               kwinClient.desktops.length === 1 &&
               kwinClient.activities.length === 1;
    }

    function makeTileable(kwinClient) {
        if (kwinClient.minimized) {
            kwinClient.minimized = false;
        }

        if (kwinClient.desktops.length !== 1) {
            kwinClient.desktops = [Workspace.currentDesktop];
        }

        if (kwinClient.activities.length !== 1) {
            kwinClient.activities = [Workspace.currentActivity];
        }
    }

    function getKwinDesktopApprox(kwinClient) {
        const desktops = kwinClient.desktops;

        switch (desktops.length) {
            case 0:
                return Workspace.currentDesktop;
            case 1:
                return desktops[0];
            default:
                if (desktops.includes(Workspace.currentDesktop)) {
                    return Workspace.currentDesktop;
                } else {
                    return desktops[0];
                }
        }
    }

    function isFullScreenGeometry(kwinClient) {
        const fullScreenArea = Workspace.clientArea(
            4 /* ClientAreaOption.FullScreenArea */,
            kwinClient.output,
            getKwinDesktopApprox(kwinClient)
        );

        const clientGeometry = kwinClient.clientGeometry;
        return clientGeometry.width >= fullScreenArea.width &&
               clientGeometry.height >= fullScreenArea.height;
    }

    function isOnVirtualDesktop(kwinClient, kwinDesktop) {
        return kwinClient.desktops.length === 0 ||
               kwinClient.desktops.includes(kwinDesktop);
    }

    function isOnOneOfVirtualDesktops(kwinClient, kwinDesktops) {
        return kwinClient.desktops.length === 0 ||
               kwinClient.desktops.some(desktop => kwinDesktops.includes(desktop));
    }

    return {
        canTileEver: canTileEver,
        canTileNow: canTileNow,
        makeTileable: makeTileable,
        getKwinDesktopApprox: getKwinDesktopApprox,
        isFullScreenGeometry: isFullScreenGeometry,
        isOnVirtualDesktop: isOnVirtualDesktop,
        isOnOneOfVirtualDesktops: isOnOneOfVirtualDesktops
    };
})();

// ============================================================================
// Менеджер рабочих столов (DesktopManager)
// ============================================================================

class DesktopManager {
    constructor(pinManager, config, layoutConfig, focusPasser, desktopFilter) {
        this.pinManager = pinManager;
        this.config = config;
        this.layoutConfig = layoutConfig;
        this.focusPasser = focusPasser;
        this.desktopFilter = desktopFilter;

        this.desktops = new Map();
        this.selectedScreen = Workspace.activeScreen;
        this.kwinActivities = new Set(Workspace.activities);
        this.kwinDesktops = new Set(Workspace.desktops);
    }

    getDesktop(activity, kwinDesktop) {
        if (!this.desktopFilter.shouldWorkOnDesktop(kwinDesktop)) {
            return undefined;
        }

        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = this.desktops.get(desktopKey);

        if (desktop !== undefined) {
            return desktop;
        }

        return this.addDesktop(activity, kwinDesktop);
    }

    getCurrentDesktop() {
        return this.getDesktop(Workspace.currentActivity, Workspace.currentDesktop);
    }

    getDesktopInCurrentActivity(kwinDesktop) {
        return this.getDesktop(Workspace.currentActivity, kwinDesktop);
    }

    getDesktopForClient(kwinClient) {
        // ИСПРАВЛЕНИЕ: Добавлена проверка на существование массивов (защита от undefined)
        const activities = kwinClient.activities || [];
        const desktops = kwinClient.desktops || [];

        if (activities.length !== 1 || desktops.length !== 1) {
            return undefined;
        }

        return this.getDesktop(activities[0], desktops[0]);
    }

    addDesktop(activity, kwinDesktop) {
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = new Desktop(
            kwinDesktop,
            this.pinManager,
            this.config,
            () => this.selectedScreen,
            this.layoutConfig,
            this.focusPasser
        );

        this.desktops.set(desktopKey, desktop);
        return desktop;
    }

    static getDesktopKey(activity, kwinDesktop) {
        return `${activity}|${kwinDesktop.id}`;
    }

    updateActivities() {
        const newActivities = new Set(Workspace.activities);

        for (const activity of this.kwinActivities) {
            if (!newActivities.has(activity)) {
                this.removeActivity(activity);
            }
        }

        this.kwinActivities = newActivities;
    }

    updateDesktops() {
        const newDesktops = new Set(Workspace.desktops);

        for (const desktop of this.kwinDesktops) {
            if (!newDesktops.has(desktop)) {
                this.removeKwinDesktop(desktop);
            }
        }

        this.kwinDesktops = newDesktops;
    }

    selectScreen(screen) {
        this.selectedScreen = screen;
    }

    removeActivity(activity) {
        for (const kwinDesktop of this.kwinDesktops) {
            this.destroyDesktop(activity, kwinDesktop);
        }
    }

    removeKwinDesktop(kwinDesktop) {
        for (const activity of this.kwinActivities) {
            this.destroyDesktop(activity, kwinDesktop);
        }
    }

    destroyDesktop(activity, kwinDesktop) {
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = this.desktops.get(desktopKey);

        if (desktop !== undefined) {
            desktop.destroy();
            this.desktops.delete(desktopKey);
        }
    }

    destroy() {
        for (const desktop of this.desktops.values()) {
            desktop.destroy();
        }
    }

    *getAllDesktops() {
        for (const desktop of this.desktops.values()) {
            yield desktop;
        }
    }

    getDesktopsForClient(kwinClient) {
        // Workaround for QTBUG-109880
        const activities = kwinClient.activities || [];
        const desktops = kwinClient.desktops || [];
        return this.getDesktops(activities, desktops);
    }

    *getDesktops(activities, kwinDesktops) {
        const matchedActivities = activities.length > 0 ? activities : this.kwinActivities;
        const matchedDesktops = kwinDesktops.length > 0 ? kwinDesktops : this.kwinDesktops;

        for (const activity of matchedActivities) {
            for (const desktop of matchedDesktops) {
                const desktopKey = DesktopManager.getDesktopKey(activity, desktop);
                const desktopObj = this.desktops.get(desktopKey);

                if (desktopObj !== undefined) {
                    yield desktopObj;
                }
            }
        }
    }
}

// ============================================================================
// Передача фокуса между окнами (FocusPassing)
// ============================================================================

var FocusPassing;
(function(FocusPassing) {
    FocusPassing.Type = {
        None: 0,
        Immediate: 1,
        OnUnfocus: 2
    };

    class Passer {
        constructor() {
            this.currentRequest = null;
        }

        request(target) {
            this.currentRequest = new Request(target, Date.now());
        }

        clear() {
            this.currentRequest = null;
        }

        clearIfDifferent(kwinClient) {
            if (this.currentRequest !== null && this.currentRequest.target !== kwinClient) {
                this.clear();
            }
        }

        activate() {
            if (this.currentRequest === null) {
                return;
            }

            if (this.currentRequest.isExpired()) {
                this.clear();
                return;
            }

            if (Workspace.activeWindow !== null && Workspace.activeWindow !== this.currentRequest.target) {
                this.clear();
                return;
            }

            Workspace.activeWindow = this.currentRequest.target;
        }
    }
    FocusPassing.Passer = Passer;

    class Request {
        constructor(target, time) {
            this.target = target;
            this.time = time;
        }

        isExpired() {
            const elapsedTime = Date.now() - this.time;
            return elapsedTime > Request.VALID_MS;
        }
    }
    Request.VALID_MS = 200;
})(FocusPassing || (FocusPassing = {}));

// ============================================================================
// Менеджер закрепленных окон (PinManager)
// ============================================================================

class PinManager {
    constructor() {
        this.pinnedClients = new Set();
    }

    addClient(kwinClient) {
        this.pinnedClients.add(kwinClient);
    }

    removeClient(kwinClient) {
        this.pinnedClients.delete(kwinClient);
    }

    getAvailableSpace(kwinDesktop, screen) {
        const baseLot = new PinManager.Lot(screen.top, screen.bottom, screen.left, screen.right);
        let availableLots = [baseLot];

        for (const client of this.pinnedClients) {
            if (!this.shouldConsiderClient(client, kwinDesktop)) {
                continue;
            }

            availableLots = this.splitLotsAroundClient(availableLots, client);
        }

        return this.findLargestLot(availableLots);
    }

    shouldConsiderClient(client, kwinDesktop) {
        return !Clients.isOnVirtualDesktop(client, kwinDesktop) || client.minimized;
    }

    splitLotsAroundClient(lots, client) {
        const newLots = [];

        for (const lot of lots) {
            lot.split(newLots, client.frameGeometry);
        }

        return newLots;
    }

    findLargestLot(lots) {
        let largestLot = lots[0] || null;
        let largestArea = 0;

        for (const lot of lots) {
            const area = lot.area();

            if (area > largestArea) {
                largestArea = area;
                largestLot = lot;
            }
        }

        return largestLot;
    }
}

(function(PinManager) {
    class Lot {
        constructor(top, bottom, left, right) {
            this.top = top;
            this.bottom = bottom;
            this.left = left;
            this.right = right;
        }

        split(destLots, obstacle) {
            if (!this.contains(obstacle)) {
                // Don't split if obstacle doesn't intersect
                destLots.push(this);
                return;
            }

            this.splitVertically(destLots, obstacle);
            this.splitHorizontally(destLots, obstacle);
        }

        splitVertically(destLots, obstacle) {
            if (obstacle.top - this.top >= Lot.MIN_HEIGHT) {
                destLots.push(new Lot(this.top, obstacle.top, this.left, this.right));
            }

            if (this.bottom - obstacle.bottom >= Lot.MIN_HEIGHT) {
                destLots.push(new Lot(obstacle.bottom, this.bottom, this.left, this.right));
            }
        }

        splitHorizontally(destLots, obstacle) {
            if (obstacle.left - this.left >= Lot.MIN_WIDTH) {
                destLots.push(new Lot(this.top, this.bottom, this.left, obstacle.left));
            }

            if (this.right - obstacle.right >= Lot.MIN_WIDTH) {
                destLots.push(new Lot(this.top, this.bottom, obstacle.right, this.right));
            }
        }

        contains(obstacle) {
            return obstacle.right > this.left &&
                   obstacle.left < this.right &&
                   obstacle.bottom > this.top &&
                   obstacle.top < this.bottom;
        }

        area() {
            const height = this.bottom - this.top;
            const width = this.right - this.left;
            return height * width;
        }
    }

    Lot.MIN_WIDTH = 200;
    Lot.MIN_HEIGHT = 200;

    PinManager.Lot = Lot;
})(PinManager || (PinManager = {}));

// ============================================================================
// Главный класс - управление всей системой (World)
// ============================================================================

class World {
    constructor(config) {
        const focusPasser = new FocusPassing.Passer();

        this.workspaceSignalManager = this.initWorkspaceSignalHandlers(focusPasser);

        this.presetWidths = this.createPresetWidths(config);
        this.shortcutActions = this.registerKeyBindings(config);
        this.screenResizedDelayer = this.createScreenResizedDelayer();

        this.pinManager = new PinManager();
        this.desktopManager = this.createDesktopManager(config, focusPasser);
        this.clientManager = this.createClientManager(config);

        this.addExistingClients();
        this.update();
    }

    initWorkspaceSignalHandlers(focusPasser) {
        return initWorkspaceSignalHandlers(this, focusPasser);
    }

    createPresetWidths(config) {
        let presetWidths = {
            next: (currentWidth, minWidth, maxWidth) => currentWidth,
            prev: (currentWidth, minWidth, maxWidth) => currentWidth,
            getWidths: (minWidth, maxWidth) => [],
        };

        try {
            presetWidths = new PresetWidths(config.presetWidths, config.gapsInnerHorizontal);
        } catch (error) {
            notificationInvalidPresetWidths.sendEvent();
            log("Failed to parse presetWidths:", error);
        }

        return presetWidths;
    }

    registerKeyBindings(config) {
        const columnResizer = config.scrollingCentered
            ? new RawResizer(this.presetWidths)
            : new ContextualResizer(this.presetWidths);

        const keyBindingConfig = {
            manualScrollStep: config.manualScrollStep,
            presetWidths: this.presetWidths,
            columnResizer: columnResizer,
        };

        return registerKeyBindings(this, keyBindingConfig);
    }

    createScreenResizedDelayer() {
        return new Delayer(1000, () => {
            // This delay ensures that docks are taken into account by `Workspace.clientArea`
            for (const desktop of this.desktopManager.getAllDesktops()) {
                desktop.onLayoutChanged();
            }
            this.update();
        });
    }

    createDesktopManager(config, focusPasser) {
        const layoutConfig = {
            gapsInnerHorizontal: config.gapsInnerHorizontal,
            gapsInnerVertical: config.gapsInnerVertical,
            stackOffsetX: config.stackOffsetX,
            stackOffsetY: config.stackOffsetY,
            offScreenOpacity: config.offScreenOpacity / 100.0,
            stackColumnsByDefault: config.stackColumnsByDefault,
            resizeNeighborColumn: config.resizeNeighborColumn,
            reMaximize: config.reMaximize,
            skipSwitcher: config.skipSwitcher,
            tiledKeepBelow: config.tiledKeepBelow,
            maximizedKeepAbove: config.floatingKeepAbove,
            untileOnDrag: config.untileOnDrag,
        };

        const desktopConfig = {
            marginTop: config.gapsOuterTop,
            marginBottom: config.gapsOuterBottom,
            marginLeft: config.gapsOuterLeft,
            marginRight: config.gapsOuterRight,
            scroller: World.createScroller(config),
            clamper: config.scrollingLazy ? new EdgeClamper() : new CenterClamper(),
            gestureScroll: config.gestureScroll,
            gestureScrollInvert: config.gestureScrollInvert,
            gestureScrollStep: config.gestureScrollStep,
        };

        return new DesktopManager(
            this.pinManager,
            desktopConfig,
            layoutConfig,
            focusPasser,
            new DesktopFilter(config.tiledDesktops)
        );
    }

    createClientManager(config) {
        return new ClientManager(config, this, this.desktopManager, this.pinManager);
    }

    static createScroller(config) {
        if (config.scrollingLazy) {
            return new LazyScroller();
        } else if (config.scrollingCentered) {
            return new CenteredScroller();
        } else if (config.scrollingGrouped) {
            return new GroupedScroller();
        } else {
            log("No scrolling mode selected, using default");
            return new LazyScroller();
        }
    }

    addExistingClients() {
        for (const kwinClient of Workspace.windows) {
            this.clientManager.addClient(kwinClient);
        }
    }

    update() {
        const currentDesktop = this.desktopManager.getCurrentDesktop();
        if (currentDesktop !== undefined) {
            currentDesktop.arrange();
        }
    }

    do(action) {
        action(this.clientManager, this.desktopManager);
        this.update();
    }

    doIfTiled(kwinClient, action) {
        const window = this.clientManager.findTiledWindow(kwinClient);
        if (window === null) {
            return;
        }

        const column = window.column;
        const grid = column.grid;
        action(this.clientManager, this.desktopManager, window, column, grid);
        this.update();
    }

    doIfTiledFocused(action) {
        if (Workspace.activeWindow === null) {
            return;
        }
        this.doIfTiled(Workspace.activeWindow, action);
    }

    gestureScroll(amount) {
        this.do((clientManager, desktopManager) => {
            const currentDesktop = desktopManager.getCurrentDesktop();
            if (currentDesktop !== undefined) {
                currentDesktop.gestureScroll(amount);
            }
        });
    }

    gestureScrollFinish() {
        this.do((clientManager, desktopManager) => {
            const currentDesktop = desktopManager.getCurrentDesktop();
            if (currentDesktop !== undefined) {
                currentDesktop.gestureScrollFinish();
            }
        });
    }

    destroy() {
        this.workspaceSignalManager.destroy();

        for (const shortcutAction of this.shortcutActions) {
            shortcutAction.destroy();
        }

        this.clientManager.destroy();
        this.desktopManager.destroy();
    }

    onScreenResized() {
        this.screenResizedDelayer.run();
    }
}

// ============================================================================
// Состояния клиентов (ClientState)
// ============================================================================
// ClientState.Docked
var ClientState;
(function(ClientState) {
    class Docked {
        constructor(world, kwinClient) {
            this.world = world;
            this.signalManager = Docked.initSignalManager(world, kwinClient);
            world.onScreenResized();
        }

        destroy(passFocus) {
            this.signalManager.destroy();
            this.world.onScreenResized();
        }

        static initSignalManager(world, kwinClient) {
            const manager = new SignalManager();
            manager.connect(kwinClient.frameGeometryChanged, () => {
                world.onScreenResized();
            });
            return manager;
        }
    }
    ClientState.Docked = Docked;
})(ClientState || (ClientState = {}));

// Плавающие окна
var ClientState;
(function(ClientState) {
    class Floating {
        constructor(world, client, config, limitHeight) {
            this.client = client;
            this.config = config;

            if (config.floatingKeepAbove) {
                client.kwinClient.keepAbove = true;
            }

            if (limitHeight && client.kwinClient.tile === null) {
                Floating.limitHeight(client);
            }

            this.signalManager = Floating.initSignalManager(world, client.kwinClient);
        }

        destroy(passFocus) {
            this.signalManager.destroy();
        }

        static limitHeight(client) {
            const placementArea = Workspace.clientArea(
                0, // ClientAreaOption.PlacementArea
                client.kwinClient.output,
                Clients.getKwinDesktopApprox(client.kwinClient)
            );

            const clientRect = client.kwinClient.frameGeometry;
            const width = client.preferredWidth;

            client.place(
                clientRect.x,
                clientRect.y,
                width,
                Math.min(clientRect.height, Math.round(placementArea.height / 2))
            );
        }

        static initSignalManager(world, kwinClient) {
            const manager = new SignalManager();

            manager.connect(kwinClient.tileChanged, () => {
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                }
            });

            return manager;
        }
    }
    ClientState.Floating = Floating;
})(ClientState || (ClientState = {}));

// Менеджер состояний
var ClientState;
(function(ClientState) {
    class Manager {
        constructor(initialState) {
            this.state = initialState;
        }

        setState(constructNewState, passFocus) {
            this.state.destroy(passFocus);
            this.state = constructNewState();
        }

        getState() {
            return this.state;
        }

        destroy(passFocus) {
            this.state.destroy(passFocus);
        }
    }
    ClientState.Manager = Manager;
})(ClientState || (ClientState = {}));

// Закрепленные окна
var ClientState;
(function(ClientState) {
    class Pinned {
        constructor(world, pinManager, desktopManager, kwinClient, config) {
            this.kwinClient = kwinClient;
            this.pinManager = pinManager;
            this.desktopManager = desktopManager;
            this.config = config;

            if (config.floatingKeepAbove) {
                kwinClient.keepAbove = true;
            }

            this.signalManager = Pinned.initSignalManager(world, pinManager, kwinClient);
        }

        destroy(passFocus) {
            this.signalManager.destroy();
            this.pinManager.removeClient(this.kwinClient);

            for (const desktop of this.desktopManager.getDesktopsForClient(this.kwinClient)) {
                desktop.onPinsChanged();
            }
        }

        static initSignalManager(world, pinManager, kwinClient) {
            const manager = new SignalManager();
            let oldActivities = kwinClient.activities;
            let oldDesktops = kwinClient.desktops;

            manager.connect(kwinClient.tileChanged, () => {
                if (kwinClient.tile === null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.unpinClient(kwinClient);
                    });
                }
            });

            manager.connect(kwinClient.frameGeometryChanged, () => {
                if (kwinClient.tile === null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.unpinClient(kwinClient);
                    });
                    return;
                }

                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktopsForClient(kwinClient)) {
                        desktop.onPinsChanged();
                    }
                });
            });

            manager.connect(kwinClient.minimizedChanged, () => {
                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktopsForClient(kwinClient)) {
                        desktop.onPinsChanged();
                    }
                });
            });

            manager.connect(kwinClient.desktopsChanged, () => {
                const changedDesktops = oldDesktops.length === 0 || kwinClient.desktops.length === 0
                    ? []
                    : union(oldDesktops, kwinClient.desktops);

                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktops(kwinClient.activities, changedDesktops)) {
                        desktop.onPinsChanged();
                    }
                });

                oldDesktops = kwinClient.desktops;
            });

            manager.connect(kwinClient.activitiesChanged, () => {
                const changedActivities = oldActivities.length === 0 || kwinClient.activities.length === 0
                    ? []
                    : union(oldActivities, kwinClient.activities);

                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktops(changedActivities, kwinClient.desktops)) {
                        desktop.onPinsChanged();
                    }
                });

                oldActivities = kwinClient.activities;
            });

            return manager;
        }
    }
    ClientState.Pinned = Pinned;
})(ClientState || (ClientState = {}));

// Тайловые окна (управляемые тайл-менеджером)
var ClientState;
(function(ClientState) {
    class Tiled {
        constructor(world, client, grid) {
            this.defaultState = {
                skipSwitcher: client.kwinClient.skipSwitcher
            };

            Tiled.prepareClientForTiling(client, grid.config);

            const column = new Column(
                grid,
                grid.getLastFocusedColumn() ?? grid.getLastColumn()
            );

            this.window = new Window(client, column);
            this.signalManager = Tiled.initSignalManager(world, this.window, grid.config);
        }

        destroy(passFocus) {
            this.signalManager.destroy();

            const window = this.window;
            const grid = window.column.grid;
            const client = window.client;

            window.destroy(passFocus);
            Tiled.restoreClientAfterTiling(client, grid.config, this.defaultState, grid.desktop.clientArea);
        }

        static initSignalManager(world, window, config) {
            const client = window.client;
            const kwinClient = client.kwinClient;
            const manager = new SignalManager();

            manager.connect(kwinClient.desktopsChanged, () => {
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(kwinClient);
                    if (desktop === undefined) {
                        // Windows on multiple desktops are not supported
                        clientManager.floatClient(client);
                        return;
                    }
                    Tiled.moveWindowToGrid(window, desktop.grid);
                });
            });

            manager.connect(kwinClient.activitiesChanged, () => {
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(kwinClient);
                    if (desktop === undefined) {
                        // Windows on multiple activities are not supported
                        clientManager.floatClient(client);
                        return;
                    }
                    Tiled.moveWindowToGrid(window, desktop.grid);
                });
            });

            manager.connect(kwinClient.minimizedChanged, () => {
                console.assert(kwinClient.minimized);
                world.do((clientManager, desktopManager) => {
                    clientManager.minimizeClient(kwinClient);
                });
            });

            manager.connect(kwinClient.maximizedAboutToChange, (maximizedMode) => {
                world.do(() => {
                    window.onMaximizedChanged(maximizedMode);
                });
            });

            let moving = false;
            let resizing = false;
            let resizeStartWidth = 0;
            let resizeNeighbor;

            manager.connect(kwinClient.interactiveMoveResizeStarted, () => {
                if (kwinClient.move) {
                    if (config.untileOnDrag) {
                        world.do((clientManager, desktopManager) => {
                            clientManager.floatClient(client);
                        });
                    } else {
                        moving = true;
                    }
                    return;
                }

                if (kwinClient.resize) {
                    resizing = true;
                    resizeStartWidth = window.column.getWidth();

                    if (config.resizeNeighborColumn) {
                        const resizeNeighborColumn = Tiled.getResizeNeighborColumn(window);
                        if (resizeNeighborColumn !== null) {
                            resizeNeighbor = {
                                column: resizeNeighborColumn,
                                startWidth: resizeNeighborColumn.getWidth(),
                            };
                        }
                    }

                    window.column.grid.onUserResizeStarted();
                }
            });

            manager.connect(kwinClient.interactiveMoveResizeFinished, () => {
                if (moving) {
                    moving = false;
                    world.do(() => window.column.grid.desktop.onLayoutChanged());
                }

                if (resizing) {
                    resizing = false;
                    resizeNeighbor = undefined;
                    window.column.grid.onUserResizeFinished();
                }
            });

            const externalFrameGeometryChangedRateLimiter = new RateLimiter(
                4,
                Tiled.MAX_EXTERNAL_FRAME_GEOMETRY_CHANGED_INTERVAL_MS
            );

            manager.connect(kwinClient.frameGeometryChanged, (oldGeometry) => {
                // On Wayland, this fires after `tileChanged`
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                    return;
                }

                const newGeometry = client.kwinClient.frameGeometry;
                const oldCenterX = oldGeometry.x + oldGeometry.width / 2;
                const oldCenterY = oldGeometry.y + oldGeometry.height / 2;
                const newCenterX = newGeometry.x + newGeometry.width / 2;
                const newCenterY = newGeometry.y + newGeometry.height / 2;

                const dx = Math.round(newCenterX - oldCenterX);
                const dy = Math.round(newCenterY - oldCenterY);

                if (dx !== 0 || dy !== 0) {
                    client.moveTransients(dx, dy);
                }

                if (kwinClient.resize) {
                    world.do(() => {
                        if (newGeometry.width !== oldGeometry.width) {
                            window.column.onUserResizeWidth(
                                resizeStartWidth,
                                newGeometry.width - resizeStartWidth,
                                newGeometry.left !== oldGeometry.left,
                                resizeNeighbor
                            );
                        }

                        if (newGeometry.height !== oldGeometry.height) {
                            window.column.adjustWindowHeight(
                                window,
                                newGeometry.height - oldGeometry.height,
                                newGeometry.y !== oldGeometry.y
                            );
                        }
                    });
                } else if (
                    !window.column.grid.isUserResizing() &&
                    !client.isManipulatingGeometry(newGeometry) &&
                    client.getMaximizedMode() === 0 && // MaximizedMode.Unmaximized
                    !Clients.isFullScreenGeometry(kwinClient)
                ) {
                    if (externalFrameGeometryChangedRateLimiter.acquire()) {
                        world.do(() => window.onFrameGeometryChanged());
                    }
                }
            });

            manager.connect(kwinClient.fullScreenChanged, () => {
                world.do((clientManager, desktopManager) => {
                    // Some clients only turn out to be untileable after exiting full-screen mode
                    if (!Clients.canTileEver(kwinClient)) {
                        clientManager.floatClient(client);
                        return;
                    }
                    window.onFullScreenChanged(kwinClient.fullScreen);
                });
            });

            manager.connect(kwinClient.tileChanged, () => {
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                }
            });

            return manager;
        }

        static getResizeNeighborColumn(window) {
            const kwinClient = window.client.kwinClient;
            const column = window.column;
            const cursorPos = Workspace.cursorPos;

            if (cursorPos.x > kwinClient.clientGeometry.right) {
                return column.grid.getRightColumn(column);
            } else if (cursorPos.x < kwinClient.clientGeometry.left) {
                return column.grid.getLeftColumn(column);
            } else {
                return null;
            }
        }

        static moveWindowToGrid(window, grid) {
            if (grid === window.column.grid) {
                // Window already on the given grid
                return;
            }

            const newColumn = new Column(
                grid,
                grid.getLastFocusedColumn() ?? grid.getLastColumn()
            );

            const passFocus = window.isFocused()
                ? 2 // FocusPassing.Type.OnUnfocus
                : 0; // FocusPassing.Type.None

            window.moveToColumn(newColumn, true, passFocus);
        }

        static prepareClientForTiling(client, config) {
            if (config.skipSwitcher) {
                client.kwinClient.skipSwitcher = true;
            }

            if (client.kwinClient.fullScreen) {
                if (config.maximizedKeepAbove) {
                    client.kwinClient.keepAbove = true;
                }
            } else {
                if (config.tiledKeepBelow) {
                    client.kwinClient.keepBelow = true;
                }
                client.kwinClient.keepAbove = false;
            }

            if (client.kwinClient.tile !== null) {
                client.setMaximize(false, true); // Disable quick tile mode
            }

            client.setMaximize(false, false);
        }

        static restoreClientAfterTiling(client, config, defaultState, screenSize) {
            if (config.skipSwitcher) {
                client.kwinClient.skipSwitcher = defaultState.skipSwitcher;
            }

            if (config.tiledKeepBelow) {
                client.kwinClient.keepBelow = false;
            }

            if (config.offScreenOpacity < 1.0) {
                client.kwinClient.opacity = 1.0;
            }

            client.setFullScreen(false);

            if (client.kwinClient.tile === null) {
                client.setMaximize(false, false);
            }

            client.ensureVisible(screenSize);
        }
    }

    Tiled.MAX_EXTERNAL_FRAME_GEOMETRY_CHANGED_INTERVAL_MS = 1000;

    ClientState.Tiled = Tiled;
})(ClientState || (ClientState = {}));

// Свернутые тайловые окна
var ClientState;
(function(ClientState) {
    class TiledMinimized {
        constructor(world, client) {
            this.signalManager = TiledMinimized.initSignalManager(world, client);
        }

        destroy(passFocus) {
            this.signalManager.destroy();
        }

        static initSignalManager(world, client) {
            const manager = new SignalManager();

            manager.connect(client.kwinClient.minimizedChanged, () => {
                console.assert(!client.kwinClient.minimized);
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(client.kwinClient);
                    if (desktop !== undefined) {
                        clientManager.tileClient(client, desktop.grid);
                    } else {
                        clientManager.floatClient(client);
                    }
                });
            });

            return manager;
        }
    }
    ClientState.TiledMinimized = TiledMinimized;
})(ClientState || (ClientState = {}));

// ============================================================================
// Точка входа и инициализация
// ============================================================================

function init() {
    return new World(loadConfig());
}

function loadConfig() {
    const config = {};
    for (const entry of configDef) {
        config[entry.name] = KWin.readConfig(entry.name, entry.default);
    }
    return config;
}

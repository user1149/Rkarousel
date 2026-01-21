"use strict";

/**
 * Класс Actions управляет всеми пользовательскими действиями тайлинга
 * Включает фокусировку, перемещение окон, изменение размеров, прокрутку и работу с рабочими столами
 * 
 * @class
 */
class Actions {
    /**
     * Инициализирует Actions с конфигурацией
     * @param {Object} config - Конфигурация действий
     */
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

    _initWindowMoveActions() {
        this.windowMoveLeft = (cm, dm, window, column, grid) => {
            if (column.getWindowCount() === 1) {
                const leftColumn = grid.getLeftColumn(column);
                if (leftColumn === null) return;
                window.moveToColumn(leftColumn, true, 0);
                grid.desktop.autoAdjustScroll();
            } else {
                const newColumn = new Column(grid, grid.getLeftColumn(column));
                window.moveToColumn(newColumn, true, 0);
            }
        };

        this.windowMoveRight = (cm, dm, window, column, grid, bottom = true) => {
            if (column.getWindowCount() === 1) {
                const rightColumn = grid.getRightColumn(column);
                if (rightColumn === null) return;
                window.moveToColumn(rightColumn, bottom, 0);
                grid.desktop.autoAdjustScroll();
            } else {
                const newColumn = new Column(grid, column);
                window.moveToColumn(newColumn, true, 0);
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
            window.moveToColumn(newColumn, true, 0);
        };

        this.windowMoveEnd = (cm, dm, window, column, grid) => {
            const newColumn = new Column(grid, grid.getLastColumn());
            window.moveToColumn(newColumn, true, 0);
        };

        this.windowToggleFloating = (cm, dm) => {
            if (Workspace.activeWindow === null) return;
            cm.toggleFloatingClient(Workspace.activeWindow);
        };
    }

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

            window.moveToColumn(targetColumn, true, 0);
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
            "should at least contain the focused column"
        );

        let targetColumn, wantedVisibleColumns;

        if (direction === 'left') {
            targetColumn = grid.getLeftColumn(currentVisibleColumns[0]);
            if (targetColumn === null) return;
            wantedVisibleColumns = [targetColumn, ...currentVisibleColumns];
        } else {
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

            if (removedColumn === focusedColumn) break;
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
            return false;
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

"use strict";

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

var Range;
(function (Range) {
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

    Range.create = create;
    Range.fromRanges = fromRanges;
    Range.contains = contains;
    Range.minus = minus;
})(Range || (Range = {}));

class Grid {
    constructor(desktop, config, focusPasser) {
        this.desktop = desktop;
        this.config = config;
        this.focusPasser = focusPasser;

        this.columns = new LinkedList();
        this.lastFocusedColumn = null;
        this.width = 0;

        this.userResize = false;
        this.userResizeFinishedDelayer = new Delayer(50, () => {
            this.desktop.onLayoutChanged();
            this.desktop.autoAdjustScroll();
            this.desktop.arrange();
        });
    }

    destroy() {
        this.userResizeFinishedDelayer.destroy();
    }

    moveColumn(column, leftColumn) {
        if (column === leftColumn) {
            return;
        }

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
            return;
        }
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

    columnsSetX(startColumn) {
        const prevColumn = startColumn === null ? this.columns.getLast() : this.columns.getPrev(startColumn);

        let currentX = 0;

        if (prevColumn !== null) {
            currentX = prevColumn.getRight() + this.config.gapsInnerHorizontal;
        }

        if (startColumn !== null) {
            for (const column of this.columns.iteratorFrom(startColumn)) {
                column.gridX = currentX;
                currentX += column.getWidth() + this.config.gapsInnerHorizontal;
            }
        }

        this.width = currentX > 0 ? currentX - this.config.gapsInnerHorizontal : 0;
    }

    arrange(x, visibleRange) {
        const RENDER_BUFFER = 500;
        const viewStart = visibleRange.getLeft() - RENDER_BUFFER;
        const viewEnd = visibleRange.getRight() + RENDER_BUFFER;

        const gap = this.config.gapsInnerHorizontal;
        const lazy = this.config.scrollingLazy;

        for (const column of this.columns.iterator()) {
            const colWidth = column.getWidth();
            const colStart = x;
            const colEnd = x + colWidth;

            const isVisible = (colEnd > viewStart) && (colStart < viewEnd);

            if (isVisible || !lazy) {
                column.arrange(x, visibleRange, this.userResize);
            }

            x += colWidth + gap;
        }

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

    getLastFocusedColumn() {
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

        if (lastFocusedColumn !== null) {
            lastFocusedColumn.restoreToTiled(window);
        }

        this.lastFocusedColumn = column;
        this.desktop.scrollToColumn(column, false);
    }

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

Desktop.ColumnRange = ColumnRange;

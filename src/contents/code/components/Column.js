"use strict";

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

        if (windowCount === 1) {
            this.stacked = this.grid.config.stackColumnsByDefault;
        }

        const { gapsInnerVertical } = this.grid.config;
        const totalHeight = this.grid.desktop.tilingArea.height;

        const availableSpace = totalHeight - (windowCount - 1) * gapsInnerVertical;

        const constraints = [];
        const windowsList = [];

        for (const window of this.windows.iterator()) {
            const minHeight = window.client.kwinClient.minSize.height;

            constraints.push({
                min: minHeight > 0 ? minHeight : 1,
                max: availableSpace
            });
            windowsList.push(window);
        }

        const heights = fillSpace(availableSpace, constraints);

        windowsList.forEach((window, index) => {
            window.height = heights[index];
        });

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

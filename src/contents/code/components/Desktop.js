"use strict";

class Desktop {
    constructor(kwinDesktop, pinManager, config, getScreen, layoutConfig, focusPasser) {
        this.scrollX = 0;
        this.gestureScrollXInitial = null;

        this.dirty = true;
        this.dirtyScroll = true;
        this.dirtyPins = true;

        this.kwinDesktop = kwinDesktop;
        this.pinManager = pinManager;
        this.config = config;
        this.getScreen = getScreen;

        this.grid = new Grid(this, layoutConfig, focusPasser);
        this.clientArea = Desktop.getClientArea(this.getScreen(), kwinDesktop);
        this.tilingArea = Desktop.getTilingArea(this.clientArea, kwinDesktop, pinManager, config);
    }

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
        return Workspace.clientArea(0, screen, kwinDesktop);
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

    arrange() {
        this.updateArea();

        if (!this.dirty) {
            return;
        }

        const x = this.tilingArea.x - this.scrollX;
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

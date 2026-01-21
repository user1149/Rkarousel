"use strict";

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

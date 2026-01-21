"use strict";

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

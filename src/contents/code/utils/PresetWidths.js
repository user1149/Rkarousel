"use strict";

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
            console.assert(false);
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
            console.assert(false);
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

"use strict";

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

"use strict";

// Helper functions
function log(...args) {
    console.log("Karousel:", ...args);
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

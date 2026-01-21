"use strict";

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
        let node = null;
        try {
            node = this.getNode(startItem);
        } catch (e) { return []; }

        for (; node !== null; node = node.next) {
            result.push(node.item);
        }
        return result;
    }
}

(function (LinkedList) {
    class Node {
        constructor(item) {
            this.item = item;
            this.prev = null;
            this.next = null;
        }
    }
    LinkedList.Node = Node;
})(LinkedList || (LinkedList = {}));

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

class Delayer {
    constructor(delay, f) {
        this.timer = Delayer.initQmlTimer();
        this.timer.interval = delay;
        this.timer.triggered.connect(f);
    }

    run() {
        this.timer.restart();
    }

    destroy() {
        this.timer.destroy();
    }

    static initQmlTimer() {
        return Qt.createQmlObject(`import QtQuick 6.0
        Timer {}`, qmlBase);
    }
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
            this.nCalls--;
        }
    }
    isDoing() {
        return this.nCalls > 0;
    }
}

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

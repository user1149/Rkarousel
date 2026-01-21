"use strict";

/**
 * DesktopManager управляет рабочими столами и их раскладками
 * Отслеживает виртуальные рабочие столы, активности и выбранный экран
 * Координирует раскладку окон и переходы между рабочими столами
 * 
 * @class
 */
class DesktopManager {
    /**
     * Инициализирует DesktopManager
     * @param {PinManager} pinManager - Менеджер закреплённых окон
     * @param {Object} config - Конфигурация рабочего стола
     * @param {Object} layoutConfig - Конфигурация раскладки
     * @param {FocusPassing.Passer} focusPasser - Обработчик передачи фокуса
     * @param {DesktopFilter} desktopFilter - Фильтр для выбора рабочих столов
     */
    constructor(pinManager, config, layoutConfig, focusPasser, desktopFilter) {
        this.pinManager = pinManager;
        this.config = config;
        this.layoutConfig = layoutConfig;
        this.focusPasser = focusPasser;
        this.desktopFilter = desktopFilter;

        this.desktops = new Map();
        this.selectedScreen = Workspace.activeScreen;
        this.kwinActivities = new Set(Workspace.activities);
        this.kwinDesktops = new Set(Workspace.desktops);
    }

    getDesktop(activity, kwinDesktop) {
        if (!this.desktopFilter.shouldWorkOnDesktop(kwinDesktop)) {
            return undefined;
        }

        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = this.desktops.get(desktopKey);

        if (desktop !== undefined) {
            return desktop;
        }

        return this.addDesktop(activity, kwinDesktop);
    }

    getCurrentDesktop() {
        return this.getDesktop(Workspace.currentActivity, Workspace.currentDesktop);
    }

    getDesktopInCurrentActivity(kwinDesktop) {
        return this.getDesktop(Workspace.currentActivity, kwinDesktop);
    }

    getDesktopForClient(kwinClient) {
        const activities = kwinClient.activities || [];
        const desktops = kwinClient.desktops || [];

        if (activities.length !== 1 || desktops.length !== 1) {
            return undefined;
        }

        return this.getDesktop(activities[0], desktops[0]);
    }

    addDesktop(activity, kwinDesktop) {
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = new Desktop(
            kwinDesktop,
            this.pinManager,
            this.config,
            () => this.selectedScreen,
            this.layoutConfig,
            this.focusPasser
        );

        this.desktops.set(desktopKey, desktop);
        return desktop;
    }

    static getDesktopKey(activity, kwinDesktop) {
        return `${activity}|${kwinDesktop.id}`;
    }

    updateActivities() {
        const newActivities = new Set(Workspace.activities);

        for (const activity of this.kwinActivities) {
            if (!newActivities.has(activity)) {
                this.removeActivity(activity);
            }
        }

        this.kwinActivities = newActivities;
    }

    updateDesktops() {
        const newDesktops = new Set(Workspace.desktops);

        for (const desktop of this.kwinDesktops) {
            if (!newDesktops.has(desktop)) {
                this.removeKwinDesktop(desktop);
            }
        }

        this.kwinDesktops = newDesktops;
    }

    selectScreen(screen) {
        this.selectedScreen = screen;
    }

    removeActivity(activity) {
        for (const kwinDesktop of this.kwinDesktops) {
            this.destroyDesktop(activity, kwinDesktop);
        }
    }

    removeKwinDesktop(kwinDesktop) {
        for (const activity of this.kwinActivities) {
            this.destroyDesktop(activity, kwinDesktop);
        }
    }

    destroyDesktop(activity, kwinDesktop) {
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = this.desktops.get(desktopKey);

        if (desktop !== undefined) {
            desktop.destroy();
            this.desktops.delete(desktopKey);
        }
    }

    destroy() {
        for (const desktop of this.desktops.values()) {
            desktop.destroy();
        }
    }

    *getAllDesktops() {
        for (const desktop of this.desktops.values()) {
            yield desktop;
        }
    }

    getDesktopsForClient(kwinClient) {
        const activities = kwinClient.activities || [];
        const desktops = kwinClient.desktops || [];
        return this.getDesktops(activities, desktops);
    }

    *getDesktops(activities, kwinDesktops) {
        const matchedActivities = activities.length > 0 ? activities : this.kwinActivities;
        const matchedDesktops = kwinDesktops.length > 0 ? kwinDesktops : this.kwinDesktops;

        for (const activity of matchedActivities) {
            for (const desktop of matchedDesktops) {
                const desktopKey = DesktopManager.getDesktopKey(activity, desktop);
                const desktopObj = this.desktops.get(desktopKey);

                if (desktopObj !== undefined) {
                    yield desktopObj;
                }
            }
        }
    }
}

var FocusPassing;
(function (FocusPassing) {
    FocusPassing.Type = {
        None: 0,
        Immediate: 1,
        OnUnfocus: 2
    };

    class Passer {
        constructor() {
            this.currentRequest = null;
        }

        request(target) {
            this.currentRequest = new Request(target, Date.now());
        }

        clear() {
            this.currentRequest = null;
        }

        clearIfDifferent(kwinClient) {
            if (this.currentRequest !== null && this.currentRequest.target !== kwinClient) {
                this.clear();
            }
        }

        activate() {
            if (this.currentRequest === null) {
                return;
            }

            if (this.currentRequest.isExpired()) {
                this.clear();
                return;
            }

            if (Workspace.activeWindow !== null && Workspace.activeWindow !== this.currentRequest.target) {
                this.clear();
                return;
            }

            Workspace.activeWindow = this.currentRequest.target;
        }
    }
    FocusPassing.Passer = Passer;

    class Request {
        constructor(target, time) {
            this.target = target;
            this.time = time;
        }

        isExpired() {
            const elapsedTime = Date.now() - this.time;
            return elapsedTime > Request.VALID_MS;
        }
    }
    Request.VALID_MS = 200;
})(FocusPassing || (FocusPassing = {}));

class PinManager {
    constructor() {
        this.pinnedClients = new Set();
    }

    addClient(kwinClient) {
        this.pinnedClients.add(kwinClient);
    }

    removeClient(kwinClient) {
        this.pinnedClients.delete(kwinClient);
    }

    getAvailableSpace(kwinDesktop, screen) {
        const baseLot = new PinManager.Lot(screen.top, screen.bottom, screen.left, screen.right);
        let availableLots = [baseLot];

        for (const client of this.pinnedClients) {
            if (!this.shouldConsiderClient(client, kwinDesktop)) {
                continue;
            }

            availableLots = this.splitLotsAroundClient(availableLots, client);
        }

        return this.findLargestLot(availableLots);
    }

    shouldConsiderClient(client, kwinDesktop) {
        return !Clients.isOnVirtualDesktop(client, kwinDesktop) || client.minimized;
    }

    splitLotsAroundClient(lots, client) {
        const newLots = [];

        for (const lot of lots) {
            lot.split(newLots, client.frameGeometry);
        }

        return newLots;
    }

    findLargestLot(lots) {
        let largestLot = lots[0] || null;
        let largestArea = 0;

        for (const lot of lots) {
            const area = lot.area();

            if (area > largestArea) {
                largestArea = area;
                largestLot = lot;
            }
        }

        return largestLot;
    }
}

(function (PinManager) {
    class Lot {
        constructor(top, bottom, left, right) {
            this.top = top;
            this.bottom = bottom;
            this.left = left;
            this.right = right;
        }

        split(destLots, obstacle) {
            if (!this.contains(obstacle)) {
                destLots.push(this);
                return;
            }

            this.splitVertically(destLots, obstacle);
            this.splitHorizontally(destLots, obstacle);
        }

        splitVertically(destLots, obstacle) {
            if (obstacle.top - this.top >= Lot.MIN_HEIGHT) {
                destLots.push(new Lot(this.top, obstacle.top, this.left, this.right));
            }

            if (this.bottom - obstacle.bottom >= Lot.MIN_HEIGHT) {
                destLots.push(new Lot(obstacle.bottom, this.bottom, this.left, this.right));
            }
        }

        splitHorizontally(destLots, obstacle) {
            if (obstacle.left - this.left >= Lot.MIN_WIDTH) {
                destLots.push(new Lot(this.top, this.bottom, this.left, obstacle.left));
            }

            if (this.right - obstacle.right >= Lot.MIN_WIDTH) {
                destLots.push(new Lot(this.top, this.bottom, obstacle.right, this.right));
            }
        }

        contains(obstacle) {
            return obstacle.right > this.left &&
                obstacle.left < this.right &&
                obstacle.bottom > this.top &&
                obstacle.top < this.bottom;
        }

        area() {
            const height = this.bottom - this.top;
            const width = this.right - this.left;
            return height * width;
        }
    }

    Lot.MIN_WIDTH = 200;
    Lot.MIN_HEIGHT = 200;

    PinManager.Lot = Lot;
})(PinManager || (PinManager = {}));

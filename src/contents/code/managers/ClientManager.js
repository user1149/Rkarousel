"use strict";

var Clients = (function () {
    const prohibitedClasses = [
        "ksmserver-logout-greeter",
        "xwaylandvideobridge",
    ];

    function canTileEver(kwinClient) {
        const isShapeable = (kwinClient.moveable && kwinClient.resizeable) ||
            kwinClient.fullScreen;

        return isShapeable &&
            !kwinClient.popupWindow &&
            !prohibitedClasses.includes(kwinClient.resourceClass);
    }

    function canTileNow(kwinClient) {
        return canTileEver(kwinClient) &&
            !kwinClient.minimized &&
            kwinClient.desktops.length === 1 &&
            kwinClient.activities.length === 1;
    }

    function makeTileable(kwinClient) {
        if (kwinClient.minimized) {
            kwinClient.minimized = false;
        }

        if (kwinClient.desktops.length !== 1) {
            kwinClient.desktops = [Workspace.currentDesktop];
        }

        if (kwinClient.activities.length !== 1) {
            kwinClient.activities = [Workspace.currentActivity];
        }
    }

    function getKwinDesktopApprox(kwinClient) {
        const desktops = kwinClient.desktops;

        switch (desktops.length) {
            case 0:
                return Workspace.currentDesktop;
            case 1:
                return desktops[0];
            default:
                if (desktops.includes(Workspace.currentDesktop)) {
                    return Workspace.currentDesktop;
                } else {
                    return desktops[0];
                }
        }
    }

    function isFullScreenGeometry(kwinClient) {
        const fullScreenArea = Workspace.clientArea(
            4,
            kwinClient.output,
            getKwinDesktopApprox(kwinClient)
        );

        const clientGeometry = kwinClient.clientGeometry;
        return clientGeometry.width >= fullScreenArea.width &&
            clientGeometry.height >= fullScreenArea.height;
    }

    function isOnVirtualDesktop(kwinClient, kwinDesktop) {
        return kwinClient.desktops.length === 0 ||
            kwinClient.desktops.includes(kwinDesktop);
    }

    function isOnOneOfVirtualDesktops(kwinClient, kwinDesktops) {
        return kwinClient.desktops.length === 0 ||
            kwinClient.desktops.some(desktop => kwinDesktops.includes(desktop));
    }

    return {
        canTileEver: canTileEver,
        canTileNow: canTileNow,
        makeTileable: makeTileable,
        getKwinDesktopApprox: getKwinDesktopApprox,
        isFullScreenGeometry: isFullScreenGeometry,
        isOnVirtualDesktop: isOnVirtualDesktop,
        isOnOneOfVirtualDesktops: isOnOneOfVirtualDesktops
    };
})();

class ClientWrapper {
    constructor(kwinClient, constructInitialState, transientFor, rulesSignalManager) {
        this.kwinClient = kwinClient;
        this.transientFor = transientFor;
        this.transients = [];
        this.rulesSignalManager = rulesSignalManager;
        this.signalManager = null;
        this.manipulatingGeometry = new Doer();
        this.lastPlacement = null;
        this.maximizedMode = undefined;

        this.initializeTransientRelationship(transientFor);
        this.initializeSignals();
        this.initializeState(constructInitialState);
    }

    initializeTransientRelationship(transientFor) {
        if (transientFor !== null) {
            transientFor.addTransient(this);
        }
    }

    initializeSignals() {
        this.signalManager = ClientWrapper.createSignalManager(this);
    }

    initializeState(constructInitialState) {
        this.preferredWidth = this.kwinClient.frameGeometry.width;
        this.stateManager = new ClientState.Manager(constructInitialState(this));
    }

    static createSignalManager(client) {
        const manager = new SignalManager();

        manager.connect(client.kwinClient.maximizedAboutToChange, (maximizedMode) => {
            if (maximizedMode !== 0 && client.kwinClient.tile !== null) {
                client.kwinClient.tile = null;
            }
            client.maximizedMode = maximizedMode;
        });

        return manager;
    }

    place(x, y, width, height) {
        this.manipulatingGeometry.do(() => {
            if (this.kwinClient.resize) {
                return;
            }

            this.lastPlacement = Qt.rect(x, y, width, height);
            this.applyPlacementWithWaylandWorkaround();
        });
    }

    applyPlacementWithWaylandWorkaround() {
        this.kwinClient.frameGeometry = this.lastPlacement;
    }

    moveTransient(dx, dy, kwinDesktops) {
        if (!(this.stateManager.getState() instanceof ClientState.Floating)) {
            return;
        }

        if (Clients.isOnOneOfVirtualDesktops(this.kwinClient, kwinDesktops)) {
            this.moveWindowBy(dx, dy);
        }

        this.moveChildTransients(dx, dy, kwinDesktops);
    }

    moveWindowBy(dx, dy) {
        const frame = this.kwinClient.frameGeometry;
        this.kwinClient.frameGeometry = Qt.rect(
            frame.x + dx,
            frame.y + dy,
            frame.width,
            frame.height
        );
    }

    moveChildTransients(dx, dy, kwinDesktops) {
        for (const transient of this.transients) {
            transient.moveTransient(dx, dy, kwinDesktops);
        }
    }

    moveTransients(dx, dy) {
        for (const transient of this.transients) {
            transient.moveTransient(dx, dy, this.kwinClient.desktops);
        }
    }

    focus() {
        Workspace.activeWindow = this.kwinClient;
    }

    isFocused() {
        return Workspace.activeWindow === this.kwinClient;
    }

    setMaximize(horizontally, vertically) {
        if (!this.kwinClient.maximizable) {
            this.maximizedMode = 0;
            return;
        }

        this.updateMaximizedMode(horizontally, vertically);
        this.applyMaximization(horizontally, vertically);
    }

    updateMaximizedMode(horizontally, vertically) {
        if (this.maximizedMode !== undefined) return;

        if (horizontally && vertically) {
            this.maximizedMode = 3;
        } else if (horizontally) {
            this.maximizedMode = 2;
        } else if (vertically) {
            this.maximizedMode = 1;
        } else {
            this.maximizedMode = 0;
        }
    }

    applyMaximization(horizontally, vertically) {
        this.manipulatingGeometry.do(() => {
            this.kwinClient.setMaximize(vertically, horizontally);
        });
    }

    setFullScreen(fullScreen) {
        if (!this.kwinClient.fullScreenable) {
            return;
        }

        this.manipulatingGeometry.do(() => {
            this.kwinClient.fullScreen = fullScreen;
        });
    }

    getMaximizedMode() {
        return this.maximizedMode;
    }

    isManipulatingGeometry(newGeometry) {
        if (newGeometry !== null && newGeometry === this.lastPlacement) {
            return true;
        }
        return this.manipulatingGeometry.isDoing();
    }

    addTransient(transient) {
        this.transients.push(transient);
    }

    removeTransient(transient) {
        const index = this.transients.indexOf(transient);
        if (index !== -1) {
            this.transients.splice(index, 1);
        }
    }

    ensureTransientsVisible(screenSize) {
        for (const transient of this.transients) {
            if (transient.stateManager.getState() instanceof ClientState.Floating) {
                transient.ensureVisible(screenSize);
                transient.ensureTransientsVisible(screenSize);
            }
        }
    }

    ensureVisible(screenSize) {
        if (!Clients.isOnVirtualDesktop(this.kwinClient, Workspace.currentDesktop)) {
            return;
        }

        const frame = this.kwinClient.frameGeometry;

        if (frame.left < screenSize.left) {
            frame.x = screenSize.left;
        } else if (frame.right > screenSize.right) {
            frame.x = screenSize.right - frame.width;
        }
    }

    destroy(passFocus) {
        this.stateManager.destroy(passFocus);
        this.signalManager.destroy();

        if (this.rulesSignalManager !== null) {
            this.rulesSignalManager.destroy();
        }

        if (this.transientFor !== null) {
            this.transientFor.removeTransient(this);
        }

        this.clearTransientRelationships();
    }

    clearTransientRelationships() {
        for (const transient of this.transients) {
            transient.transientFor = null;
        }
    }
}

/**
 * ClientManager управляет всеми окнами KWin
 * Отслеживает добавление/удаление окон, фокусировку, состояния окон
 * Координирует размещение окон в рабочих столах через DesktopManager
 * 
 * @class
 */
class ClientManager {
    /**
     * Инициализирует ClientManager
     * @param {Object} config - Конфигурация плагина
     * @param {World} world - Главный объект плагина
     * @param {DesktopManager} desktopManager - Менеджер рабочих столов
     * @param {PinManager} pinManager - Менеджер закреплённых окон
     */
    constructor(config, world, desktopManager, pinManager) {
        this.config = config;
        this.world = world;
        this.desktopManager = desktopManager;
        this.pinManager = pinManager;

        this.clientMap = new Map();
        this.lastFocusedClient = null;

        this.windowRuleEnforcer = this.initializeWindowRuleEnforcer(config);
    }

    initializeWindowRuleEnforcer(config) {
        try {
            const parsedWindowRules = JSON.parse(config.windowRules);
            return new WindowRuleEnforcer(parsedWindowRules);
        } catch (error) {
            // Попытка отправить уведомление если qmlBase доступен
            if (typeof globalThis.qmlBase !== 'undefined' && globalThis.qmlBase) {
                try {
                    if (globalThis.qmlBase.notificationInvalidWindowRules) {
                        globalThis.qmlBase.notificationInvalidWindowRules.sendEvent();
                    }
                } catch (notifError) {
                    log("Failed to send notification:", notifError);
                }
            }
            log("Failed to parse windowRules:", error);
            return new WindowRuleEnforcer([]);
        }
    }

    addClient(kwinClient) {
        console.assert(!this.hasClient(kwinClient));

        const client = this.createClientWrapper(kwinClient);
        this.clientMap.set(kwinClient, client);
    }

    createClientWrapper(kwinClient) {
        const constructState = this.determineInitialState(kwinClient);
        const transientFor = this.findTransientFor(kwinClient);
        const signalManager = this.windowRuleEnforcer.initClientSignalManager(this.world, kwinClient);

        return new ClientWrapper(kwinClient, constructState, transientFor, signalManager);
    }

    determineInitialState(kwinClient) {
        if (kwinClient.dock) {
            return (client) => new ClientState.Docked(this.world, kwinClient);
        }

        if (this.shouldBeTiled(kwinClient)) {
            Clients.makeTileable(kwinClient);
            console.assert(Clients.canTileNow(kwinClient));

            const desktop = this.desktopManager.getDesktopForClient(kwinClient);
            return (client) => new ClientState.Tiled(this.world, client, desktop.grid);
        }

        return (client) => new ClientState.Floating(this.world, client, this.config, false);
    }

    shouldBeTiled(kwinClient) {
        return Clients.canTileEver(kwinClient) &&
            this.windowRuleEnforcer.shouldTile(kwinClient) &&
            this.desktopManager.getDesktopForClient(kwinClient) !== undefined;
    }

    removeClient(kwinClient, passFocus) {
        console.assert(this.hasClient(kwinClient));

        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        if (kwinClient !== this.lastFocusedClient) {
            passFocus = FocusPassing.Type.None;
        }

        client.destroy(passFocus);
        this.clientMap.delete(kwinClient);
    }

    findTransientFor(kwinClient) {
        if (!kwinClient.transient || !kwinClient.transientFor) {
            return null;
        }

        return this.clientMap.get(kwinClient.transientFor) || null;
    }

    tileClient(client, grid) {
        if (client.stateManager.getState() instanceof ClientState.Tiled) {
            return;
        }

        client.stateManager.setState(
            () => new ClientState.Tiled(this.world, client, grid),
            FocusPassing.Type.None
        );
    }

    floatClient(client) {
        if (client.stateManager.getState() instanceof ClientState.Floating) {
            return;
        }

        client.stateManager.setState(
            () => new ClientState.Floating(this.world, client, this.config, true),
            FocusPassing.Type.None
        );
    }

    tileKwinClient(kwinClient, grid) {
        const client = this.clientMap.get(kwinClient);
        if (client) {
            this.tileClient(client, grid);
        }
    }

    floatKwinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (client) {
            this.floatClient(client);
        }
    }

    pinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        if (client.getMaximizedMode() !== 0) {
            kwinClient.tile = null;
            return;
        }

        client.stateManager.setState(
            () => new ClientState.Pinned(this.world, this.pinManager, this.desktopManager, kwinClient, this.config),
            FocusPassing.Type.None
        );

        this.pinManager.addClient(kwinClient);
        this.notifyDesktopsAboutPinChange(kwinClient);
    }

    unpinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        console.assert(client.stateManager.getState() instanceof ClientState.Pinned);

        client.stateManager.setState(
            () => new ClientState.Floating(this.world, client, this.config, false),
            FocusPassing.Type.None
        );

        this.pinManager.removeClient(kwinClient);
        this.notifyDesktopsAboutPinChange(kwinClient);
    }

    notifyDesktopsAboutPinChange(kwinClient) {
        for (const desktop of this.desktopManager.getDesktopsForClient(kwinClient)) {
            desktop.onPinsChanged();
        }
    }

    toggleFloatingClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        const clientState = client.stateManager.getState();

        if (this.canToggleToTiled(clientState, kwinClient)) {
            this.tileClient(client, this.getDesktopGridForClient(kwinClient));
        } else if (clientState instanceof ClientState.Tiled) {
            this.floatClient(client);
        }
    }

    canToggleToTiled(clientState, kwinClient) {
        return (clientState instanceof ClientState.Floating || clientState instanceof ClientState.Pinned) &&
            Clients.canTileEver(kwinClient);
    }

    getDesktopGridForClient(kwinClient) {
        Clients.makeTileable(kwinClient);
        const desktop = this.desktopManager.getDesktopForClient(kwinClient);
        return desktop ? desktop.grid : null;
    }

    hasClient(kwinClient) {
        return this.clientMap.has(kwinClient);
    }

    onClientFocused(kwinClient) {
        this.lastFocusedClient = kwinClient;

        const window = this.findTiledWindow(kwinClient);
        if (window) {
            window.onFocused();
        }
    }

    findTiledWindow(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        return client ? this.findTiledWindowOfClient(client) : null;
    }

    findTiledWindowOfClient(client) {
        const clientState = client.stateManager.getState();

        if (clientState instanceof ClientState.Tiled) {
            return clientState.window;
        }

        if (client.transientFor) {
            return this.findTiledWindowOfClient(client.transientFor);
        }

        return null;
    }

    removeAllClients() {
        for (const kwinClient of Array.from(this.clientMap.keys())) {
            this.removeClient(kwinClient, FocusPassing.Type.None);
        }
    }

    /**
     * Переводит окно из плиточного режима в минимизированное состояние
     * @param {KWin.Client} kwinClient - KWin клиент для минимизации
     */
    minimizeClient(kwinClient) {
        if (!this.clientMap) return;
        
        const client = this.clientMap.get(kwinClient);
        if (!client) return;

        const currentState = client.stateManager.getState();
        if (!(currentState instanceof ClientState.Tiled)) {
            return;
        }

        const passFocus = kwinClient === this.lastFocusedClient
            ? 1 // FocusPassing.Type.Immediate
            : 0; // FocusPassing.Type.None

        try {
            client.stateManager.setState(
                () => new ClientState.TiledMinimized(this.world, client),
                passFocus
            );
        } catch (error) {
            log("Error minimizing client:", error);
        }
    }

    destroy() {
        this.removeAllClients();
    }
}

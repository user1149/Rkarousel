"use strict";

console.log("load Rkarousel");

function initWorkspaceSignalHandlers(world, focusPasser) {
    const manager = new SignalManager();

    const handleWindow = (world, action) => (kwinClient) => {
        world.do((clientManager, desktopManager) => {
            action(clientManager, kwinClient);
        });
    };

    manager.connect(Workspace.windowAdded, handleWindow(world, (cm, client) => {
        cm.addClient(client);
    }));

    manager.connect(Workspace.windowRemoved, handleWindow(world, (cm, client) => {
        cm.removeClient(client, 1 /* FocusPassing.Type.Immediate */);
    }));

    manager.connect(Workspace.windowActivated, (kwinClient) => {
        if (kwinClient === null) {
            focusPasser.activate();
        } else {
            focusPasser.clearIfDifferent(kwinClient);
            world.do((clientManager) => {
                clientManager.onClientFocused(kwinClient);
            });
        }
    });

    manager.connect(Workspace.currentDesktopChanged, () => {
        world.do(() => { /* re-arrange desktop */ });
    });

    // Обновить геометрию при изменении активностей
    const handleActivityChange = () => {
        world.do((clientManager, desktopManager) => {
            desktopManager.updateActivities();
        });
    };
    
    manager.connect(Workspace.currentActivityChanged, handleActivityChange);
    manager.connect(Workspace.activitiesChanged, handleActivityChange);

    manager.connect(Workspace.desktopsChanged, () => {
        world.do((clientManager, desktopManager) => {
            desktopManager.updateDesktops();
        });
    });

    manager.connect(Workspace.virtualScreenSizeChanged, () => {
        world.onScreenResized();
    });

    return manager;
}

// ============================================================================
// Главный класс - World
// ============================================================================

class World {
    constructor(config) {
        const focusPasser = new FocusPassing.Passer();

        this.workspaceSignalManager = initWorkspaceSignalHandlers(this, focusPasser);

        this.presetWidths = this.createPresetWidths(config);
        this.shortcutActions = this.registerKeyBindings(config);
        this.screenResizedDelayer = this.createScreenResizedDelayer();

        this.pinManager = new PinManager();
        this.desktopManager = this.createDesktopManager(config, focusPasser);
        this.clientManager = this.createClientManager(config);

        this.addExistingClients();
        this.update();
    }

    createPresetWidths(config) {
        let presetWidths = {
            next: (currentWidth, minWidth, maxWidth) => currentWidth,
            prev: (currentWidth, minWidth, maxWidth) => currentWidth,
            getWidths: (minWidth, maxWidth) => [],
        };

        try {
            presetWidths = new PresetWidths(config.presetWidths, config.gapsInnerHorizontal);
        } catch (error) {
            // Попытка отправить уведомление если qmlBase доступен
            if (typeof globalThis.qmlBase !== 'undefined' && globalThis.qmlBase) {
                try {
                    if (globalThis.qmlBase.notificationInvalidPresetWidths) {
                        globalThis.qmlBase.notificationInvalidPresetWidths.sendEvent();
                    }
                } catch (notifError) {
                    log("Failed to send notification:", notifError);
                }
            }
            log("Failed to parse presetWidths:", error);
        }

        return presetWidths;
    }

    registerKeyBindings(config) {
        const columnResizer = config.scrollingCentered
            ? new RawResizer(this.presetWidths)
            : new ContextualResizer(this.presetWidths);

        const keyBindingConfig = {
            manualScrollStep: config.manualScrollStep,
            presetWidths: this.presetWidths,
            columnResizer: columnResizer,
        };

        // qmlBase будет передана из init() через глобальную переменную
        return registerKeyBindings(this, keyBindingConfig, typeof qmlBase !== 'undefined' ? qmlBase : null);
    }

    createScreenResizedDelayer() {
        return new Delayer(1000, () => {
            for (const desktop of this.desktopManager.getAllDesktops()) {
                desktop.onLayoutChanged();
            }
            this.update();
        });
    }

    createDesktopManager(config, focusPasser) {
        const layoutConfig = {
            gapsInnerHorizontal: config.gapsInnerHorizontal,
            gapsInnerVertical: config.gapsInnerVertical,
            stackOffsetX: config.stackOffsetX,
            stackOffsetY: config.stackOffsetY,
            offScreenOpacity: config.offScreenOpacity / 100.0,
            stackColumnsByDefault: config.stackColumnsByDefault,
            resizeNeighborColumn: config.resizeNeighborColumn,
            reMaximize: config.reMaximize,
            skipSwitcher: config.skipSwitcher,
            tiledKeepBelow: config.tiledKeepBelow,
            maximizedKeepAbove: config.floatingKeepAbove,
            untileOnDrag: config.untileOnDrag,
        };

        const desktopConfig = {
            marginTop: config.gapsOuterTop,
            marginBottom: config.gapsOuterBottom,
            marginLeft: config.gapsOuterLeft,
            marginRight: config.gapsOuterRight,
            scroller: World.createScroller(config),
            clamper: config.scrollingLazy ? new EdgeClamper() : new CenterClamper(),
            gestureScroll: config.gestureScroll,
            gestureScrollInvert: config.gestureScrollInvert,
            gestureScrollStep: config.gestureScrollStep,
        };

        return new DesktopManager(
            this.pinManager,
            desktopConfig,
            layoutConfig,
            focusPasser,
            new DesktopFilter(config.tiledDesktops)
        );
    }

    createClientManager(config) {
        return new ClientManager(config, this, this.desktopManager, this.pinManager);
    }

    static createScroller(config) {
        if (config.scrollingLazy) {
            return new LazyScroller();
        } else if (config.scrollingCentered) {
            return new CenteredScroller();
        } else if (config.scrollingGrouped) {
            return new GroupedScroller();
        } else {
            log("No scrolling mode selected, using default");
            return new LazyScroller();
        }
    }

    addExistingClients() {
        for (const kwinClient of Workspace.windows) {
            this.clientManager.addClient(kwinClient);
        }
    }

    update() {
        const currentDesktop = this.desktopManager.getCurrentDesktop();
        if (currentDesktop !== undefined) {
            currentDesktop.arrange();
        }
    }

    do(action) {
        action(this.clientManager, this.desktopManager);
        this.update();
    }

    doIfTiled(kwinClient, action) {
        const window = this.clientManager.findTiledWindow(kwinClient);
        if (window === null) {
            return;
        }

        const column = window.column;
        const grid = column.grid;
        action(this.clientManager, this.desktopManager, window, column, grid);
        this.update();
    }

    doIfTiledFocused(action) {
        if (Workspace.activeWindow === null) {
            return;
        }
        this.doIfTiled(Workspace.activeWindow, action);
    }

    gestureScroll(amount) {
        this.do((clientManager, desktopManager) => {
            const currentDesktop = desktopManager.getCurrentDesktop();
            if (currentDesktop !== undefined) {
                currentDesktop.gestureScroll(amount);
            }
        });
    }

    gestureScrollFinish() {
        this.do((clientManager, desktopManager) => {
            const currentDesktop = desktopManager.getCurrentDesktop();
            if (currentDesktop !== undefined) {
                currentDesktop.gestureScrollFinish();
            }
        });
    }

    destroy() {
        this.workspaceSignalManager.destroy();

        for (const shortcutAction of this.shortcutActions) {
            shortcutAction.destroy();
        }

        this.clientManager.destroy();
        this.desktopManager.destroy();
    }

    onScreenResized() {
        this.screenResizedDelayer.run();
    }
}

// ============================================================================
// Точка входа
// ============================================================================

/**
 * @param {QML.Item} qmlBaseItem - Base QML item со ссылкой на notifications и другие QML объекты
 * @returns {World} Главный объект плагина
 */
function init(qmlBaseItem) {
    // Сохранять глобальный qmlBase для доступа из других модулей
    if (qmlBaseItem) {
        globalThis.qmlBase = qmlBaseItem;
    }
    return new World(loadConfig());
}
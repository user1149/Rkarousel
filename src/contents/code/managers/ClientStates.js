"use strict";

var ClientState;
(function (ClientState) {
    class Manager {
        constructor(initialState) {
            this.state = initialState;
        }

        setState(constructNewState, passFocus) {
            this.state.destroy(passFocus);
            this.state = constructNewState();
        }

        getState() {
            return this.state;
        }

        destroy(passFocus) {
            this.state.destroy(passFocus);
        }
    }
    ClientState.Manager = Manager;
})(ClientState || (ClientState = {}));

var ClientState;
(function (ClientState) {
    class Docked {
        constructor(world, kwinClient) {
            this.world = world;
            this.signalManager = Docked.initSignalManager(world, kwinClient);
            world.onScreenResized();
        }

        destroy(passFocus) {
            this.signalManager.destroy();
            this.world.onScreenResized();
        }

        static initSignalManager(world, kwinClient) {
            const manager = new SignalManager();
            manager.connect(kwinClient.frameGeometryChanged, () => {
                world.onScreenResized();
            });
            return manager;
        }
    }
    ClientState.Docked = Docked;
})(ClientState || (ClientState = {}));

var ClientState;
(function (ClientState) {
    class Floating {
        constructor(world, client, config, limitHeight) {
            this.client = client;
            this.config = config;

            if (config.floatingKeepAbove) {
                client.kwinClient.keepAbove = true;
            }

            if (limitHeight && client.kwinClient.tile === null) {
                Floating.limitHeight(client);
            }

            this.signalManager = Floating.initSignalManager(world, client.kwinClient);
        }

        destroy(passFocus) {
            this.signalManager.destroy();
        }

        static limitHeight(client) {
            const placementArea = Workspace.clientArea(
                0,
                client.kwinClient.output,
                Clients.getKwinDesktopApprox(client.kwinClient)
            );

            const clientRect = client.kwinClient.frameGeometry;
            const width = client.preferredWidth;

            client.place(
                clientRect.x,
                clientRect.y,
                width,
                Math.min(clientRect.height, Math.round(placementArea.height / 2))
            );
        }

        static initSignalManager(world, kwinClient) {
            const manager = new SignalManager();

            manager.connect(kwinClient.tileChanged, () => {
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                }
            });

            return manager;
        }
    }
    ClientState.Floating = Floating;
})(ClientState || (ClientState = {}));

var ClientState;
(function (ClientState) {
    class Pinned {
        constructor(world, pinManager, desktopManager, kwinClient, config) {
            this.kwinClient = kwinClient;
            this.pinManager = pinManager;
            this.desktopManager = desktopManager;
            this.config = config;

            if (config.floatingKeepAbove) {
                kwinClient.keepAbove = true;
            }

            this.signalManager = Pinned.initSignalManager(world, pinManager, kwinClient);
        }

        destroy(passFocus) {
            this.signalManager.destroy();
            this.pinManager.removeClient(this.kwinClient);

            for (const desktop of this.desktopManager.getDesktopsForClient(this.kwinClient)) {
                desktop.onPinsChanged();
            }
        }

        static initSignalManager(world, pinManager, kwinClient) {
            const manager = new SignalManager();
            let oldActivities = kwinClient.activities;
            let oldDesktops = kwinClient.desktops;

            manager.connect(kwinClient.tileChanged, () => {
                if (kwinClient.tile === null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.unpinClient(kwinClient);
                    });
                }
            });

            manager.connect(kwinClient.frameGeometryChanged, () => {
                if (kwinClient.tile === null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.unpinClient(kwinClient);
                    });
                    return;
                }

                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktopsForClient(kwinClient)) {
                        desktop.onPinsChanged();
                    }
                });
            });

            manager.connect(kwinClient.minimizedChanged, () => {
                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktopsForClient(kwinClient)) {
                        desktop.onPinsChanged();
                    }
                });
            });

            manager.connect(kwinClient.desktopsChanged, () => {
                const changedDesktops = oldDesktops.length === 0 || kwinClient.desktops.length === 0
                    ? []
                    : union(oldDesktops, kwinClient.desktops);

                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktops(kwinClient.activities, changedDesktops)) {
                        desktop.onPinsChanged();
                    }
                });

                oldDesktops = kwinClient.desktops;
            });

            manager.connect(kwinClient.activitiesChanged, () => {
                const changedActivities = oldActivities.length === 0 || kwinClient.activities.length === 0
                    ? []
                    : union(oldActivities, kwinClient.activities);

                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktops(changedActivities, kwinClient.desktops)) {
                        desktop.onPinsChanged();
                    }
                });

                oldActivities = kwinClient.activities;
            });

            return manager;
        }
    }
    ClientState.Pinned = Pinned;
})(ClientState || (ClientState = {}));

var ClientState;
(function (ClientState) {
    class Tiled {
        constructor(world, client, grid) {
            this.defaultState = {
                skipSwitcher: client.kwinClient.skipSwitcher
            };

            Tiled.prepareClientForTiling(client, grid.config);

            const column = new Column(
                grid,
                grid.getLastFocusedColumn() ?? grid.getLastColumn()
            );

            this.window = new Window(client, column);
            this.signalManager = Tiled.initSignalManager(world, this.window, grid.config);
        }

        destroy(passFocus) {
            this.signalManager.destroy();

            const window = this.window;
            const grid = window.column.grid;
            const client = window.client;

            window.destroy(passFocus);
            Tiled.restoreClientAfterTiling(client, grid.config, this.defaultState, grid.desktop.clientArea);
        }

        static initSignalManager(world, window, config) {
            const client = window.client;
            const kwinClient = client.kwinClient;
            const manager = new SignalManager();

            manager.connect(kwinClient.desktopsChanged, () => {
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(kwinClient);
                    if (desktop === undefined) {
                        clientManager.floatClient(client);
                        return;
                    }
                    Tiled.moveWindowToGrid(window, desktop.grid);
                });
            });

            manager.connect(kwinClient.activitiesChanged, () => {
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(kwinClient);
                    if (desktop === undefined) {
                        clientManager.floatClient(client);
                        return;
                    }
                    Tiled.moveWindowToGrid(window, desktop.grid);
                });
            });

            manager.connect(kwinClient.minimizedChanged, () => {
                console.assert(kwinClient.minimized);
                world.do((clientManager, desktopManager) => {
                    clientManager.minimizeClient(kwinClient);
                });
            });

            manager.connect(kwinClient.maximizedAboutToChange, (maximizedMode) => {
                world.do(() => {
                    window.onMaximizedChanged(maximizedMode);
                });
            });

            let moving = false;
            let resizing = false;
            let resizeStartWidth = 0;
            let resizeNeighbor;

            manager.connect(kwinClient.interactiveMoveResizeStarted, () => {
                if (kwinClient.move) {
                    if (config.untileOnDrag) {
                        world.do((clientManager, desktopManager) => {
                            clientManager.floatClient(client);
                        });
                    } else {
                        moving = true;
                    }
                    return;
                }

                if (kwinClient.resize) {
                    resizing = true;
                    resizeStartWidth = window.column.getWidth();

                    if (config.resizeNeighborColumn) {
                        const resizeNeighborColumn = Tiled.getResizeNeighborColumn(window);
                        if (resizeNeighborColumn !== null) {
                            resizeNeighbor = {
                                column: resizeNeighborColumn,
                                startWidth: resizeNeighborColumn.getWidth(),
                            };
                        }
                    }

                    window.column.grid.onUserResizeStarted();
                }
            });

            manager.connect(kwinClient.interactiveMoveResizeFinished, () => {
                if (moving) {
                    moving = false;
                    world.do(() => window.column.grid.desktop.onLayoutChanged());
                }

                if (resizing) {
                    resizing = false;
                    resizeNeighbor = undefined;
                    window.column.grid.onUserResizeFinished();
                }
            });

            const externalFrameGeometryChangedRateLimiter = new RateLimiter(
                4,
                Tiled.MAX_EXTERNAL_FRAME_GEOMETRY_CHANGED_INTERVAL_MS
            );

            manager.connect(kwinClient.frameGeometryChanged, (oldGeometry) => {
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                    return;
                }

                const newGeometry = client.kwinClient.frameGeometry;
                const oldCenterX = oldGeometry.x + oldGeometry.width / 2;
                const oldCenterY = oldGeometry.y + oldGeometry.height / 2;
                const newCenterX = newGeometry.x + newGeometry.width / 2;
                const newCenterY = newGeometry.y + newGeometry.height / 2;

                const dx = Math.round(newCenterX - oldCenterX);
                const dy = Math.round(newCenterY - oldCenterY);

                if (dx !== 0 || dy !== 0) {
                    client.moveTransients(dx, dy);
                }

                if (kwinClient.resize) {
                    world.do(() => {
                        if (newGeometry.width !== oldGeometry.width) {
                            window.column.onUserResizeWidth(
                                resizeStartWidth,
                                newGeometry.width - resizeStartWidth,
                                newGeometry.left !== oldGeometry.left,
                                resizeNeighbor
                            );
                        }

                        if (newGeometry.height !== oldGeometry.height) {
                            window.column.adjustWindowHeight(
                                window,
                                newGeometry.height - oldGeometry.height,
                                newGeometry.y !== oldGeometry.y
                            );
                        }
                    });
                } else if (
                    !window.column.grid.isUserResizing() &&
                    !client.isManipulatingGeometry(newGeometry) &&
                    client.getMaximizedMode() === 0 &&
                    !Clients.isFullScreenGeometry(kwinClient)
                ) {
                    if (externalFrameGeometryChangedRateLimiter.acquire()) {
                        world.do(() => window.onFrameGeometryChanged());
                    }
                }
            });

            manager.connect(kwinClient.fullScreenChanged, () => {
                world.do((clientManager, desktopManager) => {
                    if (!Clients.canTileEver(kwinClient)) {
                        clientManager.floatClient(client);
                        return;
                    }
                    window.onFullScreenChanged(kwinClient.fullScreen);
                });
            });

            manager.connect(kwinClient.tileChanged, () => {
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                }
            });

            return manager;
        }

        static getResizeNeighborColumn(window) {
            const kwinClient = window.client.kwinClient;
            const column = window.column;
            const cursorPos = Workspace.cursorPos;

            if (cursorPos.x > kwinClient.clientGeometry.right) {
                return column.grid.getRightColumn(column);
            } else if (cursorPos.x < kwinClient.clientGeometry.left) {
                return column.grid.getLeftColumn(column);
            } else {
                return null;
            }
        }

        static moveWindowToGrid(window, grid) {
            if (grid === window.column.grid) {
                return;
            }

            const newColumn = new Column(
                grid,
                grid.getLastFocusedColumn() ?? grid.getLastColumn()
            );

            const passFocus = window.isFocused()
                ? 2
                : 0;

            window.moveToColumn(newColumn, true, passFocus);
        }

        static prepareClientForTiling(client, config) {
            if (config.skipSwitcher) {
                client.kwinClient.skipSwitcher = true;
            }

            if (client.kwinClient.fullScreen) {
                if (config.maximizedKeepAbove) {
                    client.kwinClient.keepAbove = true;
                }
            } else {
                if (config.tiledKeepBelow) {
                    client.kwinClient.keepBelow = true;
                }
                client.kwinClient.keepAbove = false;
            }

            if (client.kwinClient.tile !== null) {
                client.setMaximize(false, true);
            }

            client.setMaximize(false, false);
        }

        static restoreClientAfterTiling(client, config, defaultState, screenSize) {
            if (config.skipSwitcher) {
                client.kwinClient.skipSwitcher = defaultState.skipSwitcher;
            }

            if (config.tiledKeepBelow) {
                client.kwinClient.keepBelow = false;
            }

            if (config.offScreenOpacity < 1.0) {
                client.kwinClient.opacity = 1.0;
            }

            client.setFullScreen(false);

            if (client.kwinClient.tile === null) {
                client.setMaximize(false, false);
            }

            client.ensureVisible(screenSize);
        }
    }

    Tiled.MAX_EXTERNAL_FRAME_GEOMETRY_CHANGED_INTERVAL_MS = 1000;

    ClientState.Tiled = Tiled;
})(ClientState || (ClientState = {}));

var ClientState;
(function (ClientState) {
    class TiledMinimized {
        constructor(world, client) {
            this.signalManager = TiledMinimized.initSignalManager(world, client);
        }

        destroy(passFocus) {
            this.signalManager.destroy();
        }

        static initSignalManager(world, client) {
            const manager = new SignalManager();

            manager.connect(client.kwinClient.minimizedChanged, () => {
                console.assert(!client.kwinClient.minimized);
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(client.kwinClient);
                    if (desktop !== undefined) {
                        clientManager.tileClient(client, desktop.grid);
                    } else {
                        clientManager.floatClient(client);
                    }
                });
            });

            return manager;
        }
    }
    ClientState.TiledMinimized = TiledMinimized;
})(ClientState || (ClientState = {}));

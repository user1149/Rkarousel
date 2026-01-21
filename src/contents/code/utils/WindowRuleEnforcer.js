"use strict";

class ClientMatcher {
    constructor(regex) {
        this.regex = regex;
    }

    matches(kwinClient) {
        return this.regex.test(ClientMatcher.getClientString(kwinClient));
    }

    static getClientString(kwinClient) {
        return ClientMatcher.getRuleString(kwinClient.resourceClass, kwinClient.caption);
    }

    static getRuleString(ruleClass, ruleCaption) {
        return ruleClass + "\0" + ruleCaption;
    }
}

class DesktopFilter {
    constructor(desktopsConfig) {
        this.desktopRegex = DesktopFilter.parseDesktopConfig(desktopsConfig);
    }

    shouldWorkOnDesktop(kwinDesktop) {
        if (this.desktopRegex === null) {
            return true;
        }
        return this.desktopRegex.test(kwinDesktop.name);
    }

    static parseDesktopConfig(config) {
        const trimmed = config.trim();
        if (trimmed.length === 0) {
            return null;
        }
        try {
            return new RegExp(`^${trimmed}$`);
        }
        catch (e) {
            // Попытка отправить уведомление если qmlBase доступен
            if (typeof globalThis.qmlBase !== 'undefined' && globalThis.qmlBase) {
                try {
                    if (globalThis.qmlBase.notificationInvalidTiledDesktops) {
                        globalThis.qmlBase.notificationInvalidTiledDesktops.sendEvent();
                    }
                } catch (notifError) {
                    log("Failed to send notification:", notifError);
                }
            }
            log(`Invalid regex pattern in tiledDesktops config: ${trimmed}. Working on all desktops.`);
            return null;
        }
    }
}

class WindowRuleEnforcer {
    constructor(windowRules) {
        const [floatRegex, tileRegex, followCaptionRegex] = WindowRuleEnforcer.createWindowRuleRegexes(windowRules);
        this.preferFloating = new ClientMatcher(floatRegex);
        this.preferTiling = new ClientMatcher(tileRegex);
        this.followCaption = followCaptionRegex;
    }

    shouldTile(kwinClient) {
        const prefersTiling = this.preferTiling.matches(kwinClient);
        if (prefersTiling) return true;

        const isNormalWindow = kwinClient.normalWindow;
        const isNotTransient = !kwinClient.transient;
        const isManaged = kwinClient.managed;
        const hasValidPid = kwinClient.pid > -1;
        const isNotFullScreen = !kwinClient.fullScreen;
        const hasNoFullscreenGeometry = !Clients.isFullScreenGeometry(kwinClient);
        const prefersFloating = this.preferFloating.matches(kwinClient);

        return isNormalWindow &&
            isNotTransient &&
            isManaged &&
            hasValidPid &&
            isNotFullScreen &&
            hasNoFullscreenGeometry &&
            !prefersFloating;
    }

    initClientSignalManager(world, kwinClient) {
        const shouldFollowCaption = this.followCaption.test(kwinClient.resourceClass);
        if (!shouldFollowCaption) {
            return null;
        }

        const enforcer = this;
        const manager = new SignalManager();

        manager.connect(kwinClient.captionChanged, function () {
            const canTileNow = Clients.canTileNow(kwinClient);
            const shouldTile = canTileNow && enforcer.shouldTile(kwinClient);

            world.do(function (clientManager, desktopManager) {
                const desktop = desktopManager.getDesktopForClient(kwinClient);
                const hasDesktop = desktop !== undefined;

                if (shouldTile && hasDesktop) {
                    clientManager.tileKwinClient(kwinClient, desktop.grid);
                } else {
                    clientManager.floatKwinClient(kwinClient);
                }
            });
        });

        return manager;
    }

    static createWindowRuleRegexes(windowRules) {
        const floatRegexes = [];
        const tileRegexes = [];
        const followCaptionRegexes = [];

        for (const windowRule of windowRules) {
            const ruleClass = WindowRuleEnforcer.parseRegex(windowRule.class);
            const ruleCaption = WindowRuleEnforcer.parseRegex(windowRule.caption);
            const ruleString = ClientMatcher.getRuleString(
                WindowRuleEnforcer.wrapParens(ruleClass),
                WindowRuleEnforcer.wrapParens(ruleCaption)
            );

            if (windowRule.tile) {
                tileRegexes.push(ruleString);
            } else {
                floatRegexes.push(ruleString);
            }

            if (ruleCaption !== ".*") {
                followCaptionRegexes.push(ruleClass);
            }
        }

        return [
            WindowRuleEnforcer.joinRegexes(floatRegexes),
            WindowRuleEnforcer.joinRegexes(tileRegexes),
            WindowRuleEnforcer.joinRegexes(followCaptionRegexes),
        ];
    }

    static parseRegex(rawRule) {
        const isEmptyOrDefault = rawRule === undefined || rawRule === "" || rawRule === ".*";
        return isEmptyOrDefault ? ".*" : rawRule;
    }

    static joinRegexes(regexes) {
        if (regexes.length === 0) {
            return new RegExp("a^");
        }

        if (regexes.length === 1) {
            return new RegExp("^(" + regexes[0] + ")$");
        }

        const wrappedRegexes = regexes.map(function (regex) {
            return WindowRuleEnforcer.wrapParens(regex);
        });
        const joinedRegexes = wrappedRegexes.join("|");

        return new RegExp("^(" + joinedRegexes + ")$");
    }

    static wrapParens(str) {
        return "(" + str + ")";
    }
}

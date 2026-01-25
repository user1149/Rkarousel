import QtQuick 6.0
import org.kde.kwin 3.0
import org.kde.notification 1.0
import "../code/main.js" as Rkarousel

Item {
    id: qmlBase

    property var rkarouselInstance

    Component.onCompleted: {
        qmlBase.rkarouselInstance = Rkarousel.init();
    }

    Component.onDestruction: {
        qmlBase.rkarouselInstance.destroy();
    }

    Notification {
        id: notificationInvalidTiledDesktops
        componentName: "plasma_workspace"
        eventId: "notification"
        title: "Rkarousel"
        text: "Your Tiled Desktops regex is malformed, please review your Rkarousel configuration"
        flags: Notification.Persistent
        urgency: Notification.HighUrgency
    }

    Notification {
        id: notificationInvalidWindowRules
        componentName: "plasma_workspace"
        eventId: "notification"
        title: "Karousel"
        text: "Your Window Rules JSON is malformed, please review your Karousel configuration"
        flags: Notification.Persistent
        urgency: Notification.HighUrgency
    }

    Notification {
        id: notificationInvalidPresetWidths
        componentName: "plasma_workspace"
        eventId: "notification"
        title: "Karousel"
        text: "Your preset widths are malformed, please review your Karousel configuration"
        flags: Notification.Persistent
        urgency: Notification.HighUrgency
    }

    SwipeGestureHandler {
        direction: SwipeGestureHandler.Direction.Left
        fingerCount: 3
        onActivated: qmlBase.karouselInstance.gestureScrollFinish()
        onCancelled: qmlBase.karouselInstance.gestureScrollFinish()
        onProgressChanged: qmlBase.karouselInstance.gestureScroll(-progress)
    }

    SwipeGestureHandler {
        direction: SwipeGestureHandler.Direction.Right
        fingerCount: 3
        onActivated: qmlBase.karouselInstance.gestureScrollFinish()
        onCancelled: qmlBase.karouselInstance.gestureScrollFinish()
        onProgressChanged: qmlBase.karouselInstance.gestureScroll(progress)
    }

    DBusCall {
        id: moveCursorToFocus

        service: "org.kde.kglobalaccel"
        path: "/component/kwin"
        method: "invokeShortcut"
        arguments: ["MoveMouseToFocus"]
    }
}

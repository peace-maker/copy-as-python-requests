// https://developer.chrome.com/docs/extensions/mv3/devtools/
// about:debugging#/runtime/this-firefox
let devtoolInstances = {};
let browserActionPopup = null;

function handleOpeningDevtools(port) {
    // assign the listener function to a variable so we can remove it later
    var devToolsListener = function(message, sender, sendResponse) {
        switch (message.type) {
            case "init":
                devtoolInstances[message.tabId] = port;
                break;
            case "requests":
                // Forward the requests to the popup
                if (browserActionPopup) {
                    browserActionPopup.postMessage(message);
                }
                break;
            default:
                console.log("Unknown message type: " + message.type);
        }
    }

    port.onMessage.addListener(devToolsListener);

    port.onDisconnect.addListener(function(port) {
        for (const key in devtoolInstances) {
            if (devtoolInstances[key] === port) {
                delete devtoolInstances[key];
                break;
            }
        }
        port.onMessage.removeListener(devToolsListener);
    });
}

function handleOpeningBrowserAction(port) {
    browserActionPopup = port;
    port.onMessage.addListener(function(msg) {
        switch (msg.type) {
            case "get-requests":
                chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                    if (tabs.length == 0) {
                        port.postMessage({"type": "no-active-tab"});
                        return;
                    }
                    var tab = tabs[0];
                    console.log(tab.id, devtoolInstances, tab.id in devtoolInstances);
                    if (tab.id in devtoolInstances) {
                        devtoolInstances[tab.id].postMessage({type: "get-requests"});
                    } else {
                        port.postMessage({"type": "no-devtools-open"});
                    }
                });
                break;
            default:
                console.log("Unknown message type: " + msg.type);
                break;
        }
    });
    port.onDisconnect.addListener(function(port) {
        browserActionPopup = null;
    });
}

chrome.runtime.onConnect.addListener(function (port) {
    if (port.name == "devtools-page")
        handleOpeningDevtools(port);
    else if (port.name == "popup")
        handleOpeningBrowserAction(port);
});

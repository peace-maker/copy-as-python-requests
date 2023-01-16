// https://developer.chrome.com/docs/extensions/mv3/devtools/
// about:debugging#/runtime/this-firefox
let devtoolInstances = {};
let browserActionPopup = null;
let browserActionPopupActiveTab = null;

const ignoreResponseContentTypes = [
    'image/',
    'video/',
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/x-javascript',
    'application/font',
    'font/'
];
const ignoreHeaders = [
    // https://greenbytes.de/tech/webdav/draft-ietf-httpbis-http2-09.html#HttpRequest
    ':authority',
    ':method',
    ':path',
    ':scheme',
    'Accept',
    'Accept-Encoding',
    'Accept-Language',
    'Cache-Control',
    'Cookie',
    'Connection',
    'Content-Length',
    'Host',
    'If-Modified-Since',
    'If-None-Match',
    'Origin',
    'Pragma',
    'Referer',
    'Sec-Fetch-Dest',
    'Sec-Fetch-Mode',
    'Sec-Fetch-Site',
    'Sec-Fetch-User',
    'TE',
    'Upgrade-Insecure-Requests',
    'User-Agent',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
];

// Fill storage with default values on extension install.
chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason == "install" || details.reason == "update") {
        chrome.storage.local.set({
            'ignoreResponseContentTypes': ignoreResponseContentTypes,
            'enableResponseContentTypeFilter': true,
            'ignoreHeaders': ignoreHeaders,
            'enableRequestHeaderFilter': true,
            'hideFailedRequests': true,
            'useSession': true,
            'useSeparateLines': false,
        }, function() {
            // Saved.
        });
    }
});

function handleOpeningDevtools(port) {
    // assign the listener function to a variable so we can remove it later
    var devToolsListener = function(message, sender, sendResponse) {
        switch (message.type) {
            case "init":
                devtoolInstances[message.tabId] = port;
                // Trigger a refresh of the requests in the open popup now that we have a connection.
                if (browserActionPopup && browserActionPopupActiveTab === message.tabId) {
                    port.postMessage({type: "get-requests"});
                }
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
    // We don't know of any open devtool instances yet.
    if (Object.keys(devtoolInstances).length === 0) {
        chrome.runtime.sendMessage({type: "get-port"}, function() {});
    }

    browserActionPopup = port;
    port.onMessage.addListener(function(msg) {
        switch (msg.type) {
            case "get-requests":
                chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                    if (tabs.length == 0) {
                        port.postMessage({"type": "no-active-tab"});
                        return;
                    }
                    const tab = tabs[0];
                    browserActionPopupActiveTab = tab.id;
                    if (tab.id in devtoolInstances) {
                        devtoolInstances[tab.id].postMessage({type: "get-requests"});
                    } else {
                        port.postMessage({"type": "no-devtools-open"});
                    }
                });
                break;
            default:
                console.log("Unknown message type: " + msg);
                break;
        }
    });
    port.onDisconnect.addListener(function(port) {
        browserActionPopup = null;
        browserActionPopupActiveTab = null;
    });
}

chrome.runtime.onConnect.addListener(function (port) {
    if (port.name == "devtools-page")
        handleOpeningDevtools(port);
    else if (port.name == "popup")
        handleOpeningBrowserAction(port);
});

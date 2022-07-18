var port = chrome.runtime.connect({
    name: "popup"
});
port.postMessage({"type": "get-requests"});
port.onMessage.addListener(function(msg) {
    switch (msg.type) {
        case "no-active-tab":
            printMessage("No active tab.");
            break;
        case "no-devtools-open":
            printMessage("No DevTools window open.");
            break;
        case "requests":
            const requests = msg.requests;
            if (requests.length > 0) {
                printMessage(requests.join("\n"));
            } else {
                printMessage("No requests.");
            }
            break;
        default:
            printMessage("Unknown message type: " + msg.type);
            console.log("Unknown message type: " + msg.type);
            break;
    }
});

function printMessage(message) {
    let msgElement = document.getElementById('msg');
    msgElement.innerText = message;
}

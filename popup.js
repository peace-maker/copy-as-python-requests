let useSession = true;

chrome.storage.local.get(['useSession'], (data) => {
    useSession = data.useSession;
    document.querySelector("#useSession").checked = useSession;
});

var port = chrome.runtime.connect({
    name: "popup"
});
port.postMessage({"type": "get-requests"});
port.onMessage.addListener(function(msg) {
    switch (msg.type) {
        case "no-active-tab":
            setCopyButtonVisible(false);
            printMessage("No active tab.");
            break;
        case "no-devtools-open":
            setCopyButtonVisible(false);
            printMessage("No DevTools window open.");
            break;
        case "requests":
            const requests = msg.requests;
            if (requests.length > 0) {
                setCopyButtonVisible(true);
                printMessage(requests.join("\n"));
            } else {
                setCopyButtonVisible(false);
                printMessage("No requests.");
            }
            break;
        default:
            printMessage("Unknown message type: " + msg.type);
            console.log("Unknown message type: " + msg.type);
            break;
    }
});

document.getElementById('copy').addEventListener('click', function(e) {
    e.preventDefault();
    const status = document.getElementById('status');
    const text = document.getElementById('msg').innerText;
    navigator.clipboard.writeText(text).then(function() {
        status.innerText = 'Copied.';
    }, function(err) {
        status.innerText = 'Could not copy text: ' + err;
    });
});

const setCopyButtonVisible = (visible) => {
    const copyButton = document.getElementById('copy');
    copyButton.style.display = visible ? 'block' : 'none';
};

function printMessage(message) {
    document.getElementById('msg').innerText = message;
}

document.querySelector("#useSession").addEventListener("change", function(e) {
    useSession = e.target.checked;
    chrome.storage.local.set({"useSession": useSession});
    // Render requests again using the new setting
    port.postMessage({"type": "get-requests"});
});

document.querySelector('#go-to-options').addEventListener('click', function(e) {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('options.html'));
    }
});

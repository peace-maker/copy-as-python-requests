// In-page cache of the user's options
let ignoreResponseContentTypes = [];
let ignoreHeaders = [];

// Initialize the request filter settings cache.
chrome.storage.local.get(['ignoreResponseContentTypes', 'ignoreHeaders'], (data) => {
    ignoreResponseContentTypes = data.ignoreResponseContentTypes;
    ignoreHeaders = data.ignoreHeaders;
});

// Update cache on change.
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace != 'local') return;
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        if (key === 'ignoreResponseContentTypes') {
            ignoreResponseContentTypes = newValue;
        } else if (key === 'ignoreHeaders') {
            ignoreHeaders = newValue;
        }
    }
});

function stripURLSearchParams(urlString) {
    let url = new URL(urlString);
    url.search = '';
    return url.toString();
}

function sanitizePython(str) {
    if (str) {
        str = str.replaceAll('\\', '\\\\').replaceAll('\"', '\\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
        return `"${str}"`;
    }
    return 'None';
}

function handleRequest(har_entry) {
    // Hide requests to (probably) static resources.
    const response = har_entry.response;
    if (response.headers && response.headers.length > 0) {
        const contentType = response.headers.find(header => header.name.toLowerCase() === 'content-type');
        if (contentType && ignoreResponseContentTypes.some(ignoreContentType => contentType.value.toLowerCase().startsWith(ignoreContentType))) {
            return;
        }
    }
    
    const request = har_entry.request;
    let output = "requests.";
    const shortcut_methods = ["get", "post", "put", "delete", "head", "patch"];
    if (shortcut_methods.some(method => method === request.method.toLowerCase()))
        output += `${request.method.toLowerCase()}(`;
    else
        output += `request("${request.method}", `;
    output += `"${stripURLSearchParams(request.url)}"`;
    if (request.queryString && request.queryString.length > 0) {
        output += ", params={";
        output += request.queryString.map(qs => `${sanitizePython(qs.name)}: ${sanitizePython(qs.value)}`).join(", ");
        output += "}";
    }

    let stripContentType = true;
    if (request.postData) {
        const postData = request.postData;
        if (postData.mimeType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
            output += ", data={";
            output += postData.params.map(p => `${sanitizePython(p.name)}: ${sanitizePython(p.value)}`).join(", ");
            output += "}";

        } else if (postData.mimeType.toLowerCase() === "application/json") {
            output += `, json=${postData.text}`;
        } else if (postData.mimeType.toLowerCase().startsWith("multipart/form-data")) {
            output += ", files={";
            output += postData.params.map(p => {
                const name = sanitizePython(p.name);
                const fileName = sanitizePython(p.fileName);
                const value = sanitizePython(p.value);
                if (p.contentType) {
                    return `${name}: (${fileName}, ${value}, ${sanitizePython(p.contentType)})`
                } else {
                    return `${name}: (${fileName}, ${value})`
                }
            }).join(", ");
            output += "}";
        } else {
            // Best effort to convert the request.
            output += `, data=${sanitizePython(postData.text)}`;
            // Don't know what this is, so don't strip the content type.
            stripContentType = false;
        }

        // Preserve transfer codings in the content type like `application/x-www-form-urlencoded; charset=UTF-8`
        if (postData.mimeType.includes(";")) {
            // Ignore utf-8 charset, since that's the default.
            const transferCodings = postData.mimeType.split(";")[1].trim();
            if (transferCodings.toLowerCase() !== "charset=utf-8") {
                output = `# Stripped transfer codings. Original Content-Type: ${postData.mimeType}\n${output}`;
            }
        }
    }

    if (request.headers && request.headers.length > 0) {
        let filteredHeaders = request.headers.filter(h => !ignoreHeaders.some(ignoreHeader => ignoreHeader.toLowerCase() === h.name.toLowerCase()));
        const authHeader = request.headers.find(h => h.name.toLowerCase() === 'authorization');
        if (authHeader && authHeader.value.toLowerCase().startsWith('basic')) {
            try {
                const auth = atob(authHeader.value.substring(6));
                const [username, password] = auth.split(':');
                output += `, auth=(${sanitizePython(username)}, ${sanitizePython(password)})`;
                filteredHeaders = filteredHeaders.filter(h => h.name.toLowerCase() !== 'authorization');
            } catch {
            }
        }
        if (stripContentType) {
            filteredHeaders = filteredHeaders.filter(h => h.name.toLowerCase() !== 'content-type');
        }
        filteredHeaders = filteredHeaders.map(h => `${sanitizePython(h.name)}: ${sanitizePython(h.value)}`);
        if (filteredHeaders.length > 0) {
            output += ", headers={";
            output += filteredHeaders.join(", ");
            output += "}";
        }
    }

    if (request.cookies && request.cookies.length > 0) {
        output += ", cookies={";
        output += request.cookies.map(c => `${sanitizePython(c.name)}: ${sanitizePython(c.value)}`).join(", ");
        output += "}";
    }

    output += ")";

    // chrome.devtools.inspectedWindow.eval(`console.log(\`${output}\`)`);
    return output;
};

// Create a connection to the background page
var backgroundPageConnection = chrome.runtime.connect({
    name: "devtools-page"
});

backgroundPageConnection.onMessage.addListener(function (message) {
    // Handle responses from the background page, if any
    switch (message.type) {
        case "get-requests":
            chrome.devtools.network.getHAR(function (result) {
                let requests = [];
                for (let entry of result.entries) {
                    const pythonRequest = handleRequest(entry);
                    if (pythonRequest) {
                        requests.push(pythonRequest);
                    }
                }
                // chrome.devtools.network.onRequestFinished.addListener(handleRequest);
                backgroundPageConnection.postMessage({"type": "requests", "requests": requests});
            });
            break;
        default:
            chrome.devtools.inspectedWindow.eval(`console.log(\`Unknown message type in devtools.js: ${message.type}\`)`);
            break;
    }
});

// Relay the tab ID to the background page
backgroundPageConnection.postMessage({
    type: "init",
    tabId: chrome.devtools.inspectedWindow.tabId
});

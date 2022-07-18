const ignoreResponseContentTypes = [
    'image/',
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
        filteredHeaders = filteredHeaders.map(h => `${sanitizePython(h.name)}: ${sanitizePython(h.value)}`);
        if (filteredHeaders.length > 0) {
            output += ", headers={";
            output += filteredHeaders.join(", ");
            output += "}";
        }
    }

    if (request.postData) {
        const postData = request.postData;
        if (postData.mimeType.toLowerCase() === "application/x-www-form-urlencoded") {
            output += ", data={";
            output += postData.params.map(p => `${sanitizePython(p.name)}: ${sanitizePython(p.value)}`).join(", ");
            output += "}";
        } else if (postData.mimeType.toLowerCase() === "application/json") {
            output += `, json=${postData.text}`;
        } else if (postData.mimeType.toLowerCase().startsWith("multipart/form-data")) {
            output += ", files={";
            output += postData.params.map(p => `${sanitizePython(p.name)}: (${sanitizePython(p.fileName)}, ${sanitizePython(p.value)}, ${sanitizePython(p.contentType)})`).join(", ");
            output += "}";
        } else {
            output += `, data=${sanitizePython(postData.text)}`;
        }
    }

    if (request.cookies && request.cookies.length > 0) {
        output += ", cookies={";
        output += request.cookies.map(c => `"${c.name}": "${c.value}"`).join(", ");
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

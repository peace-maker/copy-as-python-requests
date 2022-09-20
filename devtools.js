// In-page cache of the user's options
let ignoreResponseContentTypes = [];
let enableResponseContentTypeFilter = true;
let ignoreHeaders = [];
let enableRequestHeaderFilter = true;
let hideFailedRequests = true;
let useSession = true;
let useSeparateLines = false;

// Initialize the request filter settings cache.
chrome.storage.local.get(['ignoreResponseContentTypes', 'enableResponseContentTypeFilter', 'ignoreHeaders', 'enableRequestHeaderFilter', 'hideFailedRequests', 'useSession', 'useSeparateLines'], (data) => {
    ignoreResponseContentTypes = data.ignoreResponseContentTypes;
    enableResponseContentTypeFilter = data.enableResponseContentTypeFilter;
    ignoreHeaders = data.ignoreHeaders;
    enableRequestHeaderFilter = data.enableRequestHeaderFilter;
    hideFailedRequests = data.hideFailedRequests;
    useSession = data.useSession;
    useSeparateLines = data.useSeparateLines;
});

// Update cache on change.
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace != 'local') return;
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        if (key === 'ignoreResponseContentTypes') {
            ignoreResponseContentTypes = newValue;
        } else if (key === 'enableResponseContentTypeFilter') {
            enableResponseContentTypeFilter = newValue;
        } else if (key === 'ignoreHeaders') {
            ignoreHeaders = newValue;
        } else if (key === 'enableRequestHeaderFilter') {
            enableRequestHeaderFilter = newValue;
        } else if (key === 'hideFailedRequests') {
            hideFailedRequests = newValue;
        } else if (key === 'useSession') {
            useSession = newValue;
        } else if (key === 'useSeparateLines') {
            useSeparateLines = newValue;
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

class PythonRequestsTransformer {
    constructor(har) {
        this.har = har;
        this.cookies = {};
    }

    generateRequestsOutput() {
        let requests = [];
        // Browsers *should* sort the entries ascending by start time, but chrome apparently doesn't.
        this.har.entries.sort((a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime));
        for (let entry of this.har.entries) {
            const pythonRequest = this.handleEntry(entry);
            if (pythonRequest) {
                requests.push(pythonRequest);
            }
        }
        if (useSession && requests.length > 0) {
            requests.unshift("s = requests.session()");
        }
        return requests;
    }

    handleEntry(har_entry) {
        let output = "";
        const request = har_entry.request;
        const response = har_entry.response;
        const requestOrigin = new URL(request.url).origin;
        const responseOutput = this.handleResponse(requestOrigin, response);
        if (responseOutput === false) {
            return output;
        }
        output += responseOutput;
        output += this.generateRequestOutput(requestOrigin, request);
        return output;
    }

    // Collect cookies that are set by requests in the captured session.
    // We can omit these cookies from the requests output, because they are
    // set dynamically by a previous request in the session.
    extractCookies(requestOrigin, cookies) {
        // TODO: Obey cookie attributes like Domain or Path
        this.cookies[requestOrigin] = this.cookies[requestOrigin] ?? new Set();
        for (let cookie of cookies) {
            this.cookies[requestOrigin].add(cookie.name);
        }
    }

    handleResponse(requestOrigin, response) {
        let output = "";
        this.extractCookies(requestOrigin, response.cookies);
        if (response.cookies.length > 0) {
            output += `# Response sets cookie: ${response.cookies.map(cookie => `${cookie.name} = ${cookie.value}`).join(", ")}\n`;
        }

        // Hide requests to (probably) static resources.
        if (response.content && response.content.mimeType) {
            const contentType = response.content.mimeType;
            if (enableResponseContentTypeFilter && ignoreResponseContentTypes.some(ignoreContentType => contentType.toLowerCase().startsWith(ignoreContentType))) {
                if (response.cookies.length > 0) {
                    output += `# Response would be ignored due to content-type: ${contentType}, but left in because the response set cookies.\n`;
                } else {
                    return false;
                }
            }
        }

        // Maybe extend the list of HTTP status codes that are considered "failed".
        if ([0, 404].some(code => code === response.status)) {
            if (hideFailedRequests) {
                if (response.cookies.length > 0) {
                    output += `# Response would be ignored due to status-code, but left in because the response set cookies.\n`;
                } else {
                    return false;
                }
            }
            output += `# Request failed: ${response.status} ${response.statusText}\n`;
        }

        if (response.redirectURL) {
            output += `# Redirects to: ${response.redirectURL}\n`;
        }
        return output;
    }

    generateDict(name, elements) {
        let output = "";
        if (useSeparateLines) {
            if (typeof(elements) === "object") {
                output += `\n${name}={\n`;
                for (let elem of elements) {
                    output += `    ${elem},\n`
                }
                output += "}";
            } else {
                output += `\n${name}=${elements}`;
            }
        } else {
            if (typeof(elements) === "object") {
                output += ` ${name}={`;
                output += elements.join(", ");
                output += "}";
            } else {
                output += ` ${name}=${elements}`;
            }
        }
        return output;
    }

    generateRequestOutput(requestOrigin, request) {
        let output = "";
        if (useSession) {
            output += "s.";
        } else {
            output += "requests.";
        }
        const shortcut_methods = ["get", "post", "put", "delete", "head", "patch"];
        if (shortcut_methods.some(method => method === request.method.toLowerCase()))
            output += `${request.method.toLowerCase()}(`;
        else
            output += `request("${request.method}", `;
        output += `"${stripURLSearchParams(request.url)}"`;
        if (request.queryString && request.queryString.length > 0) {
            const pythonParams = request.queryString.map(qs => `${sanitizePython(qs.name)}: ${sanitizePython(qs.value)}`);
            output += "," + this.generateDict("params", pythonParams);
        }

        let stripContentType = true;
        if (request.postData) {
            const postData = request.postData;
            const mimeType = postData.mimeType.toLowerCase();
            if (mimeType.startsWith("application/x-www-form-urlencoded")) {
                const formFields = postData.params.map(p => `${sanitizePython(p.name)}: ${sanitizePython(p.value)}`);
                output += "," + this.generateDict("data", formFields);
            } else if (mimeType.startsWith("application/json")) {
                output += "," + this.generateDict("json", postData.text);
            } else if (mimeType.startsWith("multipart/form-data")) {
                const formFiles = postData.params.map(p => {
                    const name = sanitizePython(p.name);
                    const fileName = sanitizePython(p.fileName);
                    const value = sanitizePython(p.value);
                    if (p.contentType) {
                        return `${name}: (${fileName}, ${value}, ${sanitizePython(p.contentType)})`
                    } else {
                        return `${name}: (${fileName}, ${value})`
                    }
                });
                output += "," + this.generateDict("files", formFiles);
            } else if (mimeType.startsWith("text/plain")) {
                output += "," + this.generateDict("data", sanitizePython(postData.text));
            } else {
                // Best effort to convert the request.
                output += "," + this.generateDict("data", sanitizePython(postData.text));
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
            let filteredHeaders = request.headers;
            if (enableRequestHeaderFilter) {
                filteredHeaders = filteredHeaders.filter(h => !ignoreHeaders.some(ignoreHeader => ignoreHeader.toLowerCase() === h.name.toLowerCase()));
            } else {
                // Cookies are handled seperately
                filteredHeaders = filteredHeaders.filter(h => !['Cookie'].some(ignoreHeader => ignoreHeader.toLowerCase() === h.name.toLowerCase()));
            }
            const authHeader = request.headers.find(h => h.name.toLowerCase() === 'authorization');
            if (authHeader && authHeader.value.toLowerCase().startsWith('basic')) {
                try {
                    const auth = atob(authHeader.value.substring(6));
                    const [username, password] = auth.split(':');
                    output += "," + this.generateDict("auth", `(${sanitizePython(username)}, ${sanitizePython(password)})`);
                    filteredHeaders = filteredHeaders.filter(h => h.name.toLowerCase() !== 'authorization');
                } catch {
                }
            }
            if (stripContentType) {
                filteredHeaders = filteredHeaders.filter(h => h.name.toLowerCase() !== 'content-type');
            }
            if (filteredHeaders.length > 0) {
                filteredHeaders = filteredHeaders.map(h => `${sanitizePython(h.name)}: ${sanitizePython(h.value)}`);
                output += "," + this.generateDict("headers", filteredHeaders);
            }
        }

        const sessionCookies = this.cookies[requestOrigin];
        let cookies = [];
        for (let cookie of request.cookies) {
            if (useSession && sessionCookies.has(cookie.name)) {
                continue;
            }
            cookies.push(cookie);
        }
        
        if (cookies.length > 0) {
            cookies = cookies.map(c => `${sanitizePython(c.name)}: ${sanitizePython(c.value)}`);
            output += "," + this.generateDict("cookies", cookies);
        }

        output += ")";
        
        // chrome.devtools.inspectedWindow.eval(`console.log(\`${output}\`)`);
        return output;
    }
}

// Create a connection to the background page
var backgroundPageConnection = chrome.runtime.connect({
    name: "devtools-page"
});

backgroundPageConnection.onMessage.addListener(function (message) {
    // Handle responses from the background page, if any
    switch (message.type) {
        case "get-requests":
            chrome.devtools.network.getHAR(function (result) {
                const transformer = new PythonRequestsTransformer(result);
                // chrome.devtools.network.onRequestFinished.addListener(handleRequest);
                backgroundPageConnection.postMessage({"type": "requests", "requests": transformer.generateRequestsOutput(result)});
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

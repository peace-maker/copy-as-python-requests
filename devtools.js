// In-page cache of the user's options
let ignoreResponseContentTypes = [];
let ignoreHeaders = [];
let hideFailedRequests = true;
let useSession = true;
let useFunctions = false;

// Initialize the request filter settings cache.
chrome.storage.local.get(['ignoreResponseContentTypes', 'ignoreHeaders', 'hideFailedRequests', 'useSession', 'useFunctions'], (data) => {
    ignoreResponseContentTypes = data.ignoreResponseContentTypes;
    ignoreHeaders = data.ignoreHeaders;
    hideFailedRequests = data.hideFailedRequests;
    useSession = data.useSession;
    useFunctions = data.useFunctions;
});

// Update cache on change.
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace != 'local') return;
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        if (key === 'ignoreResponseContentTypes') {
            ignoreResponseContentTypes = newValue;
        } else if (key === 'ignoreHeaders') {
            ignoreHeaders = newValue;
        } else if (key === 'hideFailedRequests') {
            hideFailedRequests = newValue;
        } else if (key === 'useSession') {
            useSession = newValue;
        } else if (key === 'useFunctions') {
            useFunctions = newValue;
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
        
        if (useFunctions === true)
            output += this.generateRequestOutputWithFunctions(requestOrigin, request);
        else
            output += this.generateRequestOutput(requestOrigin, request);
        return output;
    }

    // Collect cookies that are set by requests in the captured session.
    // We can omit these cookies from the requests output, because they are
    // set dynamically by a previous reqeust in the session.
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
            if (ignoreResponseContentTypes.some(ignoreContentType => contentType.toLowerCase().startsWith(ignoreContentType))) {
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
            output += ", params={";
            output += request.queryString.map(qs => `${sanitizePython(qs.name)}: ${sanitizePython(qs.value)}`).join(", ");
            output += "}";
        }

        let stripContentType = true;
        if (request.postData) {
            const postData = request.postData;
            const mimeType = postData.mimeType.toLowerCase();
            if (mimeType.startsWith("application/x-www-form-urlencoded")) {
                output += ", data={";
                output += postData.params.map(p => `${sanitizePython(p.name)}: ${sanitizePython(p.value)}`).join(", ");
                output += "}";
            } else if (mimeType.startsWith("application/json")) {
                output += `, json=${postData.text}`;
            } else if (mimeType.startsWith("multipart/form-data")) {
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
            } else if (mimeType.startsWith("text/plain")) {
                output += `, data=${sanitizePython(postData.text)}`;
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

        const sessionCookies = this.cookies[requestOrigin];
        let cookies = [];
        for (let cookie of request.cookies) {
            if (useSession && sessionCookies.has(cookie.name)) {
                continue;
            }
            cookies.push(cookie);
        }
        
        if (cookies.length > 0) {
            output += ", cookies={";
            output += cookies.map(c => `${sanitizePython(c.name)}: ${sanitizePython(c.value)}`).join(", ");
            output += "}";
        }

        output += ")";
        
        // chrome.devtools.inspectedWindow.eval(`console.log(\`${output}\`)`);
        return output;
    }

    generateRequestOutputWithFunctions(requestOrigin, request) {
        let stripContentType = true;
        let output = "";

        output += "def "
        output += `${request.method.toLowerCase()}_`
        let functionName = request.url.split("//")[1].replaceAll(".","_").replaceAll("/","___").split("?")[0]
        output += `${functionName}():\n\t`
        if (request.postData) { // prepare
            const postData = request.postData;
            const mimeType = postData.mimeType.toLowerCase();
            if (mimeType.startsWith("application/x-www-form-urlencoded")) {
                output += "data={";
                output += postData.params.map(p => `${sanitizePython(p.name)}: ${sanitizePython(p.value)}`).join(", ");
                output += "}\n\t";
            } else if (mimeType.startsWith("application/json")) {
                output += `json=${postData.text}\n\t`;
            } else if (mimeType.startsWith("multipart/form-data")) {
                output += "files={";
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
                output += "}\n\t";
            } else if (mimeType.startsWith("text/plain")) {
                output += `data=${sanitizePython(postData.text)}\n\t`;
            } else {
                // Best effort to convert the request.
                output += `data=${sanitizePython(postData.text)}\n\t`;
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
        //prep headers 

        if (request.headers && request.headers.length > 0) {
            let filteredHeaders = request.headers.filter(h => !ignoreHeaders.some(ignoreHeader => ignoreHeader.toLowerCase() === h.name.toLowerCase()));
            const authHeader = request.headers.find(h => h.name.toLowerCase() === 'authorization');
            if (authHeader && authHeader.value.toLowerCase().startsWith('basic')) {
                try {
                    const auth = atob(authHeader.value.substring(6));
                    const [username, password] = auth.split(':');
                    output += `auth=(${sanitizePython(username)}, ${sanitizePython(password)})\n\t`;
                    filteredHeaders = filteredHeaders.filter(h => h.name.toLowerCase() !== 'authorization');
                } catch {
                }
            }
            if (stripContentType) {
                filteredHeaders = filteredHeaders.filter(h => h.name.toLowerCase() !== 'content-type');
            }
            filteredHeaders = filteredHeaders.map(h => `${sanitizePython(h.name)}: ${sanitizePython(h.value)}`);
            if (filteredHeaders.length > 0) {
                output += "headers={";
                output += filteredHeaders.join(", ");
                output += "}\n\t";
            }
        }
        //prepare params
        if (request.queryString && request.queryString.length > 0) {
            output += "params={";
            output += request.queryString.map(qs => `${sanitizePython(qs.name)}: ${sanitizePython(qs.value)}`).join(", ");
            output += "}\n\t";
        }

        //prepare cookies
        const sessionCookies = this.cookies[requestOrigin];
        let cookies = [];
        for (let cookie of request.cookies) {
            if (useSession && sessionCookies.has(cookie.name)) {
                continue;
            }
            cookies.push(cookie);
        }
        
        if (cookies.length > 0) {
            output += "cookies={";
            output += cookies.map(c => `${sanitizePython(c.name)}: ${sanitizePython(c.value)}`).join(", ");
            output += "}\n\t";
        }
        //end prepare 
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
            output += ", params=params";
        }

        
        if (request.postData) {
            const postData = request.postData;
            const mimeType = postData.mimeType.toLowerCase();
            if (mimeType.startsWith("application/x-www-form-urlencoded")) {
                output += ", data=data"
            } else if (mimeType.startsWith("application/json")) {
                output += `, json=json`;
            } else if (mimeType.startsWith("multipart/form-data")) {
                output += ", files=files";
            } else if (mimeType.startsWith("text/plain")) {
                output += `, data=data`;
            } else {
                // Best effort to convert the request.
                output += `, data=data`;
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
                    output += `, auth=auth`;
                    filteredHeaders = filteredHeaders.filter(h => h.name.toLowerCase() !== 'authorization');
                } catch {
                }
            }
            if (stripContentType) {
                filteredHeaders = filteredHeaders.filter(h => h.name.toLowerCase() !== 'content-type');
            }
            filteredHeaders = filteredHeaders.map(h => `${sanitizePython(h.name)}: ${sanitizePython(h.value)}`);
            if (filteredHeaders.length > 0) {
                output += ", headers=headers";
            }
        }
        
        if (cookies.length > 0) {
            output += ", cookies=cookies";
        }

        output += ")\n";
        
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

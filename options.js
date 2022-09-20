// In-page cache of the user's options
let ignoreResponseContentTypes = [];
let enableResponseContentTypeFilter = true;
let ignoreHeaders = [];
let enableRequestHeaderFilter = true;
let hideFailedRequests = true;

// Initialize the form with the user's option settings
chrome.storage.local.get(['ignoreResponseContentTypes', 'enableResponseContentTypeFilter', 'ignoreHeaders', 'enableRequestHeaderFilter', 'hideFailedRequests'], (data) => {
    ignoreResponseContentTypes = data.ignoreResponseContentTypes;
    enableResponseContentTypeFilter = data.enableResponseContentTypeFilter;
    ignoreHeaders = data.ignoreHeaders;
    enableRequestHeaderFilter = data.enableRequestHeaderFilter;
    hideFailedRequests = data.hideFailedRequests;
    renderOptions();
});

const removeChilds = (parent) => {
    while (parent.lastChild) {
        parent.removeChild(parent.lastChild);
    }
};

const addInputFields = (parentId, list) => {
    let parent = document.getElementById(parentId);
    removeChilds(parent);
    list.forEach((item) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = item;
        parent.appendChild(input);
    });
};

const renderOptions = () => {
    addInputFields('ignoreResponseContentTypes', ignoreResponseContentTypes);
    document.getElementById('enableResponseContentTypeFilter').checked = enableResponseContentTypeFilter;
    addInputFields('ignoreHeaders', ignoreHeaders);
    document.getElementById('enableRequestHeaderFilter').checked = enableRequestHeaderFilter;
    document.getElementById('hideFailedRequests').checked = hideFailedRequests;
}

// Handle the '+' buttons to add more form fields.
document.getElementById('addIgnoreResponseContentType').addEventListener('click', (e) => {
    e.preventDefault();
    const input = document.createElement('input');
    input.type = 'text';
    document.getElementById('ignoreResponseContentTypes').appendChild(input);
});

document.getElementById('addIgnoreHeader').addEventListener('click', (e) => {
    e.preventDefault();
    const input = document.createElement('input');
    input.type = 'text';
    document.getElementById('ignoreHeaders').appendChild(input);
});

// Update the local storage. Empty fields are ignored.
document.getElementById('save').addEventListener('click', (e) => {
    e.preventDefault();
    ignoreResponseContentTypes = [];
    let elements = document.querySelectorAll("#options > #ignoreResponseContentTypes input");
    elements.forEach((element) => {
        const type = element.value.trim();
        if (type) {
            ignoreResponseContentTypes.push(type);
        }
    });

    ignoreHeaders = [];
    elements = document.querySelectorAll("#options > #ignoreHeaders input");
    elements.forEach((element) => {
        const header = element.value.trim();
        if (header) {
            ignoreHeaders.push(header);
        }
    });

    enableResponseContentTypeFilter = document.getElementById('enableResponseContentTypeFilter').checked;
    enableRequestHeaderFilter = document.getElementById('enableRequestHeaderFilter').checked;
    hideFailedRequests = document.getElementById('hideFailedRequests').checked;

    chrome.storage.local.set({
        'ignoreResponseContentTypes': ignoreResponseContentTypes,
        'enableResponseContentTypeFilter': enableResponseContentTypeFilter,
        'ignoreHeaders': ignoreHeaders,
        'enableRequestHeaderFilter': enableRequestHeaderFilter,
        'hideFailedRequests': hideFailedRequests,
    }, () => {
        document.getElementById('status').innerText = 'Options saved';
    });
});

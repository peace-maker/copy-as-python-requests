Copy Requests as Python Requests
===

![Logo](icons/logo.svg)

WebExtension to export traffic of a tab into ready to go [Python Requests](https://requests.readthedocs.io/en/latest/) calls for faster traffic mimicing.

## Usage
With the extension installed:
1. Open the Browser Devtools.
2. Click around and generate the requests you want to export (see Network tab in Devtools).
3. Click extension icon in toolbar at the top.
4. Copy desired Python requests code from popup.

## Features
- Generate Python code for every request observed by the open devtools.
- Configurable filters through extension options page:
    - Ignore requests to static resources by filtering response content-types.
    - Ignore auto-generated HTTP headers like `User-Agent` and `Connection`.
- Optionally hide blocked requests or 404 responses for requests e.g. for missing `favicon.ico`.
- Optionally generate a `requests.session()` instance.
    - Try to hide cookies set by a response from an earlier request in the session.

## Development
Temporarily load the extension in [Firefox](about:debugging#/runtime/this-firefox) or [Chrome](chrome://extensions/) from the unpacked folder.

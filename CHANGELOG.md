# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Fix output of binary data using hex-encoding

## [1.1.0] - 2023-01-16

### Added

- Add option to quickly disable the whole filter lists.
- Add option to render params, headers, cookies etc on separate lines.

### Changed

- Removed unneeded `host` permission. Apparently the devtools permission is enough to read the network HAR.
- Sort requests by start date if they aren't already.

### Fixed

- Fixed generating of `multipart/form-data` postData when the params aren't available in a pre-parsed form in the HAR.
- Fixed extension losing connection to devtools after some time of inactivity.

## [1.0.0] - 2022-06-26

- Initial release

[1.1.0]: https://github.com/peace-maker/copy-as-python-requests/compare/v1.0_FF...v1.1.0
[1.0.0]: https://github.com/peace-maker/copy-as-python-requests/releases/tag/v1.0_FF

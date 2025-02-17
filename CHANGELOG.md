# Changelog

All notable changes to Carbon Commander will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- N/A

### Changed
- N/A

### Deprecated
- N/A

### Removed
- N/A

### Fixed
- N/A

### Security
- N/A

## [0.3.0] - 2025-02-16

### Added
- Expanded external tool ecosystem with new site-specific tools:
  - Amazon (product info, search, price tracking)
  - LinkedIn (profile, job, and company insights)
  - Bitbucket (repository management)
  - Hacker News (content retrieval)
  - Stock Markets (simple stock market data)
  - Twitch (channel and stream details)
  - YouTube (video and channel details)
- Enhanced test infrastructure with modular test suites and comprehensive runners
- Improved autocomplete and command history with host-specific storage
- Host-specific system prompts configuration
- Settings dialog with encrypted key management
- Secure messaging system with signature verification
- Enhanced MCP service management with configuration UI

### Changed
- Restructured project architecture with clearer separation of concerns
- Enhanced settings management across the application

### Fixed
- Improved Ollama and OpenAI key configuration handling
- Enhanced error handling for OpenAI and Ollama connections
- Multiple build system improvements
- Error handling improvements for tool calls in OpenAI

### Security
- Implemented secure messaging with signature verification
- Added authentication token management
- Enhanced encrypted key storage mechanism
- Improved secure initialization process

## [0.2.0] - 2025-02-11

### Added
- [Untested] MCP (Model Context Protocol) integration with comprehensive setup guide
- [Untested] Customizable keyboard shortcuts with UI configuration options
- [Untested] Various service integrations
- Tool list UI
- Enhanced documentation for MCP setup and usage

### Changed
- Reorganized tool system architecture for better extensibility
- Enhanced command palette positioning and interaction
- Updated documentation to reflect new features and capabilities

## [0.1.0] - 2025-02-10
- Initial release of my Chrome extension
- Basic command palette functionality
- AI integration with OpenAI and Ollama
- Chrome extension packaging and distribution

[Unreleased]: https://github.com/carbonitex/carbon-commander/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/carbonitex/carbon-commander/releases/tag/v0.1.0 
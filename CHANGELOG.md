# Change Log

## [1.7.0] - 2025-01-22

### Changed
- Implemented exponential backoff with retries in the browser method to avoid being blocked by anti-detection measures.
- Added random user agent rotation from a list of common user agents.
- Added `Accept-Language`, `Accept`, and `Cache-Control` headers to the browser method.
- Added a delay with exponential backoff before navigating to the page.
- Enabled JavaScript in the browser method.
- Set viewport to a common desktop resolution in the browser method.
- Added common browser permissions to the browser method.
- Added common browser features to avoid detection.
- Added a wait for specific content to be loaded in the browser method.

## [1.6.0] - 2024-12-12

### Changed
- Updated Puppeteer navigation strategy to use `networkidle0` for more reliable page loading.
- Improved browser-method link handling to ensure navigation menu links are included in crawling while keeping content clean.
- Enhanced URL processing to convert relative links to absolute URLs in browser-based crawling.

### Fixed
- Resolved issue where some pages were not fully parsed due to insufficient waiting conditions.
- Corrected link processing to ensure all links are properly formatted and included in the crawl.

## [1.5.1] - 2024-11-29

### Fixed
- Removed unnecessary newlines at the start of generated content
- Improved file compatibility with Windsurf by eliminating extra spacing

## [1.5.0] - 2024-11-28

### Added
- File selection button for appending to existing files
- Improved file settings UI with cleaner button layout
- Added headers to crawled content (File/Source information)
- Improved filepath handling for better folder detection

## [1.4.1] - 2024-11-27

### Added
- Custom output file naming option in UI
- Added demo GIF to README for better feature visualization

## [1.3.0] - 2024-11-24

### Added
- Major internal refactoring for improved code maintainability
- Enhanced error handling and reporting
- Dedicated service architecture for better separation of concerns
- Improved type safety throughout the codebase
- Better content cleaning and formatting:
  - Enhanced SVG handling in browser method
  - Improved navigation and footer removal
  - Fixed JSON file formatting in GitHub repository crawling
  - Added non-text file skipping in repository crawling

## [1.2.0] - 2024-11-22

### Added
- GitHub repository documentation generation
- Support for both full repositories and specific directories
- Depth-based file filtering for repository crawling

### Changed
- Improved webview UI text for better clarity and consistency
- Refactored webview code

## [1.1.0] - 2024-11-21

### Added
- Alternative browser-based scraping method
- Method selection dropdown in UI

## [1.0.3] - 2024-11-20

### Changed
- Improved crawling logic to follow subdirectory structure from initial URL
- Updated documentation to reflect new crawling behavior

### Fixed
- Version compatibility issue with VS Code types

## [1.0.0] - 2024-11-19

### Added
- Complete documentation with installation guides
- Marketplace publishing preparation

## [0.9.0] - 2024-11-19

### Added
- Auto-open file setting with checkbox in UI
- Improved UI consistency with VS Code's native look

## [0.8.0] - 2024-11-19

### Added
- Box-sizing fixes for better UI rendering
- Repository field to package.json

### Changed
- Improved file naming to include full URL path instead of just domain
- Removed command palette entry in favor of sidebar UI
- Updated README to reflect new sidebar-based workflow

## [0.7.0] - 2024-11-19

### Changed
- Separated HTML, CSS, and JavaScript into distinct files
- Improved code organization and maintainability
- Enhanced webview UI with better styling

## [0.6.0] - 2024-11-19

### Added
- Real-time progress tracking
- Stop crawling functionality
- Depth control slider with descriptions

### Changed
- Improved error handling and status messages
- Enhanced UI with better visual feedback

## [0.5.0] - 2024-11-19

### Added
- Crawling depth control
- Progress indicators
- Better error messages

### Fixed
- URL validation issues
- File saving reliability

## [0.4.0] - 2024-11-19

### Added
- Support for recursive crawling
- Link extraction functionality
- Depth-based crawling limits

## [0.3.0] - 2024-11-19

### Added
- Integration with Jina AI Reader API
- Markdown conversion functionality
- File saving capabilities

## [0.2.0] - 2024-11-19

### Added
- Basic webview implementation
- URL input functionality
- Initial UI design

## [0.1.0] - 2024-11-19

### Added
- Initial release
- Basic project structure
- Core extension setup

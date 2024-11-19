# Docs Miner VSCode Extension

This extension allows you to generate markdown documentation from web pages using the Jina AI Reader API.

## Features

- Generate markdown documentation from any web URL
- Control crawling depth for documentation generation
- Real-time progress tracking
- Stop crawling at any time
- Automatically saves the markdown file in your current workspace
- Opens the generated file for immediate viewing

## Usage

1. Open the Docs Miner sidebar (look for the Docs Miner icon in the Activity Bar)
2. Enter the URL you want to generate documentation from
3. Adjust the crawling depth using the slider:
   - Depth 1: Single page only
   - Depth 2: Page and direct links
   - Depth 3: Medium depth crawl
   - Depth 4: Deep crawl
   - Depth 5: Very deep crawl
4. Click "Start Crawling" to begin
5. Monitor the progress in real-time
6. Use the "Stop Crawling" button if you want to end the process early

The markdown file will be automatically created in your current workspace and opened for viewing.

## Requirements

- VSCode 1.95.0 or higher
- Active internet connection

## Installation

### VS Code Marketplace
1. Open VS Code
2. Go to the Extensions view (Ctrl+Shift+X)
3. Search for "Docs Miner"
4. Click Install

### Building from Source
1. Clone the repository: `git clone https://github.com/3choff/docs-miner`
2. Run `npm install` in the terminal
3. Run `npm run compile` to build the extension
4. To create a VSIX package:
   - Install vsce: `npm install -g @vscode/vsce`
   - Run `vsce package`
   - The .vsix file will be created in the root directory
5. To install the VSIX:
   - Go to VS Code Extensions view
   - Click the '...' menu (top-right)
   - Select 'Install from VSIX...'
   - Choose the generated .vsix file

## Technical Notes
- The extension uses the Jina AI Reader API for markdown conversion
- Output quality and content extraction depends on Jina AI's capabilities and limitations
- Rate limiting: 1 second delay between requests to prevent overloading
- May be affected by website's robots.txt and rate limiting policies
- Skips non-documentation links (PDFs, executables, etc.)

## Links
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=3choff.docs-miner)
- [GitHub Repository](https://github.com/3choff/docs-miner)

## Author
- [3choff](https://github.com/3choff)


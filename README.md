# Docs Miner VSCode Extension

This extension allows you to generate markdown documentation from web pages using the Jina AI Reader API.

If you find Docs Miner useful, please consider leaving a star ⭐ or [donate](https://ko-fi.com/3choff).

## Features

- Generate markdown documentation from any web URL
- Smart crawling that follows subdirectory structure from the initial URL
- Configurable crawling depth with precise level control
- Real-time progress tracking
- Stop crawling at any time
- Automatically saves the markdown file in your current workspace
- Opens the generated file for immediate viewing

## Usage

1. Open the Docs Miner sidebar (look for the Docs Miner icon in the Activity Bar)
2. Enter the URL you want to generate documentation from
3. Specify the output folder for the generated documentation
4. Adjust the crawling depth using the slider:
   - Depth 1: Current page only
   - Depth 2: Current page + one level down
   - Depth 3: Current page + two levels down
   - Depth 4: Current page + three levels down
   - Depth 5: Current page + four levels down
5. Click "Start Crawling" to begin
6. Monitor the progress in real-time
7. Use the "Stop Crawling" button if you want to end the process early

The markdown file will be automatically created in your specified output folder and opened for viewing.

## Requirements

- VSCode 1.80.0 or higher
- Active internet connection

## Installation

Choose one of the following installation methods:

### 1. VS Code Marketplace
1. Open VS Code
2. Go to the Extensions view (Ctrl+Shift+X)
3. Search for "Docs Miner"
4. Click Install

### 2. GitHub Release
1. Go to the [latest release](https://github.com/3choff/docs-miner/releases/latest)
2. Download the `docs-miner-1.0.0.vsix` file
3. In VS Code:
   - Go to Extensions view (Ctrl+Shift+X)
   - Click '...' menu (top-right)
   - Select 'Install from VSIX...'
   - Choose the downloaded file

### 3. Building from Source
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
- Crawling is restricted to subdirectories of the initial URL to ensure focused documentation
- Output quality and content extraction depends on Jina AI's capabilities and limitations
- Rate limiting: 1 second delay between requests to prevent overloading
- May be affected by website's robots.txt and rate limiting policies
- Skips non-documentation links (PDFs, executables, etc.)

## Links
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=3choff.docs-miner)
- [GitHub Repository](https://github.com/3choff/docs-miner)

## Author
- [3choff](https://github.com/3choff)


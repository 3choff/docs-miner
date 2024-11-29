# Docs Miner

A VSCode extension that generates markdown documentation from web pages and GitHub repositories.

<p align="left">
  <img src="https://raw.githubusercontent.com/3choff/docs-miner/main/media/demo.gif" width="800" alt="Demo">
</p>

If you find Docs Miner useful, please consider leaving a star ⭐ on [github repository](https://github.com/3choff/docs-miner) or buying me a [coffee](https://ko-fi.com/3choff) ☕ to keep me motivated to work on this project.

## Features

- Generate markdown documentation from any web URL or GitHub repository
- Two scraping methods:
  - API Method (Faster but may fail on some sites)
  - Browser Method (Slower but more reliable)
- Smart crawling that follows:
  - Subdirectory structure from the initial URL for websites
  - Repository file structure for GitHub repositories
- Configurable crawling depth with precise level control
- Real-time progress tracking
- Stop crawling at any time
- Automatically saves the markdown file in your current workspace
- Opens the generated file for immediate viewing

## Usage

1. Open the Docs Miner sidebar (look for the Docs Miner icon in the Activity Bar)
2. Enter the URL you want to generate documentation from:
   - For websites: any web URL (e.g., https://example.com)
   - For GitHub: repository URL (e.g., https://github.com/username/repo) or specific directory (e.g., https://github.com/username/repo/tree/main/docs)
3. Adjust the crawling depth using the slider:

   <details>
   <summary>Website depth levels</summary>

   - Depth 1: Only the entered page
   - Depth 2: The entered page and links at the same directory level
   - Depth 3: The entered page and links up to two directory levels
   - Depth 4: The entered page and links up to three directory levels
   - Depth 5: The entered page and links up to four directory levels
   </details>
   <br/>
   <details>
   <summary>GitHub repository depth levels</summary>

   - Depth 1: Root files only
   - Depth 2: Root + one directory level
   - Depth 3: Root + two directory levels
   - Depth 4: Root + three directory levels
   - Depth 5: Root + four directory levels
   </details>
   <br/>
4. Specify the file name for the generated documentation. If not specified, the URL will be used instead.
5. Specify the output folder for the generated documentation. If not specified, the current workspace folder will be used.
6. Alternatively, use the "Add to File" button to choose an existing markdown file to append the crawled content to.
7. Click "Start Crawling" to begin
8. Monitor the progress in real-time
9. Use the "Stop Crawling" button if you want to end the process early

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
2. Download the latest `docs-miner-x.x.x.vsix` file
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
- The extension offers two methods for content extraction:
  - Jina AI Reader API: Fast but may fail on some websites
  - Browser-based scraping: More reliable but slower, handles JavaScript-heavy sites
- Crawling is restricted to subdirectories of the initial URL to ensure focused documentation
- Rate limiting: 0.5 second delay between requests to prevent overloading
- May be affected by website's robots.txt and rate limiting policies
- Skips non-documentation links (Images, executables, etc.)

## Links
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=3choff.docs-miner)
- [Open VSX Registry](https://open-vsx.org/extension/3choff/docs-miner)
- [GitHub Repository](https://github.com/3choff/docs-miner)

## Author
- [3choff](https://github.com/3choff)

## Contributing
Feedback and contributions are welcome. If you encounter any issues or have suggestions for improvements, please create a new [issue](https://github.com/3choff/docs-miner/issues) on the GitHub repository.

If you'd like to contribute to the development of the extension, feel free to submit a pull request with your changes.

## License
This extension is licensed under the [MIT License](https://github.com/3choff/docs-miner/blob/main/LICENSE).
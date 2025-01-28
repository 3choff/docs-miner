import * as vscode from 'vscode';
import * as fs from 'fs';
import axios from 'axios';
import PCR from 'puppeteer-chromium-resolver';
import { ICrawlerService, CrawlOptions, GithubInfo } from '../types';
import { ContentProcessor } from './ContentProcessor';
import { FileService } from './FileService';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { Browser } from 'puppeteer-core';

export class CrawlerService implements ICrawlerService {
    private stopCrawling: boolean = false;
    private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    private readonly EXCLUDED_EXTENSIONS: Map<string, string> = (() => {
        const extensionGroups = {
            'Image file': ['jpg', 'jpeg', 'png', 'gif', 'ico', 'svg'],
            'Font file': ['ttf', 'woff', 'woff2', 'eot'],
            'Audio file': ['mp3', 'wav', 'ogg'],
            'Video file': ['mp4', 'webm', 'avi'],
            'Document file': ['pdf', 'doc', 'docx'],
            'Archive file': ['zip', 'tar', 'gz', 'rar'],
            'Binary executable/library file': ['exe', 'dll', 'so', 'dylib']
        };

        return new Map(
            Object.entries(extensionGroups).flatMap(([reason, extensions]) =>
                extensions.map(ext => [ext, reason])
            )
        );
    })();

    constructor(
        private contentProcessor: ContentProcessor,
        private fileService: FileService
    ) {}

    public stop(): void {
        this.stopCrawling = true;
    }

    public async crawl(options: CrawlOptions, webview: vscode.Webview): Promise<void> {
        this.stopCrawling = false;
        const startTime = new Date();
        // await this.fileService.saveContent('', false);

        // Check if output file exists
        const outputFile = this.fileService.getOutputFile();
        if (!outputFile || !fs.existsSync(outputFile)) {
            // If file doesn't exist, create empty file (current behavior)
            await this.fileService.saveContent('', false);
        }

        try {
            if (options.url.includes('github.com')) {
                await this.crawlGithubRepo(options, webview, startTime);
            } else {
                await this.crawlWebsite(options, webview, startTime);
            }
        } catch (error) {
            this.handleError(error, webview);
        } finally {
            if (this.stopCrawling) {
                webview.postMessage({
                    type: 'status',
                    message: 'Crawling stopped by user'
                });
            }
        }
    }

    private parseGithubUrl(url: string): GithubInfo {
        const urlParts = new URL(url);
        const pathParts = urlParts.pathname.split('/').filter(Boolean);
        
        // Check if URL contains a specific branch path
        const treeIndex = pathParts.indexOf('tree');
        const hasBranchInUrl = treeIndex !== -1 && pathParts.length > treeIndex + 1;
        
        return {
            owner: pathParts[0],
            repo: pathParts[1],
            type: hasBranchInUrl ? pathParts[treeIndex] : 'tree',
            branch: hasBranchInUrl ? pathParts[treeIndex + 1] : 'main',
            basePath: hasBranchInUrl ? pathParts.slice(treeIndex + 2).join('/') : '',
            isSpecificPath: hasBranchInUrl && pathParts.length > treeIndex + 2,
            branchSpecifiedInUrl: hasBranchInUrl
        };
    }

    private async crawlGithubRepo(options: CrawlOptions, webview: vscode.Webview, startTime: Date): Promise<void> {
        try {
            let githubInfo = this.parseGithubUrl(options.url);
            
            // Get repository contents and update branch if needed
            const files = await this.getRepoContents(githubInfo.owner, githubInfo.repo, options.branch || githubInfo.branch);
            // Update githubInfo with the actual branch being used
            if (files.actualBranch) {
                githubInfo = {
                    ...githubInfo,
                    branch: files.actualBranch
                };
            }

            const initialHeader = [
                `# Repository: ${githubInfo.owner}/${githubInfo.repo}`,
                `## Branch: ${githubInfo.branch}`,
            ].join('\n');
            await this.fileService.saveContent(initialHeader, true);
            webview.postMessage({
                type: 'status',
                message: `Starting GitHub repository crawl: \n${githubInfo.owner}/${githubInfo.repo}`
            });

            const filteredFiles = this.filterFiles(files.tree, githubInfo, options.depth);

            webview.postMessage({
                type: 'status',
                message: `Found ${filteredFiles.length} files to process within depth ${options.depth}`
            });

            const processedFiles = await this.processGithubFiles(filteredFiles, githubInfo, options, webview, startTime);
            
            const finalMessage = this.stopCrawling ? 
                `Crawling stopped by user. \nProcessed ${processedFiles} of ${filteredFiles.length} files.` :
                `Completed! \nProcessed ${processedFiles} of ${filteredFiles.length} files in ${((new Date().getTime() - startTime.getTime()) / 1000).toFixed(1)} seconds.`;

            webview.postMessage({
                type: 'status',
                message: finalMessage
            });

            await this.saveGithubStats(options.url, githubInfo, options.depth, filteredFiles.length, startTime, webview);
        } catch (error) {
            // Enhanced error handling
            let errorMessage = 'An unknown error occurred';
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    errorMessage = `Repository not found: ${options.url}`;
                } else if (error.response?.status === 403) {
                    errorMessage = 'Rate limit exceeded or access denied';
                } else if (error.response?.data?.message) {
                    errorMessage = `GitHub API Error: ${error.response.data.message}`;
                } else {
                    errorMessage = `Network error: ${error.message}`;
                }
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }

            console.error('Crawling failed:', errorMessage);
            
            // Send error status to webview
            webview.postMessage({
                type: 'status',
                message: `Error: ${errorMessage}`,
                isError: true
            });

            // Reset crawling state in webview
            webview.postMessage({
                type: 'crawlingComplete',
                success: false
            });

            // Save error information to the output file
            const errorContent = [
                '\n\n# Crawling Error',
                '',
                `Error occurred while crawling ${options.url}`,
                '',
                `**Error:** ${errorMessage}`,
                '',
                `**Time:** ${new Date().toLocaleString()}`,
                '',
                '---\n'
            ].join('\n');

            await this.fileService.saveContent(errorContent, true);
        }
    }

    private async getRepoContents(owner: string, repo: string, branch: string): Promise<any> {
        try {
            const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
            const repoResponse = await axios.get(repoUrl);
            
            // Use provided branch if available, otherwise use default
            const branchToUse = branch || repoResponse.data.default_branch;
            
            const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branchToUse}?recursive=1`;
            const branchResponse = await axios.get(treeUrl);
            
            return {
                tree: branchResponse.data.tree,
                actualBranch: branchToUse
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('GitHub API Error Details:');
                console.error('- Status:', error.response?.status);
                console.error('- Status Text:', error.response?.statusText);
                console.error('- Response Data:', error.response?.data);
                console.error('- Request URL:', error.config?.url);
                console.error('- Request Method:', error.config?.method);
            }
            throw error;
        }
    }
    
    private async getAvailableBranches(owner: string, repo: string): Promise<{ branches: string[], defaultBranch: string }> {
        try {
            // Get repository info for default branch
            const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
            const repoResponse = await axios.get(repoUrl);
            const defaultBranch = repoResponse.data.default_branch;

            // Get all branches
            const branchesUrl = `https://api.github.com/repos/${owner}/${repo}/branches`;
            const branchesResponse = await axios.get(branchesUrl);
            const branches = branchesResponse.data.map((branch: any) => branch.name);
            

            branches.forEach((branch: string) => {
                console.log(`- ${branch}${branch === defaultBranch ? ' (default)' : ''}`);
            });
            
            return {
                branches,
                defaultBranch
            };
        } catch (error) {
            console.error('Error fetching branches:', error);
            throw new Error('Failed to fetch repository branches');
        }
    }

    private filterFiles(files: any[], githubInfo: GithubInfo, depth: number): any[] {
        return files.filter((file: any) => {
            if (file.type !== 'blob') return false;
            
            if (githubInfo.isSpecificPath && !file.path.startsWith(githubInfo.basePath)) {
                return false;
            }

            const relativePath = githubInfo.isSpecificPath 
                ? file.path.slice(githubInfo.basePath.length).replace(/^\//, '')
                : file.path;
            const fileDepth = relativePath.split('/').filter(Boolean).length;
            
            return fileDepth <= depth;
        });
    }

    private async processGithubFiles(
        files: any[],
        githubInfo: GithubInfo,
        options: CrawlOptions,
        webview: vscode.Webview,
        startTime: Date
    ): Promise<number> {
        let currentFile = 0;
        const totalFiles = files.length;

        for (const file of files) {
            if (this.stopCrawling) {
                break;
            }

            currentFile++;
            webview.postMessage({
                type: 'status',
                message: `[${currentFile}/${totalFiles}] ${file.path}\nDepth: ${file.path.split('/').length}/${options.depth}`
            });

            try {
                const extension = file.path.split('.').pop()?.toLowerCase() || '';
                const language = extension;
                let content;

                if (this.EXCLUDED_EXTENSIONS.has(extension)) {
                    // Generate skip message based on extension type
                    const skipReason = this.EXCLUDED_EXTENSIONS.get(extension)!;

                    content = [
                        `\n\n## File: ${file.path}`,
                        `### URL: https://github.com/${githubInfo.owner}/${githubInfo.repo}/blob/${githubInfo.branch}/${file.path}`,
                        '',
                        `Content skipped: ${skipReason}`,
                        '---\n'
                    ].join('\n');
                } else {
                    const rawUrl = `https://raw.githubusercontent.com/${githubInfo.owner}/${githubInfo.repo}/${githubInfo.branch}/${file.path}`;
                    const response = await axios.get(rawUrl, {
                        headers: { 'User-Agent': this.USER_AGENT }
                    });

                    // Handle JSON files specially
                    if (language === 'json') {
                        content = [
                            `\n\n## File: ${file.path}`,
                            `### URL: https://github.com/${githubInfo.owner}/${githubInfo.repo}/blob/${githubInfo.branch}/${file.path}`,
                            '',
                            '```' + language,
                            typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2),
                            '```',
                            '---\n'
                        ].join('\n');
                    } else {
                        content = [
                            `\n\n## File: ${file.path}`,
                            `### URL: https://github.com/${githubInfo.owner}/${githubInfo.repo}/blob/${githubInfo.branch}/${file.path}`,
                            '',
                            '```' + language,
                            response.data,
                            '```',
                            '---\n'
                        ].join('\n');
                    }
                }

                await this.fileService.saveContent(content, true);
            } catch (error) {
                this.handleFileError(error, file.path, webview);
            }
        }

        return currentFile;
    }

    private async crawlWebsite(options: CrawlOptions, webview: vscode.Webview, startTime: Date): Promise<void> {
        const initialHeader = [`# Source: ${options.url}`].join('\n');
        await this.fileService.saveContent(initialHeader, true);
        const visited = new Set<string>();
        const toVisit = [{ url: options.url, depth: 0 }];
        const plannedVisits = new Set([options.url]);
        let currentPage = 0;

        const baseUrlObj = new URL(options.url);
        const basePathParts = baseUrlObj.pathname.split('/').filter(Boolean);

        webview.postMessage({
            type: 'status',
            message: `Starting crawl from ${options.url} with depth ${options.depth}`
        });

        if (options.method === 'api') {
            while (toVisit.length > 0 && !this.stopCrawling) {
                const current = toVisit.shift()!;
                if (visited.has(current.url) || current.depth >= options.depth) {
                    continue;
                }
        
                currentPage++;
                visited.add(current.url);
        
                webview.postMessage({
                    type: 'status',
                    message: `[${currentPage}/${plannedVisits.size}] ${current.url}\nDepth: ${current.depth + 1}/${options.depth}`
                });
        
                try {
                    const response = await axios.get(`https://r.jina.ai/${current.url}`, {
                        timeout: 30000,
                        headers: { 'Accept': 'text/markdown' }
                    });
                    const formattedContent = [
                        `\n\n## URL: ${current.url}`,
                        '',
                        response.data,
                        '---\n'
                    ].join('\n');
                    await this.fileService.saveContent(formattedContent, true);
        
                    if (current.depth < options.depth - 1) {
                        const regex = /\[.*?\]\((.*?)\)/g;
                        const links: string[] = [];
                        let match;
                        
                        while ((match = regex.exec(response.data)) !== null) {
                            try {
                                const href = match[1];
                                if (this.isValidLink(href)) {
                                    const fullUrl = new URL(href, current.url).href;
                                    if (fullUrl.startsWith('http') && this.isWithinDocs(fullUrl, baseUrlObj, basePathParts, options.depth)) {
                                        links.push(fullUrl);
                                    }
                                }
                            } catch (e) {
                                console.error('Invalid URL:', e);
                            }
                        }
        
                        let newLinks = 0;
                        for (const link of links) {
                            if (!visited.has(link) && !plannedVisits.has(link)) {
                                toVisit.push({ url: link, depth: current.depth + 1 });
                                plannedVisits.add(link);
                                newLinks++;
                            }
                        }
        
                        webview.postMessage({
                            type: 'status',
                            message: `Found ${newLinks} new links in ${current.url}`
                        });
                    }
        
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    this.handleError(error, webview);
                }
            }
        } else if (options.method === 'browser') {
            // Browser method
            const browser = await this.launchBrowser();
            const page = await browser.newPage();

            while (toVisit.length > 0 && !this.stopCrawling) {
                const current = toVisit.shift()!;
                if (visited.has(current.url) || current.depth >= options.depth) {
                    continue;
                }

                currentPage++;
                visited.add(current.url);

                webview.postMessage({
                    type: 'status',
                    message: `[${currentPage}/${plannedVisits.size}] ${current.url}\nDepth: ${current.depth + 1}/${options.depth}`
                });

                try {
                    await page.goto(current.url, {
                        timeout: 10000,
                        waitUntil: ['domcontentloaded', 'networkidle2'],
                    });
                    const content = await page.content();

                    // Use Cheerio to parse and clean up the HTML
                    const $ = cheerio.load(content);
                    $("script, style, nav, footer, header").remove(); // Remove unnecessary elements

                    // Convert cleaned HTML to markdown
                    const turndownService = new TurndownService();
                    const markdown = turndownService.turndown($.html());

                    const formattedContent = [
                        `\n\n## URL: ${current.url}`,
                        '',
                        markdown, // Save the markdown content
                        '---\n'
                    ].join('\n');

                    await this.fileService.saveContent(formattedContent, true);

                    if (current.depth < options.depth - 1) {
                        webview.postMessage({
                            type: 'status',
                            message: `Finding links in ${current.url}...`
                        });

                        const links = await this.getLinks(current.url, baseUrlObj, basePathParts, options.depth);
                        let newLinks = 0;

                        for (const link of links) {
                            if (!visited.has(link) && !plannedVisits.has(link)) {
                                toVisit.push({ url: link, depth: current.depth + 1 });
                                plannedVisits.add(link);
                                newLinks++;
                            }
                        }

                        webview.postMessage({
                            type: 'status',
                            message: `Found ${newLinks} new links in ${current.url}`
                        });
                    }

                    // Add a small delay between requests to avoid overwhelming the server
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    this.handleError(error, webview);
                }
            }

            await browser.close(); // Close the browser after crawling
        }

        const finalMessage = this.stopCrawling ? 
            `Crawling stopped by user. Processed ${currentPage} pages.` :
            `Completed! Processed ${currentPage} pages in ${((new Date().getTime() - startTime.getTime()) / 1000).toFixed(1)} seconds.`;

        webview.postMessage({
            type: 'status',
            message: finalMessage
        });

        await this.saveWebsiteStats(
            options.url,
            options.depth,
            visited,
            startTime,
            options.method,
            webview
        );
    }

    private async launchBrowser(): Promise<Browser> {
        const stats = await PCR();
        return await stats.puppeteer.launch({
            headless: true,
            args: [
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            ],
            executablePath: stats.executablePath,
        });
    }

    private async saveWebsiteStats(
        startUrl: string,
        depth: number,
        visited: Set<string>,
        startTime: Date,
        method: string,
        webview: vscode.Webview
    ): Promise<void> {
        const endTime = new Date();
        const duration = (endTime.getTime() - startTime.getTime()) / 1000;
        
        const stats = [
            '\n\n# Crawl Statistics',
            '',
            `- **Source:** ${startUrl}`,
            `- **Depth:** ${depth}`,
            `- **Pages processed:** ${visited.size}`,
            `- **Crawl method:** ${method}`,
            `- **Duration:** ${duration.toFixed(2)} seconds`,
            `- **Crawl completed:** ${endTime.toLocaleString()}`,
            ''
        ].join('\n') + '\n';

        await this.fileService.saveContent(stats, true);

        webview.postMessage({
            type: 'checkAutoOpen',
            filePath: this.fileService.getOutputFile()
        });
    }

    private async getPageContent(url: string, method: string): Promise<string> {
        try {
            if (method === 'api') {
                const response = await axios.get(`https://r.jina.ai/${url}`, {
                    timeout: 30000,
                    headers: { 'Accept': 'text/markdown' }
                });
                return response.data;
            } else {
                return this.getContentWithPuppeteer(url);
            }
        } catch (error) {
            throw new Error(`Failed to get content from ${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async getContentWithPuppeteer(url: string, retryCount = 0, maxRetries = 3): Promise<string> {
        const stats = await PCR();
        const browser = await stats.puppeteer.launch({
            headless: true,
            args: [
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox"
            ],
            executablePath: stats.executablePath,
        });
    
        try {
            const page = await browser.newPage();
            
            // Rotate between different user agents
            const userAgents = [
                // Chrome on different platforms
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                
                // Firefox on different platforms
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
                
                // Safari
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
                
                // Edge
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
                
                // Opera
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0'
            ];
            await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
            
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Cache-Control': 'no-cache'
            });
    
            // Exponential backoff delay
            const delay = Math.min(Math.pow(2, retryCount) * 3000 + Math.random() * 1000, 15000);
            await new Promise(resolve => setTimeout(resolve, delay));

            // Enable JavaScript
            await page.setJavaScriptEnabled(true);

            // Set viewport like a real desktop browser
            await page.setViewport({
                width: 1920,
                height: 1080,
                deviceScaleFactor: 1,
            });

            // Add common browser permissions
            const context = browser.defaultBrowserContext();
            await context.overridePermissions(url, [
                'geolocation',
                'notifications',
                'camera',
                'microphone'
            ]);

            // Set common browser features
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false,
                });
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en'],
                });
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [
                        {
                            name: 'Chrome PDF Plugin',
                            description: 'Portable Document Format',
                            filename: 'internal-pdf-viewer'
                        }
                    ],
                });
            });
            
            await page.goto(url, {
                timeout: 30000,
                waitUntil: ['domcontentloaded', 'networkidle2'],
            });
    
            // Wait for specific content to be loaded
            await page.waitForFunction(() => {
                return document.body.innerText.length > 100 && 
                       !document.body.innerText.includes('Just a moment...') &&
                       !document.body.innerText.includes('Waiting for');
            }, { timeout: 30000 });
    
            const content = await page.content();
            const $ = cheerio.load(content);
            $("script, style, nav, footer, header").remove();
    
            const turndownService = new TurndownService();
            return turndownService.turndown($.html());
        } catch (error) {
            if (retryCount < maxRetries) {
                return this.getContentWithPuppeteer(url, retryCount + 1, maxRetries);
            }
            throw error;
        } finally {
            await browser.close();
        }
    }
    
    
    private pageLinks: Map<string, string[]> = new Map();

    private async getLinks(url: string, baseUrlObj: URL, basePathParts: string[], maxDepth: number): Promise<string[]> {
        try {
            let links: string[];
            if (this.pageLinks.has(url)) {
                links = this.pageLinks.get(url)!;
            } else {
                const response = await axios.get(url, { 
                    timeout: 30000,
                    headers: { 'User-Agent': this.USER_AGENT }
                });
            
                links = [];
                const hrefRegex = /href=["']([^"']+)["']/g;
                let match;
                
                while ((match = hrefRegex.exec(response.data)) !== null) {
                    try {
                        const href = match[1];
                        if (this.isValidLink(href)) {
                            const fullUrl = new URL(href, url).href;
                            if (fullUrl.startsWith('http') && this.isWithinDocs(fullUrl, baseUrlObj, basePathParts, maxDepth)) {
                                links.push(fullUrl);
                            }
                        }
                    } catch (e) {
                        console.error('Invalid URL:', e);
                    }
                }
            }
            
            return [...new Set(links)].filter(link => 
                link.startsWith('http') && 
                this.isWithinDocs(link, baseUrlObj, basePathParts, maxDepth)
            );
        } catch (error) {
            console.error(`Error fetching links from ${url}:`, error);
            return [];
        }
    }

    private isValidLink(href: string): boolean {
        return !href.startsWith('#') && 
               !href.startsWith('javascript:') && 
               !href.match(/\.(pdf|zip|tar|gz|rar)$/i);
    }

    private isWithinDocs(url: string, baseUrlObj: URL, basePathParts: string[], maxDepth: number): boolean {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname !== baseUrlObj.hostname) {
                return false;
            }

            const urlPathParts = urlObj.pathname.split('/').filter(Boolean);
            for (let i = 0; i < basePathParts.length; i++) {
                if (urlPathParts[i] !== basePathParts[i]) {
                    return false;
                }
            }

            const depthDifference = urlPathParts.length - basePathParts.length;
            return depthDifference >= 0 && depthDifference < maxDepth;
        } catch {
            return false;
        }
    }

    private async saveGithubStats(
        startUrl: string,
        githubInfo: GithubInfo,
        depth: number,
        totalFiles: number,
        startTime: Date,
        webview: vscode.Webview
    ): Promise<void> {
        const endTime = new Date();
        const duration = (endTime.getTime() - startTime.getTime()) / 1000;
        
        const stats = [
            '\n\n# Crawl Statistics',
            '',
            `- **Source:** ${startUrl}`,
            `- **Repository:** ${githubInfo.owner}/${githubInfo.repo}`,
            `- **Branch:** ${githubInfo.branch}`,
            `- **Depth:** ${depth}`,
            `- **Files processed:** ${totalFiles}`,
            `- **Total files found:** ${totalFiles}`,
            `- **Duration:** ${duration.toFixed(2)} seconds`,
            `- **Crawl completed:** ${endTime.toLocaleString()}`,
            ''
        ].join('\n') + '\n';

        await this.fileService.saveContent(stats, true);

        webview.postMessage({
            type: 'checkAutoOpen',
            filePath: this.fileService.getOutputFile()
        });
    }

    private handleError(error: unknown, webview: vscode.Webview): void {
        console.error('Error during crawling:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        webview.postMessage({
            type: 'status',
            message: `Error: ${errorMessage}`,
            isError: true
        });
    }

    private handleFileError(error: unknown, filePath: string, webview: vscode.Webview): void {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        webview.postMessage({
            type: 'status',
            message: `Error processing ${filePath}: ${errorMessage}`,
            isError: true
        });
        this.fileService.saveContent(`\n\n# Error processing ${filePath}\n\n${errorMessage}\n\n---\n`, true)
            .catch(console.error);
    }

    public async handleGithubUrl(url: string, webview: vscode.Webview) {
        try {
            const githubInfo = this.parseGithubUrl(url);
            
            // If branch is specified in URL, don't show selector
            if (githubInfo.branchSpecifiedInUrl) {
                webview.postMessage({
                    type: 'populateBranches',
                    branches: [githubInfo.branch],
                    defaultBranch: githubInfo.branch,
                    branchSpecifiedInUrl: true
                });
                return;
            }
            
            // Otherwise, fetch available branches
            const branchInfo = await this.getAvailableBranches(githubInfo.owner, githubInfo.repo);
            
            webview.postMessage({
                type: 'populateBranches',
                branches: branchInfo.branches,
                defaultBranch: branchInfo.defaultBranch
            });
        } catch (error) {
            console.error('Error handling GitHub URL:', error);
        }
    }
}

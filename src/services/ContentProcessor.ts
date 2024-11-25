import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';
import { IContentProcessor } from '../types';

export class ContentProcessor implements IContentProcessor {
    private turndownService: TurndownService;
    private dom: JSDOM;

    constructor() {
        this.dom = new JSDOM('');
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });

        this.setupTurndownRules();
    }

    private setupTurndownRules(): void {
        // Add SVG cleaning rule
        this.turndownService.addRule('cleanSvgImages', {
            filter: (node: Node): boolean => {
                const { HTMLElement, HTMLImageElement } = this.dom.window;
                if (!(node instanceof HTMLElement)) {
                    return false;
                }
                if (!(node instanceof HTMLImageElement)) {
                    return false;
                }
                return node.nodeName === 'IMG' && 
                       (node.getAttribute('src')?.startsWith('data:image/svg') || 
                        node.src?.endsWith('.svg'));
            },
            replacement: (content: string, node: Node): string => {
                const { HTMLElement, HTMLImageElement } = this.dom.window;
                if (!(node instanceof HTMLElement)) {
                    return content;
                }
                if (!(node instanceof HTMLImageElement)) {
                    return content;
                }
                
                // Extract alt text or title for SVG
                const altText = node.alt || 
                              node.title || 
                              'Image';
                              
                // Return just the alt text without the image
                return altText;
            }
        });

        this.turndownService.addRule('preserveDocumentationCode', {
            filter: (node: Node): boolean => {
                const { HTMLElement } = this.dom.window;
                if (!(node instanceof HTMLElement)) {
                    return false;
                }

                const isCodeBlock = node.nodeName === 'PRE' || 
                                  node.nodeName === 'CODE' ||
                                  node.classList.contains('highlight') ||
                                  node.classList.contains('code-example');
                
                const isUtilityScript = node.textContent?.includes('!function') ||
                                      node.textContent?.includes('window.__CF') ||
                                      node.textContent?.includes('intercom') ||
                                      node.textContent?.includes('analytics') ||
                                      node.textContent?.includes('gtag') ||
                                      node.textContent?.includes('tracking');
                
                return isCodeBlock && !isUtilityScript;
            },
            replacement: (content: string, node: Node): string => {
                const { HTMLElement } = this.dom.window;
                if (!(node instanceof HTMLElement)) {
                    return content;
                }

                const cleanContent = content
                    .trim()
                    .replace(/\[data-.*?\}+/gs, '')
                    // Remove line numbers at the start of lines
                    .replace(/^\s*\d+(?:[:.|\s]\s*)?/gm, '')
                    // Remove any remaining standalone number lines
                    .replace(/^\d+\s*$/gm, '')
                    .replace(/```/g, '')

                return `\n\`\`\`${cleanContent ? '\n' + cleanContent : ''}\n\`\`\`\n`;
            }
        });
    }

    public async processContent(url: string, content: string): Promise<string> {
        // Create a new JSDOM instance with the content
        this.dom = new JSDOM(content);
        const title = this.dom.window.document.title || 'Untitled';
        const markdown = this.convertToMarkdown(content);
        return this.formatContent(url, markdown, title);
    }

    public convertToMarkdown(html: string): string {
        return this.turndownService.turndown(html);
    }

    private formatContent(url: string, markdown: string, title: string): string {
        return [
            // `\n\n# Source: ${url}`,
            `## Title: ${title}`,
            '',
            markdown
                .replace(/@keyframes[\s\S]*?}/g, '')
                .replace(/\.intercom[\s\S]*?}/g, '')
                .replace(/\.tracking[\s\S]*?}/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim(),
            '---\n'
        ].join('\n');
    }
}

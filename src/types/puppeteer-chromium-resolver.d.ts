declare module 'puppeteer-chromium-resolver' {
    import { Browser } from 'puppeteer-core';
    
    interface PCRStats {
        executablePath: string;
        puppeteer: {
            launch(options?: any): Promise<Browser>;
        };
        browser?: Browser;
        browserWSEndpoint?: string;
    }

    const PCR: (options?: {
        folderName?: string;
        revision?: string;
        installPath?: string;
        proxy?: string;
        host?: string;
    }) => Promise<PCRStats>;

    export default PCR;
}
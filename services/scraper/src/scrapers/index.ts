import { scrapeAmazon, ScrapeResult } from './amazon';
import { scrapeJsonLd } from './jsonld';

export type { ScrapeResult };

export async function scrapePrice(url: string, store: string): Promise<ScrapeResult> {
  if (store === 'amazon') {
    return scrapeAmazon(url);
  }
  return scrapeJsonLd(url);
}

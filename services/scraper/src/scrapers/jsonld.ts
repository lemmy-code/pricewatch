import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScrapeResult } from './amazon';

export async function scrapeJsonLd(url: string): Promise<ScrapeResult> {
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    timeout: 10000,
  });

  const $ = cheerio.load(html);

  // Try JSON-LD first
  const jsonLdScripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLdScripts.length; i++) {
    try {
      const data = JSON.parse($(jsonLdScripts[i]).html() || '');
      const result = extractFromJsonLd(data);
      if (result) return result;
    } catch {
      continue;
    }
  }

  // Fallback: OpenGraph meta tags
  const ogPrice = $('meta[property="og:price:amount"]').attr('content')
    || $('meta[property="product:price:amount"]').attr('content');
  const ogCurrency = $('meta[property="og:price:currency"]').attr('content')
    || $('meta[property="product:price:currency"]').attr('content')
    || 'EUR';

  if (ogPrice) {
    const price = parseFloat(ogPrice);
    if (!isNaN(price)) {
      return { price, currency: ogCurrency };
    }
  }

  throw new Error('Could not extract price from JSON-LD or meta tags');
}

function extractFromJsonLd(data: unknown): ScrapeResult | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = extractFromJsonLd(item);
      if (result) return result;
    }
    return null;
  }

  if (typeof data !== 'object' || data === null) return null;

  const obj = data as Record<string, unknown>;

  if (obj['@type'] === 'Product' || obj['@type'] === 'IndividualProduct') {
    const offers = obj['offers'] as Record<string, unknown> | Record<string, unknown>[] | undefined;
    if (offers) {
      return extractFromOffers(offers);
    }
  }

  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    return extractFromJsonLd(obj['@graph']);
  }

  return null;
}

function extractFromOffers(offers: unknown): ScrapeResult | null {
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const result = extractFromOffers(offer);
      if (result) return result;
    }
    return null;
  }

  if (typeof offers !== 'object' || offers === null) return null;

  const obj = offers as Record<string, unknown>;
  const price = parseFloat(String(obj['price'] || obj['lowPrice'] || ''));
  const currency = String(obj['priceCurrency'] || 'EUR');

  if (!isNaN(price) && price > 0) {
    return { price, currency };
  }

  return null;
}

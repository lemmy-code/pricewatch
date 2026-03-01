import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapeResult {
  price: number;
  currency: string;
}

export async function scrapeAmazon(url: string): Promise<ScrapeResult> {
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 10000,
  });

  const $ = cheerio.load(html);

  const selectors = [
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price-whole',
    'span.a-color-price',
  ];

  let priceText: string | null = null;

  for (const selector of selectors) {
    const el = $(selector).first();
    if (el.length) {
      priceText = el.text().trim();
      break;
    }
  }

  if (!priceText) {
    throw new Error('Could not find price on Amazon page');
  }

  const cleaned = priceText.replace(/[^0-9.,]/g, '');
  let price: number;
  if (cleaned.includes(',') && cleaned.indexOf(',') > cleaned.lastIndexOf('.')) {
    price = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  } else {
    price = parseFloat(cleaned.replace(/,/g, ''));
  }

  if (isNaN(price)) {
    throw new Error(`Could not parse price from: ${priceText}`);
  }

  const currency = priceText.includes('$') ? 'USD' :
                   priceText.includes('£') ? 'GBP' :
                   priceText.includes('€') ? 'EUR' : 'USD';

  return { price, currency };
}

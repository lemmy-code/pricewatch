import axios from 'axios';
import { scrapeJsonLd } from '../scrapers/jsonld';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('scrapeJsonLd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should extract price from JSON-LD Product schema', async () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Test Product",
              "offers": {
                "@type": "Offer",
                "price": "49.99",
                "priceCurrency": "USD"
              }
            }
          </script>
        </head>
        <body></body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeJsonLd('https://example.com/product');

    expect(result).toEqual({ price: 49.99, currency: 'USD' });
  });

  it('should extract price from JSON-LD with @graph', async () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@graph": [
                {
                  "@type": "Product",
                  "name": "Graph Product",
                  "offers": {
                    "@type": "Offer",
                    "price": "35.00",
                    "priceCurrency": "GBP"
                  }
                }
              ]
            }
          </script>
        </head>
        <body></body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeJsonLd('https://example.com/product');

    expect(result).toEqual({ price: 35.0, currency: 'GBP' });
  });

  it('should extract price from lowPrice in offers', async () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Range Product",
              "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "19.99",
                "highPrice": "39.99",
                "priceCurrency": "EUR"
              }
            }
          </script>
        </head>
        <body></body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeJsonLd('https://example.com/product');

    expect(result).toEqual({ price: 19.99, currency: 'EUR' });
  });

  it('should fallback to og:price meta tags', async () => {
    const html = `
      <html>
        <head>
          <meta property="og:price:amount" content="24.95" />
          <meta property="og:price:currency" content="USD" />
        </head>
        <body></body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeJsonLd('https://example.com/product');

    expect(result).toEqual({ price: 24.95, currency: 'USD' });
  });

  it('should fallback to product:price meta tags', async () => {
    const html = `
      <html>
        <head>
          <meta property="product:price:amount" content="15.50" />
          <meta property="product:price:currency" content="EUR" />
        </head>
        <body></body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeJsonLd('https://example.com/product');

    expect(result).toEqual({ price: 15.5, currency: 'EUR' });
  });

  it('should default currency to EUR when not specified in meta tags', async () => {
    const html = `
      <html>
        <head>
          <meta property="og:price:amount" content="10.00" />
        </head>
        <body></body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeJsonLd('https://example.com/product');

    expect(result).toEqual({ price: 10.0, currency: 'EUR' });
  });

  it('should throw an error when no price data is found', async () => {
    const html = `
      <html>
        <head><title>No Price Page</title></head>
        <body><p>No price info here</p></body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    await expect(scrapeJsonLd('https://example.com/product'))
      .rejects.toThrow('Could not extract price from JSON-LD or meta tags');
  });

  it('should handle array of JSON-LD scripts', async () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            { "@type": "BreadcrumbList" }
          </script>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Second Script",
              "offers": {
                "price": "99.00",
                "priceCurrency": "USD"
              }
            }
          </script>
        </head>
        <body></body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeJsonLd('https://example.com/product');

    expect(result).toEqual({ price: 99.0, currency: 'USD' });
  });
});

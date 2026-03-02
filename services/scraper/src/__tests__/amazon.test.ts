import axios from 'axios';
import { scrapeAmazon } from '../scrapers/amazon';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('scrapeAmazon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should extract price from .a-price .a-offscreen', async () => {
    const html = `
      <html>
        <body>
          <span class="a-price">
            <span class="a-offscreen">$29.99</span>
          </span>
        </body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeAmazon('https://www.amazon.com/dp/B08N5WRWNW');

    expect(result).toEqual({ price: 29.99, currency: 'USD' });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://www.amazon.com/dp/B08N5WRWNW',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
        timeout: 10000,
      }),
    );
  });

  it('should extract price from #priceblock_ourprice fallback', async () => {
    const html = `
      <html>
        <body>
          <span id="priceblock_ourprice">£45.00</span>
        </body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeAmazon('https://www.amazon.co.uk/dp/B08N5WRWNW');

    expect(result).toEqual({ price: 45.0, currency: 'GBP' });
  });

  it('should extract EUR currency', async () => {
    const html = `
      <html>
        <body>
          <span class="a-price">
            <span class="a-offscreen">€19,99</span>
          </span>
        </body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    const result = await scrapeAmazon('https://www.amazon.de/dp/B08N5WRWNW');

    expect(result).toEqual({ price: 19.99, currency: 'EUR' });
  });

  it('should throw an error when no price is found', async () => {
    const html = `
      <html>
        <body>
          <div>No price here</div>
        </body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    await expect(scrapeAmazon('https://www.amazon.com/dp/B08N5WRWNW'))
      .rejects.toThrow('Could not find price on Amazon page');
  });

  it('should throw when price text cannot be parsed to a number', async () => {
    const html = `
      <html>
        <body>
          <span class="a-price">
            <span class="a-offscreen">N/A</span>
          </span>
        </body>
      </html>
    `;

    mockedAxios.get.mockResolvedValue({ data: html });

    await expect(scrapeAmazon('https://www.amazon.com/dp/B08N5WRWNW'))
      .rejects.toThrow('Could not parse price from');
  });
});

import { scrapeAmazon } from '../scrapers/amazon';

const mockContent = jest.fn();
const mockClose = jest.fn();
const mockGoto = jest.fn();
const mockWaitForSelector = jest.fn().mockRejectedValue(new Error('timeout'));
const mockSetUserAgent = jest.fn();
const mockSetExtraHTTPHeaders = jest.fn();

jest.mock('puppeteer', () => ({
  __esModule: true,
  default: {
    launch: jest.fn().mockImplementation(() =>
      Promise.resolve({
        newPage: jest.fn().mockImplementation(() =>
          Promise.resolve({
            setUserAgent: mockSetUserAgent,
            setExtraHTTPHeaders: mockSetExtraHTTPHeaders,
            goto: mockGoto,
            waitForSelector: mockWaitForSelector,
            content: mockContent,
          })
        ),
        close: mockClose,
      })
    ),
  },
}));

describe('scrapeAmazon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitForSelector.mockRejectedValue(new Error('timeout'));
  });

  it('should extract price from .a-price .a-offscreen', async () => {
    mockContent.mockResolvedValue(`
      <html><body>
        <span class="a-price"><span class="a-offscreen">$29.99</span></span>
      </body></html>
    `);

    const result = await scrapeAmazon('https://www.amazon.com/dp/B08N5WRWNW');

    expect(result).toEqual({ price: 29.99, currency: 'USD' });
    expect(mockClose).toHaveBeenCalled();
  });

  it('should extract price from #priceblock_ourprice fallback', async () => {
    mockContent.mockResolvedValue(`
      <html><body>
        <span id="priceblock_ourprice">£45.00</span>
      </body></html>
    `);

    const result = await scrapeAmazon('https://www.amazon.co.uk/dp/B08N5WRWNW');

    expect(result).toEqual({ price: 45.0, currency: 'GBP' });
  });

  it('should extract EUR currency', async () => {
    mockContent.mockResolvedValue(`
      <html><body>
        <span class="a-price"><span class="a-offscreen">€19,99</span></span>
      </body></html>
    `);

    const result = await scrapeAmazon('https://www.amazon.de/dp/B08N5WRWNW');

    expect(result).toEqual({ price: 19.99, currency: 'EUR' });
  });

  it('should throw an error when no price is found', async () => {
    mockContent.mockResolvedValue(`
      <html><body><div>No price here</div></body></html>
    `);

    await expect(scrapeAmazon('https://www.amazon.com/dp/B08N5WRWNW'))
      .rejects.toThrow('Could not find price on Amazon page');
    expect(mockClose).toHaveBeenCalled();
  });

  it('should throw when price text cannot be parsed to a number', async () => {
    mockContent.mockResolvedValue(`
      <html><body>
        <span class="a-price"><span class="a-offscreen">N/A</span></span>
      </body></html>
    `);

    await expect(scrapeAmazon('https://www.amazon.com/dp/B08N5WRWNW'))
      .rejects.toThrow('Could not parse price from');
  });
});

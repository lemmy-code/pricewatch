import { startConsumer } from './consumer';
import { startDlqConsumer } from './dlq.consumer';

async function main(): Promise<void> {
  console.log('Starting scraper service...');
  await startConsumer();
  await startDlqConsumer();
}

main().catch(console.error);

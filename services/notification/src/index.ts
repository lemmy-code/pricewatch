import { startConsumer } from './consumer';

async function main(): Promise<void> {
  console.log('Starting notification service...');
  await startConsumer();
}

main().catch(console.error);

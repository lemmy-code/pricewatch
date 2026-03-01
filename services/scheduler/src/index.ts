import { startScheduler } from './scheduler';

async function main(): Promise<void> {
  console.log('Starting scheduler service...');
  await startScheduler();
}

main().catch(console.error);

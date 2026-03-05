import { startScheduler } from './scheduler';

async function main(): Promise<void> {
  console.log('Starting scheduler service...');
  await startScheduler();

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down scheduler...`);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(console.error);

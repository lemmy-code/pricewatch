import { startConsumer } from './consumer';

async function main(): Promise<void> {
  console.log('Starting notification service...');
  await startConsumer();

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down notification service...`);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(console.error);

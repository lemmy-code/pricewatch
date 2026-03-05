import { startConsumer } from './consumer';
import { startDlqConsumer } from './dlq.consumer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Starting scraper service...');
  await startConsumer();
  await startDlqConsumer();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down scraper...`);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(console.error);

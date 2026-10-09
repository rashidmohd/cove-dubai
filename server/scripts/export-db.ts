/**
 * Export every table to one JSON file, before anything that deletes data.
 *
 *   npm run db:export                 → ../../db-backups/<timestamp>.json
 *   npm run db:export -- <file.json>  → that file
 *
 * Reads every model Prisma knows about, so a table added later is exported
 * without editing this script. Decimals and dates are written as strings.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = resolve(process.argv[2] ?? `../../db-backups/cove-${stamp}.json`);

const dump: Record<string, unknown[]> = {};
for (const model of Prisma.dmmf.datamodel.models) {
  const delegate = (prisma as unknown as Record<string, { findMany(): Promise<unknown[]> }>)[
    model.name.charAt(0).toLowerCase() + model.name.slice(1)
  ];
  dump[model.name] = await delegate!.findMany();
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(dump, null, 2));
console.log(`Exported to ${target}`);
console.log(Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])));
await prisma.$disconnect();

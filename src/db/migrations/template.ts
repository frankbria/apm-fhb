/**
 * Migration Template Generator
 *
 * Generates new migration files from template
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { generateMigrationFilename } from './framework.js';

/**
 * Migration file template
 */
const MIGRATION_TEMPLATE = `/**
 * Migration: {{NAME}}
 * Created: {{TIMESTAMP}}
 *
 * Description:
 * {{DESCRIPTION}}
 */

import type Database from 'better-sqlite3';

/**
 * Apply migration (forward)
 */
export async function up(db: Database.Database): Promise<void> {
  // Add your schema changes here
  // Example:
  // db.exec(\`
  //   CREATE TABLE example (
  //     id INTEGER PRIMARY KEY AUTOINCREMENT,
  //     name TEXT NOT NULL,
  //     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  //   );
  // \`);
}

/**
 * Rollback migration (backward)
 */
export async function down(db: Database.Database): Promise<void> {
  // Add rollback logic here
  // Example:
  // db.exec('DROP TABLE IF EXISTS example;');
}

/**
 * Migration description
 */
export const description = '{{DESCRIPTION}}';
`;

/**
 * Generate migration file from template
 *
 * Creates a new TypeScript migration file in the specified directory
 * following the naming convention: YYYYMMDDHHMMSS_description.ts
 */
export async function generateMigrationFile(
  name: string,
  migrationsDir: string = './migrations'
): Promise<string> {
  const dir = resolve(migrationsDir);

  // Ensure migrations directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Generate filename
  const filename = generateMigrationFilename(name);
  const filepath = join(dir, filename);

  // Check if file already exists
  if (existsSync(filepath)) {
    throw new Error(`Migration file already exists: ${filepath}`);
  }

  // Format description
  const description = name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  // Generate file content from template
  const timestamp = new Date().toISOString();
  const content = MIGRATION_TEMPLATE
    .replace(/{{NAME}}/g, filename.replace('.ts', ''))
    .replace(/{{TIMESTAMP}}/g, timestamp)
    .replace(/{{DESCRIPTION}}/g, description);

  // Write file
  try {
    writeFileSync(filepath, content, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to write migration file: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return filepath;
}

/**
 * Get migration template for custom use
 */
export function getMigrationTemplate(): string {
  return MIGRATION_TEMPLATE;
}

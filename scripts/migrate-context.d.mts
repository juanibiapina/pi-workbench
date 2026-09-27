export declare function migrateContexts(root: string, statusDir: string, apply?: boolean): Promise<{
  validated: number;
  migrated: number;
  active: string[];
  changed: string[];
}>;

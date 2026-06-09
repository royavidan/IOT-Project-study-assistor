// Placeholder database types. These will be REGENERATED once the schema
// migration (Step 1.2) has been applied, with:
//
//   npx supabase gen types typescript --project-id <project-ref> \
//     > src/lib/supabase/types.ts
//
// (or `--linked` after `supabase link`). Until then this keeps the Supabase
// clients generically typed without breaking the build.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type PlaceholderTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: {
    foreignKeyName: string;
    columns: string[];
    isOneToOne?: boolean;
    referencedRelation: string;
    referencedColumns: string[];
  }[];
};

type PlaceholderView = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: PlaceholderTable["Relationships"];
};

type PlaceholderFunction = {
  Args: Record<string, unknown> | never;
  Returns: unknown;
  SetofOptions?: {
    isSetofReturn?: boolean;
    isOneToOne?: boolean;
    isNotNullable?: boolean;
    to: string;
    from: string;
  };
};

export interface Database {
  public: {
    // Keep this permissive until generated types replace it.
    Tables: Record<string, PlaceholderTable>;
    Views: Record<string, PlaceholderView>;
    Functions: Record<string, PlaceholderFunction>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
}

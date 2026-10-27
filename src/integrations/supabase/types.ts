export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      companies: {
        Row: {
          active: boolean
          aliases: string[]
          case_sensitive_aliases: string[]
          country: string | null
          created_at: string
          cvr: string | null
          exclude_terms: string[]
          google_news_enabled: boolean
          id: string
          is_danish: boolean
          name: string
          notes: string | null
          sector: string
          ticker: string | null
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          case_sensitive_aliases?: string[]
          country?: string | null
          created_at?: string
          cvr?: string | null
          exclude_terms?: string[]
          google_news_enabled?: boolean
          id?: string
          is_danish?: boolean
          name: string
          notes?: string | null
          sector?: string
          ticker?: string | null
        }
        Update: {
          active?: boolean
          aliases?: string[]
          case_sensitive_aliases?: string[]
          country?: string | null
          created_at?: string
          cvr?: string | null
          exclude_terms?: string[]
          google_news_enabled?: boolean
          id?: string
          is_danish?: boolean
          name?: string
          notes?: string | null
          sector?: string
          ticker?: string | null
        }
        Relationships: []
      }
      editor_columns: {
        Row: {
          company_id: string | null
          created_at: string
          hide_opinion: boolean
          id: string
          min_score: number
          position: number
          sort: string
          topic_id: string | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          hide_opinion?: boolean
          id?: string
          min_score?: number
          position?: number
          sort?: string
          topic_id?: string | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          hide_opinion?: boolean
          id?: string
          min_score?: number
          position?: number
          sort?: string
          topic_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "editor_columns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editor_columns_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      feeds: {
        Row: {
          active: boolean
          company_id: string | null
          consecutive_failures: number
          created_at: string
          etag: string | null
          id: string
          kind: string
          last_error: string | null
          last_modified: string | null
          last_polled_at: string | null
          last_success_at: string | null
          name: string
          publisher: string
          source_weight: number
          url: string
        }
        Insert: {
          active?: boolean
          company_id?: string | null
          consecutive_failures?: number
          created_at?: string
          etag?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          last_modified?: string | null
          last_polled_at?: string | null
          last_success_at?: string | null
          name: string
          publisher: string
          source_weight?: number
          url: string
        }
        Update: {
          active?: boolean
          company_id?: string | null
          consecutive_failures?: number
          created_at?: string
          etag?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          last_modified?: string | null
          last_polled_at?: string | null
          last_success_at?: string | null
          name?: string
          publisher?: string
          source_weight?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "feeds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_runs: {
        Row: {
          feeds_failed: number
          feeds_ok: number
          finished_at: string | null
          id: string
          items_new: number
          log: Json
          started_at: string
        }
        Insert: {
          feeds_failed?: number
          feeds_ok?: number
          finished_at?: string | null
          id?: string
          items_new?: number
          log?: Json
          started_at?: string
        }
        Update: {
          feeds_failed?: number
          feeds_ok?: number
          finished_at?: string | null
          id?: string
          items_new?: number
          log?: Json
          started_at?: string
        }
        Relationships: []
      }
      item_actions: {
        Row: {
          article_ref: string | null
          id: string
          item_id: string
          note: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          article_ref?: string | null
          id?: string
          item_id: string
          note?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          article_ref?: string | null
          id?: string
          item_id?: string
          note?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_actions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_matches: {
        Row: {
          company_id: string | null
          id: string
          item_id: string
          matched_terms: string[]
          relevance_score: number
          topic_id: string | null
        }
        Insert: {
          company_id?: string | null
          id?: string
          item_id: string
          matched_terms?: string[]
          relevance_score?: number
          topic_id?: string | null
        }
        Update: {
          company_id?: string | null
          id?: string
          item_id?: string
          matched_terms?: string[]
          relevance_score?: number
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_matches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_matches_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_matches_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      item_sources: {
        Row: {
          feed_id: string
          item_id: string
          seen_at: string
        }
        Insert: {
          feed_id: string
          item_id: string
          seen_at?: string
        }
        Update: {
          feed_id?: string
          item_id?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_sources_feed_id_fkey"
            columns: ["feed_id"]
            isOneToOne: false
            referencedRelation: "feeds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_sources_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          canonical_url: string
          feed_id: string | null
          headline: string
          headline_norm: string | null
          id: string
          ingested_at: string
          is_opinion: boolean
          is_seed: boolean
          published_at: string
          published_at_estimated: boolean
          publisher: string
          summary: string | null
        }
        Insert: {
          canonical_url: string
          feed_id?: string | null
          headline: string
          headline_norm?: string | null
          id?: string
          ingested_at?: string
          is_opinion?: boolean
          is_seed?: boolean
          published_at: string
          published_at_estimated?: boolean
          publisher: string
          summary?: string | null
        }
        Update: {
          canonical_url?: string
          feed_id?: string | null
          headline?: string
          headline_norm?: string | null
          id?: string
          ingested_at?: string
          is_opinion?: boolean
          is_seed?: boolean
          published_at?: string
          published_at_estimated?: boolean
          publisher?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_feed_id_fkey"
            columns: ["feed_id"]
            isOneToOne: false
            referencedRelation: "feeds"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      topics: {
        Row: {
          active: boolean
          created_at: string
          id: string
          keywords: string[]
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          keywords?: string[]
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          keywords?: string[]
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

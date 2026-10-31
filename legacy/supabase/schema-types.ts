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
      doctor_profile_jobs: {
        Row: {
          id: string; version: number; doctor: string; input: Json;
          status: "queued" | "processing" | "succeeded" | "failed" | "superseded";
          attempts: number; lease_token: string | null; started_at: string | null;
          created_at: string; completed_at: string | null; confirmed_at: string | null;
          reviewed_focus: Json | null; output: Json | null; error_code: string | null; model: string | null;
          prompt_version: string | null; schema_version: string | null;
        };
        Insert: { doctor: string; input: Json };
        Update: never;
        Relationships: [];
      }
      articles: {
        Row: {
          applicability_percent: number | null
          cancer_type: string
          covers_text: string
          full_summary: string
          id: string
          newsletter: string
          not_covers_text: string
          position: number
          short_summary: string
          title: string
        }
        Insert: {
          applicability_percent?: number | null
          cancer_type: string
          covers_text?: string
          full_summary?: string
          id?: string
          newsletter: string
          not_covers_text?: string
          position?: number
          short_summary?: string
          title: string
        }
        Update: {
          applicability_percent?: number | null
          cancer_type?: string
          covers_text?: string
          full_summary?: string
          id?: string
          newsletter?: string
          not_covers_text?: string
          position?: number
          short_summary?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_newsletter_fkey"
            columns: ["newsletter"]
            isOneToOne: false
            referencedRelation: "newsletters"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json
          doctor: string
          id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          doctor: string
          id?: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          doctor?: string
          id?: string
        }
        Relationships: []
      }
      bookmarks: {
        Row: {
          article: string
          created_at: string
          doctor: string
        }
        Insert: {
          article: string
          created_at?: string
          doctor: string
        }
        Update: {
          article?: string
          created_at?: string
          doctor?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_article_fkey"
            columns: ["article"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookmarks_doctor_fkey"
            columns: ["doctor"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      citations: {
        Row: {
          article: string
          id: string
          number: number
          published_date: string | null
          source_name: string
          title: string
          url: string
        }
        Insert: {
          article: string
          id?: string
          number: number
          published_date?: string | null
          source_name: string
          title: string
          url: string
        }
        Update: {
          article?: string
          id?: string
          number?: number
          published_date?: string | null
          source_name?: string
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "citations_article_fkey"
            columns: ["article"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          cancer_types: string[]
          consent_given_at: string | null
          created_at: string
          doctor_id_code: string | null
          frequency: string | null
          full_name: string | null
          id: string
          onboarding_complete: boolean
          patient_data_linked: boolean
          practice_setting: string | null
          preferred_format: string | null
          specialty: string | null
          topics: string[]
          updated_at: string
          years_in_practice: number | null
        }
        Insert: {
          cancer_types?: string[]
          consent_given_at?: string | null
          created_at?: string
          doctor_id_code?: string | null
          frequency?: string | null
          full_name?: string | null
          id: string
          onboarding_complete?: boolean
          patient_data_linked?: boolean
          practice_setting?: string | null
          preferred_format?: string | null
          specialty?: string | null
          topics?: string[]
          updated_at?: string
          years_in_practice?: number | null
        }
        Update: {
          cancer_types?: string[]
          consent_given_at?: string | null
          created_at?: string
          doctor_id_code?: string | null
          frequency?: string | null
          full_name?: string | null
          id?: string
          onboarding_complete?: boolean
          patient_data_linked?: boolean
          practice_setting?: string | null
          preferred_format?: string | null
          specialty?: string | null
          topics?: string[]
          updated_at?: string
          years_in_practice?: number | null
        }
        Relationships: []
      }
      newsletters: {
        Row: {
          doctor: string
          id: string
          sent_at: string
          summary: string
          title: string
        }
        Insert: {
          doctor: string
          id?: string
          sent_at?: string
          summary?: string
          title: string
        }
        Update: {
          doctor?: string
          id?: string
          sent_at?: string
          summary?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "newsletters_doctor_fkey"
            columns: ["doctor"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_mix: {
        Row: {
          aggregates: Json
          doctor_id_code: string
          synced_at: string
        }
        Insert: {
          aggregates?: Json
          doctor_id_code: string
          synced_at?: string
        }
        Update: {
          aggregates?: Json
          doctor_id_code?: string
          synced_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hospital_directory: { Args: Record<never, never>; Returns: Json };
      hospital_sync_patient_context: { Args: { _payload: Json; _source_kind: string; _request_id: string; _expected_id: string | null }; Returns: Json };
      read_patient_context: { Args: Record<never, never>; Returns: Json | null };
      read_patient_sync_history: { Args: Record<never, never>; Returns: Json };
      sync_patient_context: { Args: { _payload: Json; _consent: boolean; _source_kind: string; _request_id: string; _expected_id: string | null }; Returns: Json };
      publish_matching_kb_release: { Args: { _payload: Json }; Returns: string };
      enqueue_due_matching_jobs: { Args: Record<never, never>; Returns: number };
      claim_matching_job: { Args: Record<never, never>; Returns: Json | null };
      current_matching_input: { Args: { _doctor: string }; Returns: Json | null };
      read_current_matching_result: { Args: { _id: string }; Returns: Json | null };
      finish_matching_job: {
        Args: { _id: string; _lease: string; _result: Json | null; _error: string | null; _matcher_version: string };
        Returns: string;
      };
      claim_doctor_profile_job: {
        Args: Record<never, never>;
        Returns: Database["public"]["Tables"]["doctor_profile_jobs"]["Row"][];
      };
      finish_doctor_profile_job: {
        Args: { _id: string; _lease: string; _output: Json | null; _error: string | null;
          _model: string; _prompt_version: string; _schema_version: string };
        Returns: string;
      };
      confirm_doctor_profile: { Args: { _id: string; _focus: Json }; Returns: undefined };
      retry_doctor_profile: { Args: Record<never, never>; Returns: undefined };
      link_patient_data: {
        Args: { _code: string; _consent: boolean }
        Returns: Json
      }
      seed_sample_newsletter: {
        Args: { _code: string; _doctor: string }
        Returns: undefined
      }
      unlink_patient_data: { Args: never; Returns: undefined }
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

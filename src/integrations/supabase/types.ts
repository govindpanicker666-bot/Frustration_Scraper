export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      ai_visibility_scans: {
        Row: {
          brand_name: string;
          citations: Json;
          created_at: string;
          id: string;
          model_name: string;
          prompt_text: string;
          rank_position: number | null;
          sentiment: string;
          user_id: string;
          visibility_score: number;
        };
        Insert: {
          brand_name: string;
          citations?: Json;
          created_at?: string;
          id?: string;
          model_name: string;
          prompt_text: string;
          rank_position?: number | null;
          sentiment?: string;
          user_id: string;
          visibility_score?: number;
        };
        Update: {
          brand_name?: string;
          citations?: Json;
          created_at?: string;
          id?: string;
          model_name?: string;
          prompt_text?: string;
          rank_position?: number | null;
          sentiment?: string;
          user_id?: string;
          visibility_score?: number;
        };
        Relationships: [];
      };
      ai_brand_insights: {
        Row: {
          generated_at: string;
          negative_hypotheses: Json;
          positive_hypotheses: Json;
          user_id: string;
        };
        Insert: {
          generated_at?: string;
          negative_hypotheses: Json;
          positive_hypotheses: Json;
          user_id: string;
        };
        Update: {
          generated_at?: string;
          negative_hypotheses?: Json;
          positive_hypotheses?: Json;
          user_id?: string;
        };
        Relationships: [];
      };
      blog_authors: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          id: string;
          linkedin_url: string | null;
          name: string;
          role: string | null;
          website_url: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          id?: string;
          linkedin_url?: string | null;
          name: string;
          role?: string | null;
          website_url?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          id?: string;
          linkedin_url?: string | null;
          name?: string;
          role?: string | null;
          website_url?: string | null;
        };
        Relationships: [];
      };
      brand_mentions: {
        Row: {
          created_at: string;
          extracted_complaint: string | null;
          id: string;
          platform: string;
          post_url: string;
          review_text: string;
          reviewer_name: string | null;
          sentiment_score: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          extracted_complaint?: string | null;
          id?: string;
          platform: string;
          post_url: string;
          review_text: string;
          reviewer_name?: string | null;
          sentiment_score: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          extracted_complaint?: string | null;
          id?: string;
          platform?: string;
          post_url?: string;
          review_text?: string;
          reviewer_name?: string | null;
          sentiment_score?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      blog_posts: {
        Row: {
          author_id: string | null;
          author_name: string;
          category: string | null;
          content: string;
          content_format: string;
          created_at: string;
          created_by: string | null;
          excerpt: string | null;
          featured_image: string | null;
          featured_image_alt: string | null;
          id: string;
          meta_description: string | null;
          meta_title: string | null;
          published_at: string | null;
          read_minutes: number | null;
          slug: string;
          status: string;
          tags: string[];
          title: string;
          updated_at: string;
        };
        Insert: {
          author_id?: string | null;
          author_name?: string;
          category?: string | null;
          content?: string;
          content_format?: string;
          created_at?: string;
          created_by?: string | null;
          excerpt?: string | null;
          featured_image?: string | null;
          featured_image_alt?: string | null;
          id?: string;
          meta_description?: string | null;
          meta_title?: string | null;
          published_at?: string | null;
          read_minutes?: number | null;
          slug: string;
          status?: string;
          tags?: string[];
          title: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string | null;
          author_name?: string;
          category?: string | null;
          content?: string;
          content_format?: string;
          created_at?: string;
          created_by?: string | null;
          excerpt?: string | null;
          featured_image?: string | null;
          featured_image_alt?: string | null;
          id?: string;
          meta_description?: string | null;
          meta_title?: string | null;
          published_at?: string | null;
          read_minutes?: number | null;
          slug?: string;
          status?: string;
          tags?: string[];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blog_posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "blog_authors";
            referencedColumns: ["id"];
          },
        ];
      };
      competitor_news: {
        Row: {
          competitor_id: string | null;
          competitor_name: string;
          created_at: string;
          id: string;
          news_type: string;
          published_date: string | null;
          summary: string | null;
          tactical_advice: string | null;
          title: string;
          url: string;
          user_id: string;
          why_it_matters: string | null;
        };
        Insert: {
          competitor_id?: string | null;
          competitor_name: string;
          created_at?: string;
          id?: string;
          news_type?: string;
          published_date?: string | null;
          summary?: string | null;
          tactical_advice?: string | null;
          title: string;
          url: string;
          user_id: string;
          why_it_matters?: string | null;
        };
        Update: {
          competitor_id?: string | null;
          competitor_name?: string;
          created_at?: string;
          id?: string;
          news_type?: string;
          published_date?: string | null;
          summary?: string | null;
          tactical_advice?: string | null;
          title?: string;
          url?: string;
          user_id?: string;
          why_it_matters?: string | null;
        };
        Relationships: [];
      };
      competitors: {
        Row: {
          category: string | null;
          created_at: string;
          description: string | null;
          domain: string | null;
          id: string;
          keywords: string[];
          name: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          description?: string | null;
          domain?: string | null;
          id?: string;
          keywords?: string[];
          name: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          description?: string | null;
          domain?: string | null;
          id?: string;
          keywords?: string[];
          name?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      custom_pages: {
        Row: {
          created_at: string;
          id: string;
          seo_description: string | null;
          slug: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          seo_description?: string | null;
          slug: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          seo_description?: string | null;
          slug?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      insight_cache: {
        Row: {
          generated_at: string;
          lead_count: number;
          recommendations: Json;
          user_id: string;
        };
        Insert: {
          generated_at?: string;
          lead_count?: number;
          recommendations?: Json;
          user_id: string;
        };
        Update: {
          generated_at?: string;
          lead_count?: number;
          recommendations?: Json;
          user_id?: string;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          company: string | null;
          company_domain: string | null;
          competitor_id: string | null;
          competitor_name: string;
          date_scraped: string;
          email: string | null;
          email_status: string | null;
          extracted_complaint: string | null;
          id: string;
          job_title: string | null;
          lead_type: string;
          linkedin_url: string | null;
          pitch_message: string | null;
          review_text: string;
          reviewer_name: string | null;
          reviewer_profile_url: string | null;
          sentiment_score: number;
          source_platform: string;
          source_url: string;
          status: Database["public"]["Enums"]["lead_status"];
          suggested_pitch: string | null;
          user_id: string;
        };
        Insert: {
          company?: string | null;
          company_domain?: string | null;
          competitor_id?: string | null;
          competitor_name: string;
          date_scraped?: string;
          email?: string | null;
          email_status?: string | null;
          extracted_complaint?: string | null;
          id?: string;
          job_title?: string | null;
          lead_type?: string;
          linkedin_url?: string | null;
          pitch_message?: string | null;
          review_text: string;
          reviewer_name?: string | null;
          reviewer_profile_url?: string | null;
          sentiment_score: number;
          source_platform: string;
          source_url: string;
          status?: Database["public"]["Enums"]["lead_status"];
          suggested_pitch?: string | null;
          user_id: string;
        };
        Update: {
          company?: string | null;
          company_domain?: string | null;
          competitor_id?: string | null;
          competitor_name?: string;
          date_scraped?: string;
          email?: string | null;
          email_status?: string | null;
          extracted_complaint?: string | null;
          id?: string;
          job_title?: string | null;
          lead_type?: string;
          linkedin_url?: string | null;
          pitch_message?: string | null;
          review_text?: string;
          reviewer_name?: string | null;
          reviewer_profile_url?: string | null;
          sentiment_score?: number;
          source_platform?: string;
          source_url?: string;
          status?: Database["public"]["Enums"]["lead_status"];
          suggested_pitch?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_competitor_id_fkey";
            columns: ["competitor_id"];
            isOneToOne: false;
            referencedRelation: "competitors";
            referencedColumns: ["id"];
          },
        ];
      };
      page_blocks: {
        Row: {
          block_type: string;
          content: Json;
          id: string;
          order_index: number;
          page_id: string;
        };
        Insert: {
          block_type: string;
          content?: Json;
          id?: string;
          order_index?: number;
          page_id: string;
        };
        Update: {
          block_type?: string;
          content?: Json;
          id?: string;
          order_index?: number;
          page_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_blocks_page_id_fkey";
            columns: ["page_id"];
            isOneToOne: false;
            referencedRelation: "custom_pages";
            referencedColumns: ["id"];
          },
        ];
      };
      page_submissions: {
        Row: {
          company: string | null;
          created_at: string;
          email: string;
          id: string;
          message: string | null;
          name: string | null;
          page_id: string | null;
        };
        Insert: {
          company?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          message?: string | null;
          name?: string | null;
          page_id?: string | null;
        };
        Update: {
          company?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          message?: string | null;
          name?: string | null;
          page_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "page_submissions_page_id_fkey";
            columns: ["page_id"];
            isOneToOne: false;
            referencedRelation: "custom_pages";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          company_name: string | null;
          company_url: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          has_completed_brand_baseline: boolean;
          has_seen_tutorial: boolean;
          id: string;
        };
        Insert: {
          company_name?: string | null;
          company_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          has_completed_brand_baseline?: boolean;
          has_seen_tutorial?: boolean;
          id: string;
        };
        Update: {
          company_name?: string | null;
          company_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          has_completed_brand_baseline?: boolean;
          has_seen_tutorial?: boolean;
          id?: string;
        };
        Relationships: [];
      };
      scrape_settings: {
        Row: {
          enabled: boolean;
          id: number;
          last_result: Json | null;
          last_run_at: string | null;
          lock_until: string | null;
          pause_reason: string | null;
          run_hour: number;
          updated_at: string;
        };
        Insert: {
          enabled?: boolean;
          id?: number;
          last_result?: Json | null;
          last_run_at?: string | null;
          lock_until?: string | null;
          pause_reason?: string | null;
          run_hour?: number;
          updated_at?: string;
        };
        Update: {
          enabled?: boolean;
          id?: number;
          last_result?: Json | null;
          last_run_at?: string | null;
          lock_until?: string | null;
          pause_reason?: string | null;
          run_hour?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      user_scrape_settings: {
        Row: {
          enabled: boolean;
          last_run_at: string | null;
          lock_until: string | null;
          pause_reason: string | null;
          progress: Json | null;
          run_hour: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          enabled?: boolean;
          last_run_at?: string | null;
          lock_until?: string | null;
          pause_reason?: string | null;
          progress?: Json | null;
          run_hour?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          enabled?: boolean;
          last_run_at?: string | null;
          lock_until?: string | null;
          pause_reason?: string | null;
          progress?: Json | null;
          run_hour?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "user";
      lead_status: "New" | "Contacted" | "Archived";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      lead_status: ["New", "Contacted", "Archived"],
    },
  },
} as const;

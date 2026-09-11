export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_generations: {
        Row: {
          applied_at: string | null
          cache_creation_input_tokens: number | null
          cache_read_input_tokens: number | null
          channel_listing_id: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          estimated_cost: number | null
          factsheet_hash: string | null
          field: string | null
          generation_type: Database["public"]["Enums"]["ai_generation_type"]
          id: string
          input_hash: string | null
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          product_id: string
          prompt_version: string | null
          provider: string | null
          requested_by: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["ai_generation_status"]
          structured_output: Json | null
          updated_at: string
          violations: Json | null
          workspace_id: string
        }
        Insert: {
          applied_at?: string | null
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          channel_listing_id: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          estimated_cost?: number | null
          factsheet_hash?: string | null
          field?: string | null
          generation_type?: Database["public"]["Enums"]["ai_generation_type"]
          id?: string
          input_hash?: string | null
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          product_id: string
          prompt_version?: string | null
          provider?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ai_generation_status"]
          structured_output?: Json | null
          updated_at?: string
          violations?: Json | null
          workspace_id: string
        }
        Update: {
          applied_at?: string | null
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          channel_listing_id?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          estimated_cost?: number | null
          factsheet_hash?: string | null
          field?: string | null
          generation_type?: Database["public"]["Enums"]["ai_generation_type"]
          id?: string
          input_hash?: string | null
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          product_id?: string
          prompt_version?: string | null
          provider?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ai_generation_status"]
          structured_output?: Json | null
          updated_at?: string
          violations?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_listing_fk"
            columns: ["channel_listing_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channel_listings"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "ai_generations_product_fk"
            columns: ["product_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "ai_generations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          applied_at: string | null
          attempt_count: number
          billable: boolean
          channel_connection_id: string
          channel_id: string
          created_at: string
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["billing_event_kind"]
          normalized_error_code: string | null
          normalized_error_message: string | null
          provider_response: Json | null
          status: Database["public"]["Enums"]["billing_event_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          applied_at?: string | null
          attempt_count?: number
          billable: boolean
          channel_connection_id: string
          channel_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["billing_event_kind"]
          normalized_error_code?: string | null
          normalized_error_message?: string | null
          provider_response?: Json | null
          status?: Database["public"]["Enums"]["billing_event_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          applied_at?: string | null
          attempt_count?: number
          billable?: boolean
          channel_connection_id?: string
          channel_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["billing_event_kind"]
          normalized_error_code?: string | null
          normalized_error_message?: string | null
          provider_response?: Json | null
          status?: Database["public"]["Enums"]["billing_event_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_events: {
        Row: {
          error: string | null
          id: string
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          error?: string | null
          id: string
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          error?: string | null
          id?: string
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      channel_connection_secrets: {
        Row: {
          channel_connection_id: string
          created_at: string
          encrypted_credentials: string
          key_version: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channel_connection_id: string
          created_at?: string
          encrypted_credentials: string
          key_version?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channel_connection_id?: string
          created_at?: string
          encrypted_credentials?: string
          key_version?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_connection_secrets_channel_connection_id_fkey"
            columns: ["channel_connection_id"]
            isOneToOne: true
            referencedRelation: "channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_connection_secrets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_connections: {
        Row: {
          channel_id: string
          connected_at: string
          created_at: string
          expires_at: string | null
          external_account_id: string | null
          external_account_name: string | null
          id: string
          last_verified_at: string | null
          metadata: Json
          scopes: string[]
          status: Database["public"]["Enums"]["connection_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          connected_at?: string
          created_at?: string
          expires_at?: string | null
          external_account_id?: string | null
          external_account_name?: string | null
          id?: string
          last_verified_at?: string | null
          metadata?: Json
          scopes?: string[]
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          connected_at?: string
          created_at?: string
          expires_at?: string | null
          external_account_id?: string | null
          external_account_name?: string | null
          id?: string
          last_verified_at?: string | null
          metadata?: Json
          scopes?: string[]
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_connections_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_listings: {
        Row: {
          approved_at: string | null
          category: string | null
          channel_connection_id: string
          channel_id: string
          created_at: string
          currency: string
          description: string | null
          external_listing_id: string | null
          external_url: string | null
          generated_at: string | null
          id: string
          last_notice_code: string | null
          last_notice_message: string | null
          last_sent_fingerprint: string | null
          last_synced_at: string | null
          metadata: Json
          price: number | null
          product_id: string
          publish_generation: number
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          short_description: string | null
          status: Database["public"]["Enums"]["listing_status"]
          status_source: Database["public"]["Enums"]["listing_status_source"]
          tags: string[]
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          category?: string | null
          channel_connection_id: string
          channel_id: string
          created_at?: string
          currency?: string
          description?: string | null
          external_listing_id?: string | null
          external_url?: string | null
          generated_at?: string | null
          id?: string
          last_notice_code?: string | null
          last_notice_message?: string | null
          last_sent_fingerprint?: string | null
          last_synced_at?: string | null
          metadata?: Json
          price?: number | null
          product_id: string
          publish_generation?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          status_source?: Database["public"]["Enums"]["listing_status_source"]
          tags?: string[]
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          approved_at?: string | null
          category?: string | null
          channel_connection_id?: string
          channel_id?: string
          created_at?: string
          currency?: string
          description?: string | null
          external_listing_id?: string | null
          external_url?: string | null
          generated_at?: string | null
          id?: string
          last_notice_code?: string | null
          last_notice_message?: string | null
          last_sent_fingerprint?: string | null
          last_synced_at?: string | null
          metadata?: Json
          price?: number | null
          product_id?: string
          publish_generation?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          status_source?: Database["public"]["Enums"]["listing_status_source"]
          tags?: string[]
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_listings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_listings_connection_fk"
            columns: ["channel_connection_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "channel_listings_product_fk"
            columns: ["product_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "channel_listings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_oauth_states: {
        Row: {
          channel_id: string
          code_verifier: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          external_account_hint: string | null
          state: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          code_verifier?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          external_account_hint?: string | null
          state: string
          user_id: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          code_verifier?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          external_account_hint?: string | null
          state?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_oauth_states_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_oauth_states_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          billable: boolean
          created_at: string
          id: string
          integration_type: Database["public"]["Enums"]["channel_integration_type"]
          key: string
          name: string
          status: Database["public"]["Enums"]["channel_status"]
        }
        Insert: {
          billable?: boolean
          created_at?: string
          id?: string
          integration_type: Database["public"]["Enums"]["channel_integration_type"]
          key: string
          name: string
          status?: Database["public"]["Enums"]["channel_status"]
        }
        Update: {
          billable?: boolean
          created_at?: string
          id?: string
          integration_type?: Database["public"]["Enums"]["channel_integration_type"]
          key?: string
          name?: string
          status?: Database["public"]["Enums"]["channel_status"]
        }
        Relationships: []
      }
      listing_manual_steps: {
        Row: {
          channel_listing_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          step_key: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channel_listing_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          step_key: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channel_listing_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          step_key?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_manual_steps_listing_fk"
            columns: ["channel_listing_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channel_listings"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "listing_manual_steps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_snapshots: {
        Row: {
          channel_id: string
          channel_listing_id: string
          created_at: string
          id: string
          payload: Json
          product_id: string
          snapshot_type: Database["public"]["Enums"]["snapshot_type"]
          workspace_id: string
        }
        Insert: {
          channel_id: string
          channel_listing_id: string
          created_at?: string
          id?: string
          payload: Json
          product_id: string
          snapshot_type: Database["public"]["Enums"]["snapshot_type"]
          workspace_id: string
        }
        Update: {
          channel_id?: string
          channel_listing_id?: string
          created_at?: string
          id?: string
          payload?: Json
          product_id?: string
          snapshot_type?: Database["public"]["Enums"]["snapshot_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_snapshots_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_snapshots_listing_fk"
            columns: ["channel_listing_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channel_listings"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "listing_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_assets: {
        Row: {
          asset_state: Database["public"]["Enums"]["asset_state"]
          asset_type: Database["public"]["Enums"]["asset_type"]
          byte_size: number | null
          checksum: string | null
          created_at: string
          derived_from: string | null
          failure_reason: string | null
          filename: string
          id: string
          metadata: Json
          mime_type: string | null
          product_id: string
          sort_order: number
          spec_hash: string | null
          storage_path: string
          workspace_id: string
        }
        Insert: {
          asset_state?: Database["public"]["Enums"]["asset_state"]
          asset_type: Database["public"]["Enums"]["asset_type"]
          byte_size?: number | null
          checksum?: string | null
          created_at?: string
          derived_from?: string | null
          failure_reason?: string | null
          filename: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          product_id: string
          sort_order?: number
          spec_hash?: string | null
          storage_path: string
          workspace_id: string
        }
        Update: {
          asset_state?: Database["public"]["Enums"]["asset_state"]
          asset_type?: Database["public"]["Enums"]["asset_type"]
          byte_size?: number | null
          checksum?: string | null
          created_at?: string
          derived_from?: string | null
          failure_reason?: string | null
          filename?: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          product_id?: string
          sort_order?: number
          spec_hash?: string | null
          storage_path?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_assets_derived_from_fk"
            columns: ["derived_from", "workspace_id"]
            isOneToOne: false
            referencedRelation: "product_assets"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "product_assets_product_fk"
            columns: ["product_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "product_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          base_price: number | null
          brand_name: string | null
          canonical_description: string | null
          canonical_title: string | null
          created_at: string
          currency: string
          documentation_url: string | null
          id: string
          license_summary: string | null
          metadata: Json
          name: string
          product_type: Database["public"]["Enums"]["product_type"]
          short_description: string | null
          slug: string
          status: Database["public"]["Enums"]["product_status"]
          support_url: string | null
          updated_at: string
          version: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          base_price?: number | null
          brand_name?: string | null
          canonical_description?: string | null
          canonical_title?: string | null
          created_at?: string
          currency?: string
          documentation_url?: string | null
          id?: string
          license_summary?: string | null
          metadata?: Json
          name: string
          product_type: Database["public"]["Enums"]["product_type"]
          short_description?: string | null
          slug: string
          status?: Database["public"]["Enums"]["product_status"]
          support_url?: string | null
          updated_at?: string
          version?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          base_price?: number | null
          brand_name?: string | null
          canonical_description?: string | null
          canonical_title?: string | null
          created_at?: string
          currency?: string
          documentation_url?: string | null
          id?: string
          license_summary?: string | null
          metadata?: Json
          name?: string
          product_type?: Database["public"]["Enums"]["product_type"]
          short_description?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["product_status"]
          support_url?: string | null
          updated_at?: string
          version?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      publication_jobs: {
        Row: {
          attempt_count: number
          channel_listing_id: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["publication_job_kind"]
          normalized_error_code: string | null
          normalized_error_message: string | null
          provider_response: Json | null
          publish_generation: number
          run_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["publication_job_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attempt_count?: number
          channel_listing_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["publication_job_kind"]
          normalized_error_code?: string | null
          normalized_error_message?: string | null
          provider_response?: Json | null
          publish_generation?: number
          run_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["publication_job_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attempt_count?: number
          channel_listing_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["publication_job_kind"]
          normalized_error_code?: string | null
          normalized_error_message?: string | null
          provider_response?: Json | null
          publish_generation?: number
          run_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["publication_job_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publication_jobs_listing_fk"
            columns: ["channel_listing_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channel_listings"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "publication_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_billing: {
        Row: {
          base_item_id: string | null
          billing_interval: string | null
          cancel_at_period_end: boolean
          channel_item_id: string | null
          channel_quantity: number
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          external_customer_id: string | null
          external_subscription_id: string | null
          period_peak_quantity: number
          subscription_status:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          base_item_id?: string | null
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          channel_item_id?: string | null
          channel_quantity?: number
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_customer_id?: string | null
          external_subscription_id?: string | null
          period_peak_quantity?: number
          subscription_status?:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          base_item_id?: string | null
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          channel_item_id?: string | null
          channel_quantity?: number
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_customer_id?: string | null
          external_subscription_id?: string | null
          period_peak_quantity?: number
          subscription_status?:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_billing_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_events: {
        Row: {
          actor_user_id: string | null
          channel_listing_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          product_id: string | null
          run_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_user_id?: string | null
          channel_listing_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          product_id?: string | null
          run_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_user_id?: string | null
          channel_listing_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          product_id?: string | null
          run_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_events_listing_fk"
            columns: ["channel_listing_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channel_listings"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "workspace_events_product_fk"
            columns: ["product_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "workspace_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_workspace: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "workspaces"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      is_workspace_owner: { Args: { p_workspace_id: string }; Returns: boolean }
      provision_personal_workspace: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "workspaces"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      storage_object_workspace_id: { Args: { p_name: string }; Returns: string }
      uuid_or_null: { Args: { p_value: string }; Returns: string }
    }
    Enums: {
      ai_generation_status:
        | "pending"
        | "running"
        | "succeeded"
        | "failed"
        | "rejected"
      ai_generation_type: "listing" | "field"
      asset_state: "pending" | "ready" | "failed"
      asset_type:
        | "deliverable"
        | "source_file"
        | "archive"
        | "cover_image"
        | "preview_image"
        | "thumbnail"
        | "specimen"
        | "documentation"
        | "license"
        | "screenshot"
        | "promotional"
        | "other"
      billing_event_kind: "channel_connected" | "channel_disconnected"
      billing_event_status: "pending" | "applied" | "skipped" | "failed"
      channel_integration_type: "api" | "assisted"
      channel_status: "available" | "coming_soon" | "unavailable"
      connection_status: "active" | "expired" | "revoked" | "error"
      listing_status:
        | "draft"
        | "ready"
        | "publishing"
        | "published"
        | "failed"
        | "archived"
      listing_status_source: "verified" | "self_reported"
      product_status:
        | "draft"
        | "incomplete"
        | "ready"
        | "publishing"
        | "published"
        | "archived"
      product_type:
        | "font"
        | "template"
        | "graphic"
        | "photo"
        | "illustration"
        | "icon"
        | "mockup"
        | "brush"
        | "three_d"
        | "theme"
        | "other"
      publication_job_kind: "publish" | "update" | "activate"
      publication_job_status: "pending" | "running" | "succeeded" | "failed"
      snapshot_type:
        | "build"
        | "publish"
        | "update"
        | "unpublish"
        | "generate"
        | "restore"
      subscription_status:
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid"
        | "paused"
      workspace_role: "owner" | "admin" | "editor" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_generation_status: [
        "pending",
        "running",
        "succeeded",
        "failed",
        "rejected",
      ],
      ai_generation_type: ["listing", "field"],
      asset_state: ["pending", "ready", "failed"],
      asset_type: [
        "deliverable",
        "source_file",
        "archive",
        "cover_image",
        "preview_image",
        "thumbnail",
        "specimen",
        "documentation",
        "license",
        "screenshot",
        "promotional",
        "other",
      ],
      billing_event_kind: ["channel_connected", "channel_disconnected"],
      billing_event_status: ["pending", "applied", "skipped", "failed"],
      channel_integration_type: ["api", "assisted"],
      channel_status: ["available", "coming_soon", "unavailable"],
      connection_status: ["active", "expired", "revoked", "error"],
      listing_status: [
        "draft",
        "ready",
        "publishing",
        "published",
        "failed",
        "archived",
      ],
      listing_status_source: ["verified", "self_reported"],
      product_status: [
        "draft",
        "incomplete",
        "ready",
        "publishing",
        "published",
        "archived",
      ],
      product_type: [
        "font",
        "template",
        "graphic",
        "photo",
        "illustration",
        "icon",
        "mockup",
        "brush",
        "three_d",
        "theme",
        "other",
      ],
      publication_job_kind: ["publish", "update", "activate"],
      publication_job_status: ["pending", "running", "succeeded", "failed"],
      snapshot_type: [
        "build",
        "publish",
        "update",
        "unpublish",
        "generate",
        "restore",
      ],
      subscription_status: [
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
      ],
      workspace_role: ["owner", "admin", "editor", "viewer"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const


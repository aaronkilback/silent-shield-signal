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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      agent_conversations: {
        Row: {
          agent_id: string
          client_id: string | null
          created_at: string
          id: string
          status: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          client_id?: string | null
          created_at?: string
          id?: string
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          client_id?: string | null
          created_at?: string
          id?: string
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agents: {
        Row: {
          avatar_color: string | null
          avatar_image: string | null
          call_sign: string
          codename: string
          created_at: string
          created_by: string | null
          header_name: string | null
          id: string
          input_sources: string[] | null
          interaction_style: string
          is_active: boolean | null
          is_client_facing: boolean | null
          mission_scope: string
          output_types: string[] | null
          persona: string
          roe_id: string | null
          specialty: string
          system_prompt: string | null
          updated_at: string
        }
        Insert: {
          avatar_color?: string | null
          avatar_image?: string | null
          call_sign: string
          codename: string
          created_at?: string
          created_by?: string | null
          header_name?: string | null
          id?: string
          input_sources?: string[] | null
          interaction_style?: string
          is_active?: boolean | null
          is_client_facing?: boolean | null
          mission_scope: string
          output_types?: string[] | null
          persona: string
          roe_id?: string | null
          specialty: string
          system_prompt?: string | null
          updated_at?: string
        }
        Update: {
          avatar_color?: string | null
          avatar_image?: string | null
          call_sign?: string
          codename?: string
          created_at?: string
          created_by?: string | null
          header_name?: string | null
          id?: string
          input_sources?: string[] | null
          interaction_style?: string
          is_active?: boolean | null
          is_client_facing?: boolean | null
          mission_scope?: string
          output_types?: string[] | null
          persona?: string
          roe_id?: string | null
          specialty?: string
          system_prompt?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agents_roe_id_fkey"
            columns: ["roe_id"]
            isOneToOne: false
            referencedRelation: "rules_of_engagement"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_assistant_messages: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          channel: string
          created_at: string
          id: string
          incident_id: string | null
          recipient: string
          response_json: Json | null
          sent_at: string | null
          status: Database["public"]["Enums"]["alert_status"]
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          incident_id?: string | null
          recipient: string
          response_json?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          incident_id?: string | null
          recipient?: string
          response_json?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          permissions: Json
          rate_limit_per_minute: number
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          permissions?: Json
          rate_limit_per_minute?: number
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          permissions?: Json
          rate_limit_per_minute?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage_logs: {
        Row: {
          api_key_id: string | null
          created_at: string
          endpoint: string
          error_message: string | null
          id: string
          ip_address: string | null
          method: string
          request_params: Json | null
          response_time_ms: number | null
          status_code: number
          user_agent: string | null
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          endpoint: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          method: string
          request_params?: Json | null
          response_time_ms?: number | null
          status_code: number
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          endpoint?: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          method?: string
          request_params?: Json | null
          response_time_ms?: number | null
          status_code?: number
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      archival_documents: {
        Row: {
          client_id: string | null
          content_hash: string | null
          content_text: string | null
          correlated_entity_ids: string[] | null
          created_at: string
          date_of_document: string | null
          entity_mentions: string[] | null
          file_size: number
          file_type: string
          filename: string
          id: string
          is_archival: boolean | null
          keywords: string[] | null
          metadata: Json | null
          storage_path: string
          summary: string | null
          tags: string[] | null
          updated_at: string
          upload_date: string
          uploaded_by: string | null
        }
        Insert: {
          client_id?: string | null
          content_hash?: string | null
          content_text?: string | null
          correlated_entity_ids?: string[] | null
          created_at?: string
          date_of_document?: string | null
          entity_mentions?: string[] | null
          file_size: number
          file_type: string
          filename: string
          id?: string
          is_archival?: boolean | null
          keywords?: string[] | null
          metadata?: Json | null
          storage_path: string
          summary?: string | null
          tags?: string[] | null
          updated_at?: string
          upload_date?: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string | null
          content_hash?: string | null
          content_text?: string | null
          correlated_entity_ids?: string[] | null
          created_at?: string
          date_of_document?: string | null
          entity_mentions?: string[] | null
          file_size?: number
          file_type?: string
          filename?: string
          id?: string
          is_archival?: boolean | null
          keywords?: string[] | null
          metadata?: Json | null
          storage_path?: string
          summary?: string | null
          tags?: string[] | null
          updated_at?: string
          upload_date?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "archival_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archival_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_vulnerabilities: {
        Row: {
          affected_component: string | null
          asset_id: string
          created_at: string
          cvss_score: number | null
          description: string | null
          discovered_at: string
          due_date: string | null
          id: string
          is_active_exploit_known: boolean | null
          metadata: Json | null
          patched_at: string | null
          remediation_notes: string | null
          remediation_status: Database["public"]["Enums"]["remediation_status"]
          severity: Database["public"]["Enums"]["vulnerability_severity"]
          updated_at: string
          vulnerability_id: string
        }
        Insert: {
          affected_component?: string | null
          asset_id: string
          created_at?: string
          cvss_score?: number | null
          description?: string | null
          discovered_at?: string
          due_date?: string | null
          id?: string
          is_active_exploit_known?: boolean | null
          metadata?: Json | null
          patched_at?: string | null
          remediation_notes?: string | null
          remediation_status?: Database["public"]["Enums"]["remediation_status"]
          severity?: Database["public"]["Enums"]["vulnerability_severity"]
          updated_at?: string
          vulnerability_id: string
        }
        Update: {
          affected_component?: string | null
          asset_id?: string
          created_at?: string
          cvss_score?: number | null
          description?: string | null
          discovered_at?: string
          due_date?: string | null
          id?: string
          is_active_exploit_known?: boolean | null
          metadata?: Json | null
          patched_at?: string | null
          remediation_notes?: string | null
          remediation_status?: Database["public"]["Enums"]["remediation_status"]
          severity?: Database["public"]["Enums"]["vulnerability_severity"]
          updated_at?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_vulnerabilities_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "internal_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          mime: string
          parent_id: string
          parent_type: string
          storage_url: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          mime: string
          parent_id: string
          parent_type: string
          storage_url: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          mime?: string
          parent_id?: string
          parent_type?: string
          storage_url?: string
        }
        Relationships: []
      }
      automation_metrics: {
        Row: {
          accuracy_rate: number | null
          alerts_sent: number | null
          average_response_time_seconds: number | null
          created_at: string
          false_positive_rate: number | null
          id: string
          incidents_auto_escalated: number | null
          incidents_created: number | null
          metric_date: string
          osint_scans_completed: number | null
          signals_processed: number | null
        }
        Insert: {
          accuracy_rate?: number | null
          alerts_sent?: number | null
          average_response_time_seconds?: number | null
          created_at?: string
          false_positive_rate?: number | null
          id?: string
          incidents_auto_escalated?: number | null
          incidents_created?: number | null
          metric_date?: string
          osint_scans_completed?: number | null
          signals_processed?: number | null
        }
        Update: {
          accuracy_rate?: number | null
          alerts_sent?: number | null
          average_response_time_seconds?: number | null
          created_at?: string
          false_positive_rate?: number | null
          id?: string
          incidents_auto_escalated?: number | null
          incidents_created?: number | null
          metric_date?: string
          osint_scans_completed?: number | null
          signals_processed?: number | null
        }
        Relationships: []
      }
      bug_reports: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          browser_info: string | null
          created_at: string | null
          description: string
          fix_proposal: Json | null
          fix_status: string | null
          id: string
          implemented_at: string | null
          page_url: string | null
          resolved_at: string | null
          screenshots: string[] | null
          severity: string
          status: string
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          browser_info?: string | null
          created_at?: string | null
          description: string
          fix_proposal?: Json | null
          fix_status?: string | null
          id?: string
          implemented_at?: string | null
          page_url?: string | null
          resolved_at?: string | null
          screenshots?: string[] | null
          severity: string
          status?: string
          title: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          browser_info?: string | null
          created_at?: string | null
          description?: string
          fix_proposal?: Json | null
          fix_status?: string | null
          id?: string
          implemented_at?: string | null
          page_url?: string | null
          resolved_at?: string | null
          screenshots?: string[] | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          competitor_names: string[] | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          employee_count: number | null
          high_value_assets: string[] | null
          id: string
          industry: string | null
          locations: string[] | null
          monitoring_config: Json | null
          monitoring_keywords: string[] | null
          name: string
          onboarding_data: Json | null
          organization: string | null
          risk_assessment: Json | null
          status: string
          supply_chain_entities: string[] | null
          threat_profile: Json | null
          updated_at: string
        }
        Insert: {
          competitor_names?: string[] | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          employee_count?: number | null
          high_value_assets?: string[] | null
          id?: string
          industry?: string | null
          locations?: string[] | null
          monitoring_config?: Json | null
          monitoring_keywords?: string[] | null
          name: string
          onboarding_data?: Json | null
          organization?: string | null
          risk_assessment?: Json | null
          status?: string
          supply_chain_entities?: string[] | null
          threat_profile?: Json | null
          updated_at?: string
        }
        Update: {
          competitor_names?: string[] | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          employee_count?: number | null
          high_value_assets?: string[] | null
          id?: string
          industry?: string | null
          locations?: string[] | null
          monitoring_config?: Json | null
          monitoring_keywords?: string[] | null
          name?: string
          onboarding_data?: Json | null
          organization?: string | null
          risk_assessment?: Json | null
          status?: string
          supply_chain_entities?: string[] | null
          threat_profile?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      conversation_memory: {
        Row: {
          client_id: string | null
          content: string
          context_tags: string[] | null
          created_at: string
          expires_at: string | null
          id: string
          importance_score: number | null
          memory_type: string
          source_conversation_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          content: string
          context_tags?: string[] | null
          created_at?: string
          expires_at?: string | null
          id?: string
          importance_score?: number | null
          memory_type: string
          source_conversation_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          content?: string
          context_tags?: string[] | null
          created_at?: string
          expires_at?: string | null
          id?: string
          importance_score?: number | null
          memory_type?: string
          source_conversation_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_memory_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      document_entity_mentions: {
        Row: {
          confidence: number | null
          created_at: string | null
          document_id: string
          entity_id: string
          id: string
          mention_text: string | null
          position_end: number | null
          position_start: number | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          document_id: string
          entity_id: string
          id?: string
          mention_text?: string | null
          position_end?: number | null
          position_start?: number | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          document_id?: string
          entity_id?: string
          id?: string
          mention_text?: string | null
          position_end?: number | null
          position_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_entity_mentions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ingested_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_entity_mentions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      document_hashes: {
        Row: {
          archival_document_id: string | null
          content_hash: string
          created_at: string
          file_size: number
          filename: string
          first_uploaded_at: string
          id: string
          signal_id: string | null
          upload_count: number | null
        }
        Insert: {
          archival_document_id?: string | null
          content_hash: string
          created_at?: string
          file_size: number
          filename: string
          first_uploaded_at?: string
          id?: string
          signal_id?: string | null
          upload_count?: number | null
        }
        Update: {
          archival_document_id?: string | null
          content_hash?: string
          created_at?: string
          file_size?: number
          filename?: string
          first_uploaded_at?: string
          id?: string
          signal_id?: string | null
          upload_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_hashes_archival_document_id_fkey"
            columns: ["archival_document_id"]
            isOneToOne: false
            referencedRelation: "archival_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_hashes_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_detections: {
        Row: {
          created_at: string
          detection_method: string
          detection_type: string
          duplicate_id: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          similarity_score: number
          source_id: string
          status: string | null
        }
        Insert: {
          created_at?: string
          detection_method: string
          detection_type: string
          duplicate_id: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity_score: number
          source_id: string
          status?: string | null
        }
        Update: {
          created_at?: string
          detection_method?: string
          detection_type?: string
          duplicate_id?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity_score?: number
          source_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_detections_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          active_monitoring_enabled: boolean | null
          address_city: string | null
          address_country: string | null
          address_postal_code: string | null
          address_province: string | null
          address_street: string | null
          aliases: string[] | null
          associations: string[] | null
          attributes: Json | null
          client_id: string | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          current_location: string | null
          description: string | null
          entity_status: string | null
          id: string
          is_active: boolean | null
          monitoring_radius_km: number | null
          name: string
          risk_level: string | null
          threat_indicators: string[] | null
          threat_score: number | null
          type: Database["public"]["Enums"]["entity_type"]
          updated_at: string
        }
        Insert: {
          active_monitoring_enabled?: boolean | null
          address_city?: string | null
          address_country?: string | null
          address_postal_code?: string | null
          address_province?: string | null
          address_street?: string | null
          aliases?: string[] | null
          associations?: string[] | null
          attributes?: Json | null
          client_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          current_location?: string | null
          description?: string | null
          entity_status?: string | null
          id?: string
          is_active?: boolean | null
          monitoring_radius_km?: number | null
          name: string
          risk_level?: string | null
          threat_indicators?: string[] | null
          threat_score?: number | null
          type: Database["public"]["Enums"]["entity_type"]
          updated_at?: string
        }
        Update: {
          active_monitoring_enabled?: boolean | null
          address_city?: string | null
          address_country?: string | null
          address_postal_code?: string | null
          address_province?: string | null
          address_street?: string | null
          aliases?: string[] | null
          associations?: string[] | null
          attributes?: Json | null
          client_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          current_location?: string | null
          description?: string | null
          entity_status?: string | null
          id?: string
          is_active?: boolean | null
          monitoring_radius_km?: number | null
          name?: string
          risk_level?: string | null
          threat_indicators?: string[] | null
          threat_score?: number | null
          type?: Database["public"]["Enums"]["entity_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_content: {
        Row: {
          author: string | null
          content_text: string | null
          content_type: string
          created_at: string | null
          created_by: string | null
          entity_id: string
          excerpt: string | null
          feedback_at: string | null
          feedback_by: string | null
          feedback_rating: number | null
          id: string
          metadata: Json | null
          published_date: string | null
          relevance_score: number | null
          sentiment: string | null
          source: string | null
          title: string | null
          updated_at: string | null
          url: string
        }
        Insert: {
          author?: string | null
          content_text?: string | null
          content_type: string
          created_at?: string | null
          created_by?: string | null
          entity_id: string
          excerpt?: string | null
          feedback_at?: string | null
          feedback_by?: string | null
          feedback_rating?: number | null
          id?: string
          metadata?: Json | null
          published_date?: string | null
          relevance_score?: number | null
          sentiment?: string | null
          source?: string | null
          title?: string | null
          updated_at?: string | null
          url: string
        }
        Update: {
          author?: string | null
          content_text?: string | null
          content_type?: string
          created_at?: string | null
          created_by?: string | null
          entity_id?: string
          excerpt?: string | null
          feedback_at?: string | null
          feedback_by?: string | null
          feedback_rating?: number | null
          id?: string
          metadata?: Json | null
          published_date?: string | null
          relevance_score?: number | null
          sentiment?: string | null
          source?: string | null
          title?: string | null
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_content_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_content_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_content_feedback_by_fkey"
            columns: ["feedback_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_mentions: {
        Row: {
          confidence: number | null
          context: string | null
          created_at: string
          detected_at: string
          entity_id: string
          id: string
          incident_id: string | null
          signal_id: string | null
        }
        Insert: {
          confidence?: number | null
          context?: string | null
          created_at?: string
          detected_at?: string
          entity_id: string
          id?: string
          incident_id?: string | null
          signal_id?: string | null
        }
        Update: {
          confidence?: number | null
          context?: string | null
          created_at?: string
          detected_at?: string
          entity_id?: string
          id?: string
          incident_id?: string | null
          signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_mentions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_notifications: {
        Row: {
          created_at: string
          entity_id: string
          id: string
          is_read: boolean | null
          mention_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          id?: string
          is_read?: boolean | null
          mention_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          id?: string
          is_read?: boolean | null
          mention_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_notifications_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_notifications_mention_id_fkey"
            columns: ["mention_id"]
            isOneToOne: false
            referencedRelation: "entity_mentions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_photos: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          entity_id: string
          feedback_at: string | null
          feedback_by: string | null
          feedback_rating: number | null
          id: string
          source: string | null
          storage_path: string
          updated_at: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          entity_id: string
          feedback_at?: string | null
          feedback_by?: string | null
          feedback_rating?: number | null
          id?: string
          source?: string | null
          storage_path: string
          updated_at?: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string
          feedback_at?: string | null
          feedback_by?: string | null
          feedback_rating?: number | null
          id?: string
          source?: string | null
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_photos_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_photos_feedback_by_fkey"
            columns: ["feedback_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_relationships: {
        Row: {
          created_at: string
          description: string | null
          entity_a_id: string
          entity_b_id: string
          feedback_at: string | null
          feedback_by: string | null
          feedback_rating: number | null
          first_observed: string
          id: string
          last_observed: string
          occurrence_count: number | null
          relationship_type: string
          strength: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_a_id: string
          entity_b_id: string
          feedback_at?: string | null
          feedback_by?: string | null
          feedback_rating?: number | null
          first_observed?: string
          id?: string
          last_observed?: string
          occurrence_count?: number | null
          relationship_type: string
          strength?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_a_id?: string
          entity_b_id?: string
          feedback_at?: string | null
          feedback_by?: string | null
          feedback_rating?: number | null
          first_observed?: string
          id?: string
          last_observed?: string
          occurrence_count?: number | null
          relationship_type?: string
          strength?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_entity_a_id_fkey"
            columns: ["entity_a_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_entity_b_id_fkey"
            columns: ["entity_b_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_feedback_by_fkey"
            columns: ["feedback_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_suggestions: {
        Row: {
          confidence: number | null
          context: string | null
          created_at: string
          id: string
          matched_entity_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string
          source_type: string
          status: string | null
          suggested_aliases: string[] | null
          suggested_attributes: Json | null
          suggested_name: string
          suggested_type: string
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          context?: string | null
          created_at?: string
          id?: string
          matched_entity_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id: string
          source_type: string
          status?: string | null
          suggested_aliases?: string[] | null
          suggested_attributes?: Json | null
          suggested_name: string
          suggested_type: string
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          context?: string | null
          created_at?: string
          id?: string
          matched_entity_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string
          source_type?: string
          status?: string | null
          suggested_aliases?: string[] | null
          suggested_attributes?: Json | null
          suggested_name?: string
          suggested_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_suggestions_matched_entity_id_fkey"
            columns: ["matched_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_suggestions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_rules: {
        Row: {
          actions: Json
          conditions: Json
          created_at: string
          description: string | null
          escalate_after_minutes: number
          id: string
          is_active: boolean
          name: string
          notify_recipients: string[]
          priority: string
          updated_at: string
        }
        Insert: {
          actions: Json
          conditions: Json
          created_at?: string
          description?: string | null
          escalate_after_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          notify_recipients?: string[]
          priority: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          conditions?: Json
          created_at?: string
          description?: string | null
          escalate_after_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          notify_recipients?: string[]
          priority?: string
          updated_at?: string
        }
        Relationships: []
      }
      feedback_events: {
        Row: {
          created_at: string | null
          feedback: string
          id: string
          notes: string | null
          object_id: string
          object_type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          feedback: string
          id?: string
          notes?: string | null
          object_id: string
          object_type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          feedback?: string
          id?: string
          notes?: string | null
          object_id?: string
          object_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      improvements: {
        Row: {
          created_at: string
          description: string
          id: string
          incident_id: string | null
          owner_user_id: string | null
          shot_or_brick: Database["public"]["Enums"]["improvement_type"]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          incident_id?: string | null
          owner_user_id?: string | null
          shot_or_brick: Database["public"]["Enums"]["improvement_type"]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          incident_id?: string | null
          owner_user_id?: string | null
          shot_or_brick?: Database["public"]["Enums"]["improvement_type"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "improvements_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "improvements_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_entities: {
        Row: {
          created_at: string | null
          entity_id: string
          incident_id: string
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          incident_id: string
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_entities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_entities_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_outcomes: {
        Row: {
          created_at: string
          false_positive: boolean | null
          id: string
          improvement_suggestions: string[] | null
          incident_id: string | null
          lessons_learned: string | null
          outcome_type: string
          response_time_seconds: number | null
          updated_at: string
          was_accurate: boolean | null
        }
        Insert: {
          created_at?: string
          false_positive?: boolean | null
          id?: string
          improvement_suggestions?: string[] | null
          incident_id?: string | null
          lessons_learned?: string | null
          outcome_type: string
          response_time_seconds?: number | null
          updated_at?: string
          was_accurate?: boolean | null
        }
        Update: {
          created_at?: string
          false_positive?: boolean | null
          id?: string
          improvement_suggestions?: string[] | null
          incident_id?: string | null
          lessons_learned?: string | null
          outcome_type?: string
          response_time_seconds?: number | null
          updated_at?: string
          was_accurate?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_outcomes_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_signals: {
        Row: {
          incident_id: string
          linked_at: string | null
          signal_id: string
        }
        Insert: {
          incident_id: string
          linked_at?: string | null
          signal_id: string
        }
        Update: {
          incident_id?: string
          linked_at?: string | null
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_signals_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_signals_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          acknowledged_at: string | null
          ai_analysis_log: Json | null
          assigned_agent_ids: string[] | null
          client_id: string | null
          contained_at: string | null
          created_at: string
          id: string
          incident_type: string | null
          initial_agent_prompt: string | null
          investigation_status: string | null
          is_read: boolean | null
          is_test: boolean | null
          opened_at: string
          owner_user_id: string | null
          priority: Database["public"]["Enums"]["incident_priority"]
          resolved_at: string | null
          severity_level: string | null
          signal_id: string | null
          sla_targets_json: Json | null
          status: Database["public"]["Enums"]["incident_status"]
          summary: string | null
          task_force_name: string | null
          timeline_json: Json | null
          title: string | null
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          ai_analysis_log?: Json | null
          assigned_agent_ids?: string[] | null
          client_id?: string | null
          contained_at?: string | null
          created_at?: string
          id?: string
          incident_type?: string | null
          initial_agent_prompt?: string | null
          investigation_status?: string | null
          is_read?: boolean | null
          is_test?: boolean | null
          opened_at?: string
          owner_user_id?: string | null
          priority?: Database["public"]["Enums"]["incident_priority"]
          resolved_at?: string | null
          severity_level?: string | null
          signal_id?: string | null
          sla_targets_json?: Json | null
          status?: Database["public"]["Enums"]["incident_status"]
          summary?: string | null
          task_force_name?: string | null
          timeline_json?: Json | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          ai_analysis_log?: Json | null
          assigned_agent_ids?: string[] | null
          client_id?: string | null
          contained_at?: string | null
          created_at?: string
          id?: string
          incident_type?: string | null
          initial_agent_prompt?: string | null
          investigation_status?: string | null
          is_read?: boolean | null
          is_test?: boolean | null
          opened_at?: string
          owner_user_id?: string | null
          priority?: Database["public"]["Enums"]["incident_priority"]
          resolved_at?: string | null
          severity_level?: string | null
          signal_id?: string | null
          sla_targets_json?: Json | null
          status?: Database["public"]["Enums"]["incident_status"]
          summary?: string | null
          task_force_name?: string | null
          timeline_json?: Json | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      ingested_documents: {
        Row: {
          chunk_index: number | null
          content_hash: string | null
          created_at: string | null
          error_message: string | null
          id: string
          ingested_at: string | null
          metadata: Json | null
          parent_document_id: string | null
          processed_at: string | null
          processing_status: string | null
          raw_text: string | null
          source_id: string | null
          title: string | null
          total_chunks: number | null
        }
        Insert: {
          chunk_index?: number | null
          content_hash?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          ingested_at?: string | null
          metadata?: Json | null
          parent_document_id?: string | null
          processed_at?: string | null
          processing_status?: string | null
          raw_text?: string | null
          source_id?: string | null
          title?: string | null
          total_chunks?: number | null
        }
        Update: {
          chunk_index?: number | null
          content_hash?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          ingested_at?: string | null
          metadata?: Json | null
          parent_document_id?: string | null
          processed_at?: string | null
          processing_status?: string | null
          raw_text?: string | null
          source_id?: string | null
          title?: string | null
          total_chunks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ingested_documents_parent_document_id_fkey"
            columns: ["parent_document_id"]
            isOneToOne: false
            referencedRelation: "ingested_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingested_documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      intelligence_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "intelligence_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_assets: {
        Row: {
          asset_name: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          business_criticality: Database["public"]["Enums"]["business_criticality_level"]
          client_id: string | null
          cloud_provider: string | null
          cloud_service: string | null
          configuration_details: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_internet_facing: boolean | null
          last_patched_date: string | null
          last_scanned: string | null
          location: string | null
          metadata: Json | null
          network_segment: string | null
          owner_team: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          asset_name: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          business_criticality?: Database["public"]["Enums"]["business_criticality_level"]
          client_id?: string | null
          cloud_provider?: string | null
          cloud_service?: string | null
          configuration_details?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_internet_facing?: boolean | null
          last_patched_date?: string | null
          last_scanned?: string | null
          location?: string | null
          metadata?: Json | null
          network_segment?: string | null
          owner_team?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          asset_name?: string
          asset_type?: Database["public"]["Enums"]["asset_type"]
          business_criticality?: Database["public"]["Enums"]["business_criticality_level"]
          client_id?: string | null
          cloud_provider?: string | null
          cloud_service?: string | null
          configuration_details?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_internet_facing?: boolean | null
          last_patched_date?: string | null
          last_scanned?: string | null
          location?: string | null
          metadata?: Json | null
          network_segment?: string | null
          owner_team?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_attachments: {
        Row: {
          description: string | null
          file_size: number | null
          file_type: string
          filename: string
          id: string
          investigation_id: string | null
          storage_path: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          description?: string | null
          file_size?: number | null
          file_type: string
          filename: string
          id?: string
          investigation_id?: string | null
          storage_path: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          description?: string | null
          file_size?: number | null
          file_type?: string
          filename?: string
          id?: string
          investigation_id?: string | null
          storage_path?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investigation_attachments_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_entries: {
        Row: {
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          entry_text: string
          entry_timestamp: string | null
          id: string
          investigation_id: string | null
          is_ai_generated: boolean | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          entry_text: string
          entry_timestamp?: string | null
          id?: string
          investigation_id?: string | null
          is_ai_generated?: boolean | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          entry_text?: string
          entry_timestamp?: string | null
          id?: string
          investigation_id?: string | null
          is_ai_generated?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investigation_entries_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_persons: {
        Row: {
          company: string | null
          created_at: string | null
          id: string
          investigation_id: string | null
          name: string
          phone: string | null
          position: string | null
          status: string
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          id?: string
          investigation_id?: string | null
          name: string
          phone?: string | null
          position?: string | null
          status: string
        }
        Update: {
          company?: string | null
          created_at?: string | null
          id?: string
          investigation_id?: string | null
          name?: string
          phone?: string | null
          position?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_persons_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      investigations: {
        Row: {
          client_id: string | null
          correlated_entity_ids: string[] | null
          created_at: string | null
          created_by_name: string | null
          cross_references: string[] | null
          file_number: string
          file_status: string | null
          id: string
          incident_id: string | null
          information: string | null
          maximo_number: string | null
          police_file_number: string | null
          prepared_by: string | null
          recommendations: string | null
          synopsis: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          correlated_entity_ids?: string[] | null
          created_at?: string | null
          created_by_name?: string | null
          cross_references?: string[] | null
          file_number: string
          file_status?: string | null
          id?: string
          incident_id?: string | null
          information?: string | null
          maximo_number?: string | null
          police_file_number?: string | null
          prepared_by?: string | null
          recommendations?: string | null
          synopsis?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          correlated_entity_ids?: string[] | null
          created_at?: string | null
          created_by_name?: string | null
          cross_references?: string[] | null
          file_number?: string
          file_status?: string | null
          id?: string
          incident_id?: string | null
          information?: string | null
          maximo_number?: string | null
          police_file_number?: string | null
          prepared_by?: string | null
          recommendations?: string | null
          synopsis?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investigations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigations_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      itineraries: {
        Row: {
          accommodation_details: Json | null
          ai_risk_assessment: Json | null
          client_id: string | null
          created_at: string
          created_by: string | null
          departure_date: string
          destination_city: string
          destination_country: string
          file_path: string | null
          flight_numbers: string[] | null
          hotel_address: string | null
          hotel_name: string | null
          id: string
          meeting_schedule: Json | null
          monitoring_enabled: boolean | null
          notes: string | null
          origin_city: string
          origin_country: string
          return_date: string
          risk_level: string | null
          status: string
          transportation_details: Json | null
          traveler_id: string
          trip_name: string
          trip_type: string
          updated_at: string
        }
        Insert: {
          accommodation_details?: Json | null
          ai_risk_assessment?: Json | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          departure_date: string
          destination_city: string
          destination_country: string
          file_path?: string | null
          flight_numbers?: string[] | null
          hotel_address?: string | null
          hotel_name?: string | null
          id?: string
          meeting_schedule?: Json | null
          monitoring_enabled?: boolean | null
          notes?: string | null
          origin_city: string
          origin_country: string
          return_date: string
          risk_level?: string | null
          status?: string
          transportation_details?: Json | null
          traveler_id: string
          trip_name: string
          trip_type?: string
          updated_at?: string
        }
        Update: {
          accommodation_details?: Json | null
          ai_risk_assessment?: Json | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          departure_date?: string
          destination_city?: string
          destination_country?: string
          file_path?: string | null
          flight_numbers?: string[] | null
          hotel_address?: string | null
          hotel_name?: string | null
          id?: string
          meeting_schedule?: Json | null
          monitoring_enabled?: boolean | null
          notes?: string | null
          origin_city?: string
          origin_country?: string
          return_date?: string
          risk_level?: string | null
          status?: string
          transportation_details?: Json | null
          traveler_id?: string
          trip_name?: string
          trip_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itineraries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itineraries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itineraries_traveler_id_fkey"
            columns: ["traveler_id"]
            isOneToOne: false
            referencedRelation: "travelers"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_articles: {
        Row: {
          category_id: string | null
          content: string
          created_at: string | null
          created_by: string | null
          helpful_count: number | null
          id: string
          is_published: boolean | null
          not_helpful_count: number | null
          summary: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
          view_count: number | null
        }
        Insert: {
          category_id?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          helpful_count?: number | null
          id?: string
          is_published?: boolean | null
          not_helpful_count?: number | null
          summary?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
          view_count?: number | null
        }
        Update: {
          category_id?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          helpful_count?: number | null
          id?: string
          is_published?: boolean | null
          not_helpful_count?: number | null
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_base_articles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_categories: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          icon: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      learning_profiles: {
        Row: {
          created_at: string | null
          features: Json
          id: string
          last_updated: string | null
          profile_type: string
          sample_count: number | null
          weight: number | null
        }
        Insert: {
          created_at?: string | null
          features?: Json
          id?: string
          last_updated?: string | null
          profile_type: string
          sample_count?: number | null
          weight?: number | null
        }
        Update: {
          created_at?: string | null
          features?: Json
          id?: string
          last_updated?: string | null
          profile_type?: string
          sample_count?: number | null
          weight?: number | null
        }
        Relationships: []
      }
      memory_access_log: {
        Row: {
          accessed_at: string
          id: string
          memory_id: string | null
          project_id: string | null
          user_id: string
          was_useful: boolean | null
        }
        Insert: {
          accessed_at?: string
          id?: string
          memory_id?: string | null
          project_id?: string | null
          user_id: string
          was_useful?: boolean | null
        }
        Update: {
          accessed_at?: string
          id?: string
          memory_id?: string | null
          project_id?: string | null
          user_id?: string
          was_useful?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "memory_access_log_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "conversation_memory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_access_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "user_project_context"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_history: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          items_scanned: number | null
          scan_completed_at: string | null
          scan_metadata: Json | null
          scan_started_at: string
          signals_created: number | null
          source_name: string
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          items_scanned?: number | null
          scan_completed_at?: string | null
          scan_metadata?: Json | null
          scan_started_at?: string
          signals_created?: number | null
          source_name: string
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          items_scanned?: number | null
          scan_completed_at?: string | null
          scan_metadata?: Json | null
          scan_started_at?: string
          signals_created?: number | null
          source_name?: string
          status?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          alert_frequency: string | null
          created_at: string | null
          email_address: string | null
          email_notifications: boolean | null
          entity_mentions: boolean | null
          id: string
          incident_alerts: boolean | null
          slack_webhook: string | null
          teams_webhook: string | null
          updated_at: string | null
          user_id: string
          weekly_reports: boolean | null
        }
        Insert: {
          alert_frequency?: string | null
          created_at?: string | null
          email_address?: string | null
          email_notifications?: boolean | null
          entity_mentions?: boolean | null
          id?: string
          incident_alerts?: boolean | null
          slack_webhook?: string | null
          teams_webhook?: string | null
          updated_at?: string | null
          user_id: string
          weekly_reports?: boolean | null
        }
        Update: {
          alert_frequency?: string | null
          created_at?: string | null
          email_address?: string | null
          email_notifications?: boolean | null
          entity_mentions?: boolean | null
          id?: string
          incident_alerts?: boolean | null
          slack_webhook?: string | null
          teams_webhook?: string | null
          updated_at?: string | null
          user_id?: string
          weekly_reports?: boolean | null
        }
        Relationships: []
      }
      oauth_access_tokens: {
        Row: {
          access_token_hash: string
          created_at: string
          expires_at: string
          id: string
          oauth_client_id: string
          scopes: string[]
        }
        Insert: {
          access_token_hash: string
          created_at?: string
          expires_at: string
          id?: string
          oauth_client_id: string
          scopes: string[]
        }
        Update: {
          access_token_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          oauth_client_id?: string
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "oauth_access_tokens_oauth_client_id_fkey"
            columns: ["oauth_client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          client_name: string
          client_secret_hash: string
          created_at: string
          created_by: string | null
          grant_types: string[]
          id: string
          is_active: boolean
          redirect_uris: string[] | null
          scopes: string[]
          updated_at: string
        }
        Insert: {
          client_id: string
          client_name: string
          client_secret_hash: string
          created_at?: string
          created_by?: string | null
          grant_types?: string[]
          id?: string
          is_active?: boolean
          redirect_uris?: string[] | null
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_name?: string
          client_secret_hash?: string
          created_at?: string
          created_by?: string | null
          grant_types?: string[]
          id?: string
          is_active?: boolean
          redirect_uris?: string[] | null
          scopes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      playbooks: {
        Row: {
          created_at: string
          id: string
          key: string
          markdown: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          markdown: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          markdown?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      predictive_threat_models: {
        Row: {
          accuracy_score: number | null
          actual_outcome: string | null
          client_id: string | null
          confidence_interval_high: number | null
          confidence_interval_low: number | null
          contributing_factors: Json | null
          created_at: string
          earliest_estimated_date: string | null
          expires_at: string | null
          id: string
          inhibiting_factors: Json | null
          key_assumptions: string[] | null
          latest_estimated_date: string | null
          model_type: string
          model_version: string | null
          predicted_timeframe: string | null
          prediction_accuracy: number | null
          probability_score: number
          target_asset_type: string | null
          target_location: string | null
          threat_scenario: string
          training_data_range: Json | null
          was_validated: boolean | null
        }
        Insert: {
          accuracy_score?: number | null
          actual_outcome?: string | null
          client_id?: string | null
          confidence_interval_high?: number | null
          confidence_interval_low?: number | null
          contributing_factors?: Json | null
          created_at?: string
          earliest_estimated_date?: string | null
          expires_at?: string | null
          id?: string
          inhibiting_factors?: Json | null
          key_assumptions?: string[] | null
          latest_estimated_date?: string | null
          model_type: string
          model_version?: string | null
          predicted_timeframe?: string | null
          prediction_accuracy?: number | null
          probability_score: number
          target_asset_type?: string | null
          target_location?: string | null
          threat_scenario: string
          training_data_range?: Json | null
          was_validated?: boolean | null
        }
        Update: {
          accuracy_score?: number | null
          actual_outcome?: string | null
          client_id?: string | null
          confidence_interval_high?: number | null
          confidence_interval_low?: number | null
          contributing_factors?: Json | null
          created_at?: string
          earliest_estimated_date?: string | null
          expires_at?: string | null
          id?: string
          inhibiting_factors?: Json | null
          key_assumptions?: string[] | null
          latest_estimated_date?: string | null
          model_type?: string
          model_version?: string | null
          predicted_timeframe?: string | null
          prediction_accuracy?: number | null
          probability_score?: number
          target_asset_type?: string | null
          target_location?: string | null
          threat_scenario?: string
          training_data_range?: Json | null
          was_validated?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "predictive_threat_models_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_queue: {
        Row: {
          completed_at: string | null
          created_at: string | null
          entity_id: string
          error_message: string | null
          id: string
          max_retries: number | null
          priority: number | null
          retry_count: number | null
          scheduled_at: string | null
          started_at: string | null
          status: string | null
          task_type: string
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          entity_id: string
          error_message?: string | null
          id?: string
          max_retries?: number | null
          priority?: number | null
          retry_count?: number | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string | null
          task_type: string
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          entity_id?: string
          error_message?: string | null
          id?: string
          max_retries?: number | null
          priority?: number | null
          retry_count?: number | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string | null
          task_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      radical_activity_tracking: {
        Row: {
          activity_days: string[] | null
          activity_peak_time: string | null
          activity_type: string
          analyst_notes: string | null
          client_id: string | null
          correlated_incidents: string[] | null
          correlated_signals: string[] | null
          created_at: string
          credibility_score: number | null
          escalation_velocity: number | null
          first_detected_at: string
          group_identifier: string | null
          id: string
          last_updated_at: string | null
          mentioned_methods: string[] | null
          mentioned_targets: string[] | null
          message_volume: number | null
          operational_indicators: boolean | null
          participant_count: number | null
          platform_type: string | null
          status: string | null
          threat_keywords: string[] | null
          threat_level: string | null
          topic_category: string | null
          volume_change_pct: number | null
        }
        Insert: {
          activity_days?: string[] | null
          activity_peak_time?: string | null
          activity_type: string
          analyst_notes?: string | null
          client_id?: string | null
          correlated_incidents?: string[] | null
          correlated_signals?: string[] | null
          created_at?: string
          credibility_score?: number | null
          escalation_velocity?: number | null
          first_detected_at?: string
          group_identifier?: string | null
          id?: string
          last_updated_at?: string | null
          mentioned_methods?: string[] | null
          mentioned_targets?: string[] | null
          message_volume?: number | null
          operational_indicators?: boolean | null
          participant_count?: number | null
          platform_type?: string | null
          status?: string | null
          threat_keywords?: string[] | null
          threat_level?: string | null
          topic_category?: string | null
          volume_change_pct?: number | null
        }
        Update: {
          activity_days?: string[] | null
          activity_peak_time?: string | null
          activity_type?: string
          analyst_notes?: string | null
          client_id?: string | null
          correlated_incidents?: string[] | null
          correlated_signals?: string[] | null
          created_at?: string
          credibility_score?: number | null
          escalation_velocity?: number | null
          first_detected_at?: string
          group_identifier?: string | null
          id?: string
          last_updated_at?: string | null
          mentioned_methods?: string[] | null
          mentioned_targets?: string[] | null
          message_volume?: number | null
          operational_indicators?: boolean | null
          participant_count?: number | null
          platform_type?: string | null
          status?: string | null
          threat_keywords?: string[] | null
          threat_level?: string | null
          topic_category?: string | null
          volume_change_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "radical_activity_tracking_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          generated_at: string
          id: string
          meta_json: Json | null
          period_end: string
          period_start: string
          storage_url: string | null
          type: string
        }
        Insert: {
          created_at?: string
          generated_at?: string
          id?: string
          meta_json?: Json | null
          period_end: string
          period_start: string
          storage_url?: string | null
          type: string
        }
        Update: {
          created_at?: string
          generated_at?: string
          id?: string
          meta_json?: Json | null
          period_end?: string
          period_start?: string
          storage_url?: string | null
          type?: string
        }
        Relationships: []
      }
      rules: {
        Row: {
          actions_json: Json
          condition_json: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          actions_json: Json
          condition_json: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          actions_json?: Json
          condition_json?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rules_of_engagement: {
        Row: {
          allowed_domains: Json | null
          audience: Database["public"]["Enums"]["roe_audience"]
          classification: Database["public"]["Enums"]["roe_classification"]
          created_at: string
          created_by: string | null
          data_sources: Json | null
          description: string | null
          escalation_rules: Json | null
          evidence_policy: Json | null
          id: string
          is_global_default: boolean | null
          mode: Database["public"]["Enums"]["roe_mode"]
          name: string
          output_constraints: Json | null
          permissions: Json | null
          scope_control: Json | null
          uncertainty_protocol: Json | null
          updated_at: string
          validation_gate: Json | null
          version: string | null
        }
        Insert: {
          allowed_domains?: Json | null
          audience?: Database["public"]["Enums"]["roe_audience"]
          classification?: Database["public"]["Enums"]["roe_classification"]
          created_at?: string
          created_by?: string | null
          data_sources?: Json | null
          description?: string | null
          escalation_rules?: Json | null
          evidence_policy?: Json | null
          id?: string
          is_global_default?: boolean | null
          mode?: Database["public"]["Enums"]["roe_mode"]
          name: string
          output_constraints?: Json | null
          permissions?: Json | null
          scope_control?: Json | null
          uncertainty_protocol?: Json | null
          updated_at?: string
          validation_gate?: Json | null
          version?: string | null
        }
        Update: {
          allowed_domains?: Json | null
          audience?: Database["public"]["Enums"]["roe_audience"]
          classification?: Database["public"]["Enums"]["roe_classification"]
          created_at?: string
          created_by?: string | null
          data_sources?: Json | null
          description?: string | null
          escalation_rules?: Json | null
          evidence_policy?: Json | null
          id?: string
          is_global_default?: boolean | null
          mode?: Database["public"]["Enums"]["roe_mode"]
          name?: string
          output_constraints?: Json | null
          permissions?: Json | null
          scope_control?: Json | null
          uncertainty_protocol?: Json | null
          updated_at?: string
          validation_gate?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rules_of_engagement_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sentiment_tracking: {
        Row: {
          alert_reason: string | null
          alert_triggered: boolean | null
          asset_id: string | null
          client_id: string | null
          created_at: string
          entity_id: string | null
          geo_coordinates: unknown
          id: string
          location_name: string
          location_type: string | null
          measurement_period_end: string
          measurement_period_start: string
          mention_count: number | null
          negative_mention_count: number | null
          neutral_mention_count: number | null
          overall_sentiment: string | null
          positive_mention_count: number | null
          previous_sentiment_score: number | null
          radius_km: number | null
          sample_mentions: Json | null
          sentiment_score: number | null
          sentiment_volatility: number | null
          source_breakdown: Json | null
          top_keywords: string[] | null
          trend_direction: string | null
          trend_velocity: number | null
        }
        Insert: {
          alert_reason?: string | null
          alert_triggered?: boolean | null
          asset_id?: string | null
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          geo_coordinates?: unknown
          id?: string
          location_name: string
          location_type?: string | null
          measurement_period_end: string
          measurement_period_start: string
          mention_count?: number | null
          negative_mention_count?: number | null
          neutral_mention_count?: number | null
          overall_sentiment?: string | null
          positive_mention_count?: number | null
          previous_sentiment_score?: number | null
          radius_km?: number | null
          sample_mentions?: Json | null
          sentiment_score?: number | null
          sentiment_volatility?: number | null
          source_breakdown?: Json | null
          top_keywords?: string[] | null
          trend_direction?: string | null
          trend_velocity?: number | null
        }
        Update: {
          alert_reason?: string | null
          alert_triggered?: boolean | null
          asset_id?: string | null
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          geo_coordinates?: unknown
          id?: string
          location_name?: string
          location_type?: string | null
          measurement_period_end?: string
          measurement_period_start?: string
          mention_count?: number | null
          negative_mention_count?: number | null
          neutral_mention_count?: number | null
          overall_sentiment?: string | null
          positive_mention_count?: number | null
          previous_sentiment_score?: number | null
          radius_km?: number | null
          sample_mentions?: Json | null
          sentiment_score?: number | null
          sentiment_volatility?: number | null
          source_breakdown?: Json | null
          top_keywords?: string[] | null
          trend_direction?: string | null
          trend_velocity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sentiment_tracking_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "internal_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentiment_tracking_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentiment_tracking_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_correlation_groups: {
        Row: {
          avg_confidence: number | null
          category: string | null
          created_at: string
          id: string
          location: string | null
          normalized_text: string | null
          primary_signal_id: string
          severity: string | null
          signal_count: number | null
          sources_json: Json | null
          updated_at: string
        }
        Insert: {
          avg_confidence?: number | null
          category?: string | null
          created_at?: string
          id?: string
          location?: string | null
          normalized_text?: string | null
          primary_signal_id: string
          severity?: string | null
          signal_count?: number | null
          sources_json?: Json | null
          updated_at?: string
        }
        Update: {
          avg_confidence?: number | null
          category?: string | null
          created_at?: string
          id?: string
          location?: string | null
          normalized_text?: string | null
          primary_signal_id?: string
          severity?: string | null
          signal_count?: number | null
          sources_json?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_correlation_groups_primary_signal_id_fkey"
            columns: ["primary_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_documents: {
        Row: {
          created_at: string | null
          document_id: string
          signal_id: string
        }
        Insert: {
          created_at?: string | null
          document_id: string
          signal_id: string
        }
        Update: {
          created_at?: string | null
          document_id?: string
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ingested_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_documents_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_merge_proposals: {
        Row: {
          created_at: string
          duplicate_signal_ids: string[]
          id: string
          merge_rationale: string | null
          primary_signal_id: string
          proposed_at: string
          proposed_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          similarity_scores: number[] | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duplicate_signal_ids: string[]
          id?: string
          merge_rationale?: string | null
          primary_signal_id: string
          proposed_at?: string
          proposed_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity_scores?: number[] | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duplicate_signal_ids?: string[]
          id?: string
          merge_rationale?: string | null
          primary_signal_id?: string
          proposed_at?: string
          proposed_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity_scores?: number[] | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_merge_proposals_primary_signal_id_fkey"
            columns: ["primary_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          applied_rules: Json | null
          auto_correlated_entities: string[] | null
          category: string | null
          client_id: string | null
          confidence: number | null
          content_hash: string | null
          correlated_count: number | null
          correlation_confidence: number | null
          correlation_group_id: string | null
          created_at: string
          description: string | null
          entity_tags: string[] | null
          id: string
          is_primary_signal: boolean | null
          is_read: boolean | null
          is_test: boolean | null
          location: string | null
          momentum: number | null
          normalized_text: string | null
          proximity: number | null
          raw_json: Json | null
          received_at: string
          relevance_score: number | null
          routed_to_team: string | null
          rule_category: string | null
          rule_priority: string | null
          rule_tags: string[] | null
          severity: string | null
          severity_score: number | null
          signal_type: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["signal_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          applied_rules?: Json | null
          auto_correlated_entities?: string[] | null
          category?: string | null
          client_id?: string | null
          confidence?: number | null
          content_hash?: string | null
          correlated_count?: number | null
          correlation_confidence?: number | null
          correlation_group_id?: string | null
          created_at?: string
          description?: string | null
          entity_tags?: string[] | null
          id?: string
          is_primary_signal?: boolean | null
          is_read?: boolean | null
          is_test?: boolean | null
          location?: string | null
          momentum?: number | null
          normalized_text?: string | null
          proximity?: number | null
          raw_json?: Json | null
          received_at?: string
          relevance_score?: number | null
          routed_to_team?: string | null
          rule_category?: string | null
          rule_priority?: string | null
          rule_tags?: string[] | null
          severity?: string | null
          severity_score?: number | null
          signal_type?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          applied_rules?: Json | null
          auto_correlated_entities?: string[] | null
          category?: string | null
          client_id?: string | null
          confidence?: number | null
          content_hash?: string | null
          correlated_count?: number | null
          correlation_confidence?: number | null
          correlation_group_id?: string | null
          created_at?: string
          description?: string | null
          entity_tags?: string[] | null
          id?: string
          is_primary_signal?: boolean | null
          is_read?: boolean | null
          is_test?: boolean | null
          location?: string | null
          momentum?: number | null
          normalized_text?: string | null
          proximity?: number | null
          raw_json?: Json | null
          received_at?: string
          relevance_score?: number | null
          routed_to_team?: string | null
          rule_category?: string | null
          rule_priority?: string | null
          rule_tags?: string[] | null
          severity?: string | null
          severity_score?: number | null
          signal_type?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_correlation_group_id_fkey"
            columns: ["correlation_group_id"]
            isOneToOne: false
            referencedRelation: "signal_correlation_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      source_reliability_metrics: {
        Row: {
          accurate_signals: number | null
          created_at: string
          false_positives: number | null
          id: string
          last_updated: string
          reliability_score: number | null
          source_id: string | null
          source_name: string
          total_signals: number | null
        }
        Insert: {
          accurate_signals?: number | null
          created_at?: string
          false_positives?: number | null
          id?: string
          last_updated?: string
          reliability_score?: number | null
          source_id?: string | null
          source_name: string
          total_signals?: number | null
        }
        Update: {
          accurate_signals?: number | null
          created_at?: string
          false_positives?: number | null
          id?: string
          last_updated?: string
          reliability_score?: number | null
          source_id?: string | null
          source_name?: string
          total_signals?: number | null
        }
        Relationships: []
      }
      sources: {
        Row: {
          config: Json | null
          created_at: string | null
          error_message: string | null
          id: string
          last_ingested_at: string | null
          monitor_type: string | null
          name: string
          status: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_ingested_at?: string | null
          monitor_type?: string | null
          name: string
          status?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_ingested_at?: string | null
          monitor_type?: string | null
          name?: string
          status?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      task_force_agents: {
        Row: {
          agent_id: string
          assigned_tasks: string[] | null
          created_at: string
          id: string
          mission_id: string
          role: Database["public"]["Enums"]["task_force_role"]
          status: string | null
        }
        Insert: {
          agent_id: string
          assigned_tasks?: string[] | null
          created_at?: string
          id?: string
          mission_id: string
          role: Database["public"]["Enums"]["task_force_role"]
          status?: string | null
        }
        Update: {
          agent_id?: string
          assigned_tasks?: string[] | null
          created_at?: string
          id?: string
          mission_id?: string
          role?: Database["public"]["Enums"]["task_force_role"]
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_force_agents_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_force_agents_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "task_force_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      task_force_contributions: {
        Row: {
          agent_id: string
          assumptions: string[] | null
          confidence_score: number | null
          content: string
          content_type: string | null
          created_at: string
          evidence_level: string | null
          id: string
          is_included_in_final: boolean | null
          mission_id: string
          next_validation_steps: string[] | null
          phase: Database["public"]["Enums"]["mission_phase"]
          role: Database["public"]["Enums"]["task_force_role"]
          sources: string[] | null
          unknowns: string[] | null
          validation_errors: string[] | null
          validation_status:
            | Database["public"]["Enums"]["validation_status"]
            | null
        }
        Insert: {
          agent_id: string
          assumptions?: string[] | null
          confidence_score?: number | null
          content: string
          content_type?: string | null
          created_at?: string
          evidence_level?: string | null
          id?: string
          is_included_in_final?: boolean | null
          mission_id: string
          next_validation_steps?: string[] | null
          phase: Database["public"]["Enums"]["mission_phase"]
          role: Database["public"]["Enums"]["task_force_role"]
          sources?: string[] | null
          unknowns?: string[] | null
          validation_errors?: string[] | null
          validation_status?:
            | Database["public"]["Enums"]["validation_status"]
            | null
        }
        Update: {
          agent_id?: string
          assumptions?: string[] | null
          confidence_score?: number | null
          content?: string
          content_type?: string | null
          created_at?: string
          evidence_level?: string | null
          id?: string
          is_included_in_final?: boolean | null
          mission_id?: string
          next_validation_steps?: string[] | null
          phase?: Database["public"]["Enums"]["mission_phase"]
          role?: Database["public"]["Enums"]["task_force_role"]
          sources?: string[] | null
          unknowns?: string[] | null
          validation_errors?: string[] | null
          validation_status?:
            | Database["public"]["Enums"]["validation_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "task_force_contributions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_force_contributions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "task_force_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      task_force_missions: {
        Row: {
          assumptions: string[] | null
          audience: string | null
          client_id: string | null
          commanders_intent: string | null
          completed_at: string | null
          constraints: string | null
          created_at: string
          created_by: string | null
          data_sources: string[] | null
          description: string | null
          desired_outcome: string | null
          end_state: string | null
          final_output: string | null
          final_output_metadata: Json | null
          id: string
          is_stealth_mode: boolean | null
          mission_type: Database["public"]["Enums"]["mission_type"]
          name: string
          next_actions: Json | null
          phase: Database["public"]["Enums"]["mission_phase"]
          priority: string
          roe_id: string | null
          roe_override: Json | null
          rules_of_engagement: Json | null
          started_at: string | null
          task_breakdown: Json | null
          time_horizon: string | null
          updated_at: string
          validation_errors: string[] | null
          validation_status:
            | Database["public"]["Enums"]["validation_status"]
            | null
        }
        Insert: {
          assumptions?: string[] | null
          audience?: string | null
          client_id?: string | null
          commanders_intent?: string | null
          completed_at?: string | null
          constraints?: string | null
          created_at?: string
          created_by?: string | null
          data_sources?: string[] | null
          description?: string | null
          desired_outcome?: string | null
          end_state?: string | null
          final_output?: string | null
          final_output_metadata?: Json | null
          id?: string
          is_stealth_mode?: boolean | null
          mission_type?: Database["public"]["Enums"]["mission_type"]
          name: string
          next_actions?: Json | null
          phase?: Database["public"]["Enums"]["mission_phase"]
          priority?: string
          roe_id?: string | null
          roe_override?: Json | null
          rules_of_engagement?: Json | null
          started_at?: string | null
          task_breakdown?: Json | null
          time_horizon?: string | null
          updated_at?: string
          validation_errors?: string[] | null
          validation_status?:
            | Database["public"]["Enums"]["validation_status"]
            | null
        }
        Update: {
          assumptions?: string[] | null
          audience?: string | null
          client_id?: string | null
          commanders_intent?: string | null
          completed_at?: string | null
          constraints?: string | null
          created_at?: string
          created_by?: string | null
          data_sources?: string[] | null
          description?: string | null
          desired_outcome?: string | null
          end_state?: string | null
          final_output?: string | null
          final_output_metadata?: Json | null
          id?: string
          is_stealth_mode?: boolean | null
          mission_type?: Database["public"]["Enums"]["mission_type"]
          name?: string
          next_actions?: Json | null
          phase?: Database["public"]["Enums"]["mission_phase"]
          priority?: string
          roe_id?: string | null
          roe_override?: Json | null
          rules_of_engagement?: Json | null
          started_at?: string | null
          task_breakdown?: Json | null
          time_horizon?: string | null
          updated_at?: string
          validation_errors?: string[] | null
          validation_status?:
            | Database["public"]["Enums"]["validation_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "task_force_missions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_force_missions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_force_missions_roe_id_fkey"
            columns: ["roe_id"]
            isOneToOne: false
            referencedRelation: "rules_of_engagement"
            referencedColumns: ["id"]
          },
        ]
      }
      threat_precursor_indicators: {
        Row: {
          activity_trend: string | null
          client_id: string | null
          confidence_score: number | null
          created_at: string
          description: string | null
          first_detected_at: string
          geo_coordinates: unknown
          geo_location: string | null
          id: string
          indicator_name: string
          indicator_type: string
          is_validated: boolean | null
          last_activity_at: string | null
          occurrence_count: number | null
          severity_level: string | null
          source_entities: string[] | null
          source_signals: string[] | null
          source_type: string | null
          status: string | null
          target_type: string | null
          threat_category: string | null
          updated_at: string
          urgency_level: string | null
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          activity_trend?: string | null
          client_id?: string | null
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          first_detected_at?: string
          geo_coordinates?: unknown
          geo_location?: string | null
          id?: string
          indicator_name: string
          indicator_type: string
          is_validated?: boolean | null
          last_activity_at?: string | null
          occurrence_count?: number | null
          severity_level?: string | null
          source_entities?: string[] | null
          source_signals?: string[] | null
          source_type?: string | null
          status?: string | null
          target_type?: string | null
          threat_category?: string | null
          updated_at?: string
          urgency_level?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          activity_trend?: string | null
          client_id?: string | null
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          first_detected_at?: string
          geo_coordinates?: unknown
          geo_location?: string | null
          id?: string
          indicator_name?: string
          indicator_type?: string
          is_validated?: boolean | null
          last_activity_at?: string | null
          occurrence_count?: number | null
          severity_level?: string | null
          source_entities?: string[] | null
          source_signals?: string[] | null
          source_type?: string | null
          status?: string | null
          target_type?: string | null
          threat_category?: string | null
          updated_at?: string
          urgency_level?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "threat_precursor_indicators_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threat_precursor_indicators_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      threat_radar_snapshots: {
        Row: {
          ai_analysis_summary: string | null
          client_id: string | null
          created_at: string
          critical_assets_at_risk: string[] | null
          data_sources: string[] | null
          expires_at: string | null
          id: string
          infrastructure_risk_score: number | null
          key_indicators: Json | null
          overall_threat_level: string
          precursor_activity_score: number | null
          precursor_patterns_detected: number | null
          predicted_escalation_probability: number | null
          predicted_timeline_hours: number | null
          radical_activity_score: number | null
          radical_mentions_count: number | null
          recommended_actions: Json | null
          sentiment_shift_detected: boolean | null
          sentiment_volatility_score: number | null
          snapshot_type: string
          threat_score: number
        }
        Insert: {
          ai_analysis_summary?: string | null
          client_id?: string | null
          created_at?: string
          critical_assets_at_risk?: string[] | null
          data_sources?: string[] | null
          expires_at?: string | null
          id?: string
          infrastructure_risk_score?: number | null
          key_indicators?: Json | null
          overall_threat_level?: string
          precursor_activity_score?: number | null
          precursor_patterns_detected?: number | null
          predicted_escalation_probability?: number | null
          predicted_timeline_hours?: number | null
          radical_activity_score?: number | null
          radical_mentions_count?: number | null
          recommended_actions?: Json | null
          sentiment_shift_detected?: boolean | null
          sentiment_volatility_score?: number | null
          snapshot_type?: string
          threat_score?: number
        }
        Update: {
          ai_analysis_summary?: string | null
          client_id?: string | null
          created_at?: string
          critical_assets_at_risk?: string[] | null
          data_sources?: string[] | null
          expires_at?: string | null
          id?: string
          infrastructure_risk_score?: number | null
          key_indicators?: Json | null
          overall_threat_level?: string
          precursor_activity_score?: number | null
          precursor_patterns_detected?: number | null
          predicted_escalation_probability?: number | null
          predicted_timeline_hours?: number | null
          radical_activity_score?: number | null
          radical_mentions_count?: number | null
          recommended_actions?: Json | null
          sentiment_shift_detected?: boolean | null
          sentiment_volatility_score?: number | null
          snapshot_type?: string
          threat_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "threat_radar_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_alerts: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          affected_flights: string[] | null
          alert_type: string
          created_at: string
          description: string
          id: string
          is_active: boolean | null
          itinerary_id: string | null
          location: string | null
          recommended_actions: string[] | null
          severity: string
          source: string | null
          title: string
          traveler_id: string | null
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          affected_flights?: string[] | null
          alert_type: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean | null
          itinerary_id?: string | null
          location?: string | null
          recommended_actions?: string[] | null
          severity?: string
          source?: string | null
          title: string
          traveler_id?: string | null
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          affected_flights?: string[] | null
          alert_type?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean | null
          itinerary_id?: string | null
          location?: string | null
          recommended_actions?: string[] | null
          severity?: string
          source?: string | null
          title?: string
          traveler_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "travel_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_alerts_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_alerts_traveler_id_fkey"
            columns: ["traveler_id"]
            isOneToOne: false
            referencedRelation: "travelers"
            referencedColumns: ["id"]
          },
        ]
      }
      travelers: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          current_country: string | null
          current_location: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          id: string
          last_location_update: string | null
          map_color: string
          name: string
          notes: string | null
          passport_expiry: string | null
          passport_number: string | null
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          current_country?: string | null
          current_location?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          id?: string
          last_location_update?: string | null
          map_color?: string
          name: string
          notes?: string | null
          passport_expiry?: string | null
          passport_number?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          current_country?: string | null
          current_location?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          id?: string
          last_location_update?: string | null
          map_color?: string
          name?: string
          notes?: string | null
          passport_expiry?: string | null
          passport_number?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "travelers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travelers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          communication_style: string | null
          created_at: string
          custom_preferences: Json | null
          id: string
          language_preference: string | null
          preferred_format: string | null
          role_context: string | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          communication_style?: string | null
          created_at?: string
          custom_preferences?: Json | null
          id?: string
          language_preference?: string | null
          preferred_format?: string | null
          role_context?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          communication_style?: string | null
          created_at?: string
          custom_preferences?: Json | null
          id?: string
          language_preference?: string | null
          preferred_format?: string | null
          role_context?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_project_context: {
        Row: {
          client_id: string | null
          created_at: string
          current_status: string | null
          id: string
          key_details: Json | null
          last_mentioned_at: string | null
          priority: string | null
          project_description: string | null
          project_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          current_status?: string | null
          id?: string
          key_details?: Json | null
          last_mentioned_at?: string | null
          priority?: string | null
          project_description?: string | null
          project_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          current_status?: string | null
          id?: string
          key_details?: Json | null
          last_mentioned_at?: string | null
          priority?: string | null
          project_description?: string | null
          project_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_project_context_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          delivered_at: string | null
          error_message: string | null
          id: string
          max_attempts: number
          next_retry_at: string | null
          payload: Json
          response_body: string | null
          response_status_code: number | null
          status: string
          trigger_event: string
          webhook_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          max_attempts?: number
          next_retry_at?: string | null
          payload: Json
          response_body?: string | null
          response_status_code?: number | null
          status?: string
          trigger_event: string
          webhook_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json
          response_body?: string | null
          response_status_code?: number | null
          status?: string
          trigger_event?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          auth_credentials: Json | null
          auth_type: string | null
          created_at: string
          created_by: string | null
          description: string | null
          filter_conditions: Json | null
          id: string
          is_active: boolean
          last_triggered_at: string | null
          name: string
          output_format: string
          secret: string | null
          trigger_events: string[]
          updated_at: string
          url: string
        }
        Insert: {
          auth_credentials?: Json | null
          auth_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          filter_conditions?: Json | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name: string
          output_format?: string
          secret?: string | null
          trigger_events?: string[]
          updated_at?: string
          url: string
        }
        Update: {
          auth_credentials?: Json | null
          auth_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          filter_conditions?: Json | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name?: string
          output_format?: string
          secret?: string | null
          trigger_events?: string[]
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_signal_hash: { Args: { text_content: string }; Returns: string }
      cleanup_processing_queue: { Args: never; Returns: number }
      enqueue_signal_processing: {
        Args: { priority_level?: number; signal_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      restore_ai_messages: {
        Args: { message_ids: string[] }
        Returns: undefined
      }
      set_current_client: {
        Args: { client_id_param: string }
        Returns: undefined
      }
    }
    Enums: {
      alert_status: "pending" | "sent" | "delivered" | "failed" | "acknowledged"
      app_role: "admin" | "analyst" | "viewer" | "super_admin"
      asset_type:
        | "server"
        | "database"
        | "network_device"
        | "application"
        | "cloud_resource"
        | "ot_device"
        | "workstation"
        | "container"
        | "iot_device"
        | "virtual_machine"
      business_criticality_level: "mission_critical" | "high" | "medium" | "low"
      entity_type:
        | "person"
        | "organization"
        | "location"
        | "infrastructure"
        | "domain"
        | "ip_address"
        | "email"
        | "phone"
        | "vehicle"
        | "other"
      improvement_type: "shot" | "brick"
      incident_priority: "p1" | "p2" | "p3" | "p4"
      incident_status:
        | "open"
        | "acknowledged"
        | "contained"
        | "resolved"
        | "closed"
      mission_phase:
        | "intake"
        | "briefing"
        | "execution"
        | "synthesis"
        | "completed"
        | "cancelled"
      mission_type:
        | "risk_snapshot"
        | "incident_response"
        | "site_assessment"
        | "executive_brief"
        | "client_onboarding"
        | "threat_assessment"
        | "custom"
      remediation_status:
        | "patch_available"
        | "patch_pending"
        | "mitigated"
        | "patched"
        | "accepted_risk"
        | "investigating"
        | "no_fix_available"
      roe_audience: "INTERNAL" | "CLIENT"
      roe_classification: "PUBLIC" | "CONFIDENTIAL" | "RESTRICTED"
      roe_mode: "STRICT" | "STANDARD"
      signal_status:
        | "new"
        | "triaged"
        | "investigating"
        | "resolved"
        | "false_positive"
      task_force_role:
        | "leader"
        | "intelligence_analyst"
        | "operations_officer"
        | "client_liaison"
        | "cyber_specialist"
        | "physical_security"
        | "travel_security"
        | "communications"
        | "legal"
      validation_status: "PASS" | "WARN" | "FAIL" | "PENDING"
      vulnerability_severity:
        | "critical"
        | "high"
        | "medium"
        | "low"
        | "informational"
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
  public: {
    Enums: {
      alert_status: ["pending", "sent", "delivered", "failed", "acknowledged"],
      app_role: ["admin", "analyst", "viewer", "super_admin"],
      asset_type: [
        "server",
        "database",
        "network_device",
        "application",
        "cloud_resource",
        "ot_device",
        "workstation",
        "container",
        "iot_device",
        "virtual_machine",
      ],
      business_criticality_level: ["mission_critical", "high", "medium", "low"],
      entity_type: [
        "person",
        "organization",
        "location",
        "infrastructure",
        "domain",
        "ip_address",
        "email",
        "phone",
        "vehicle",
        "other",
      ],
      improvement_type: ["shot", "brick"],
      incident_priority: ["p1", "p2", "p3", "p4"],
      incident_status: [
        "open",
        "acknowledged",
        "contained",
        "resolved",
        "closed",
      ],
      mission_phase: [
        "intake",
        "briefing",
        "execution",
        "synthesis",
        "completed",
        "cancelled",
      ],
      mission_type: [
        "risk_snapshot",
        "incident_response",
        "site_assessment",
        "executive_brief",
        "client_onboarding",
        "threat_assessment",
        "custom",
      ],
      remediation_status: [
        "patch_available",
        "patch_pending",
        "mitigated",
        "patched",
        "accepted_risk",
        "investigating",
        "no_fix_available",
      ],
      roe_audience: ["INTERNAL", "CLIENT"],
      roe_classification: ["PUBLIC", "CONFIDENTIAL", "RESTRICTED"],
      roe_mode: ["STRICT", "STANDARD"],
      signal_status: [
        "new",
        "triaged",
        "investigating",
        "resolved",
        "false_positive",
      ],
      task_force_role: [
        "leader",
        "intelligence_analyst",
        "operations_officer",
        "client_liaison",
        "cyber_specialist",
        "physical_security",
        "travel_security",
        "communications",
        "legal",
      ],
      validation_status: ["PASS", "WARN", "FAIL", "PENDING"],
      vulnerability_severity: [
        "critical",
        "high",
        "medium",
        "low",
        "informational",
      ],
    },
  },
} as const

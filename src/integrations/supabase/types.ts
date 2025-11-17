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
      clients: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          employee_count: number | null
          high_value_assets: string[] | null
          id: string
          industry: string | null
          locations: string[] | null
          name: string
          onboarding_data: Json | null
          organization: string | null
          risk_assessment: Json | null
          status: string
          threat_profile: Json | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          employee_count?: number | null
          high_value_assets?: string[] | null
          id?: string
          industry?: string | null
          locations?: string[] | null
          name: string
          onboarding_data?: Json | null
          organization?: string | null
          risk_assessment?: Json | null
          status?: string
          threat_profile?: Json | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          employee_count?: number | null
          high_value_assets?: string[] | null
          id?: string
          industry?: string | null
          locations?: string[] | null
          name?: string
          onboarding_data?: Json | null
          organization?: string | null
          risk_assessment?: Json | null
          status?: string
          threat_profile?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      entities: {
        Row: {
          aliases: string[] | null
          associations: string[] | null
          attributes: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          risk_level: string | null
          threat_indicators: string[] | null
          threat_score: number | null
          type: Database["public"]["Enums"]["entity_type"]
          updated_at: string
        }
        Insert: {
          aliases?: string[] | null
          associations?: string[] | null
          attributes?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          risk_level?: string | null
          threat_indicators?: string[] | null
          threat_score?: number | null
          type: Database["public"]["Enums"]["entity_type"]
          updated_at?: string
        }
        Update: {
          aliases?: string[] | null
          associations?: string[] | null
          attributes?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          risk_level?: string | null
          threat_indicators?: string[] | null
          threat_score?: number | null
          type?: Database["public"]["Enums"]["entity_type"]
          updated_at?: string
        }
        Relationships: [
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
      incidents: {
        Row: {
          acknowledged_at: string | null
          client_id: string | null
          contained_at: string | null
          created_at: string
          id: string
          is_read: boolean | null
          is_test: boolean | null
          opened_at: string
          owner_user_id: string | null
          priority: Database["public"]["Enums"]["incident_priority"]
          resolved_at: string | null
          signal_id: string | null
          sla_targets_json: Json | null
          status: Database["public"]["Enums"]["incident_status"]
          timeline_json: Json | null
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          client_id?: string | null
          contained_at?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          is_test?: boolean | null
          opened_at?: string
          owner_user_id?: string | null
          priority?: Database["public"]["Enums"]["incident_priority"]
          resolved_at?: string | null
          signal_id?: string | null
          sla_targets_json?: Json | null
          status?: Database["public"]["Enums"]["incident_status"]
          timeline_json?: Json | null
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          client_id?: string | null
          contained_at?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          is_test?: boolean | null
          opened_at?: string
          owner_user_id?: string | null
          priority?: Database["public"]["Enums"]["incident_priority"]
          resolved_at?: string | null
          signal_id?: string | null
          sla_targets_json?: Json | null
          status?: Database["public"]["Enums"]["incident_status"]
          timeline_json?: Json | null
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
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
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
      signals: {
        Row: {
          category: string | null
          client_id: string | null
          confidence: number | null
          created_at: string
          entity_tags: string[] | null
          id: string
          is_read: boolean | null
          is_test: boolean | null
          location: string | null
          momentum: number | null
          normalized_text: string | null
          proximity: number | null
          raw_json: Json | null
          received_at: string
          severity: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["signal_status"]
          updated_at: string
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          entity_tags?: string[] | null
          id?: string
          is_read?: boolean | null
          is_test?: boolean | null
          location?: string | null
          momentum?: number | null
          normalized_text?: string | null
          proximity?: number | null
          raw_json?: Json | null
          received_at?: string
          severity?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          updated_at?: string
        }
        Update: {
          category?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          entity_tags?: string[] | null
          id?: string
          is_read?: boolean | null
          is_test?: boolean | null
          location?: string | null
          momentum?: number | null
          normalized_text?: string | null
          proximity?: number | null
          raw_json?: Json | null
          received_at?: string
          severity?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
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
            foreignKeyName: "signals_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          config_json: Json | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          config_json?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          config_json?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
    }
    Enums: {
      alert_status: "pending" | "sent" | "delivered" | "failed" | "acknowledged"
      app_role: "admin" | "analyst" | "viewer"
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
      signal_status:
        | "new"
        | "triaged"
        | "investigating"
        | "resolved"
        | "false_positive"
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
      app_role: ["admin", "analyst", "viewer"],
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
      signal_status: [
        "new",
        "triaged",
        "investigating",
        "resolved",
        "false_positive",
      ],
    },
  },
} as const

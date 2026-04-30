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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      academy_agent_scores: {
        Row: {
          agent_call_sign: string
          avg_judgment_delta: number | null
          avg_retention_delta: number | null
          course_id: string | null
          created_at: string | null
          domain: string
          id: string
          last_updated_at: string | null
          learner_count: number | null
          teaching_score: number | null
        }
        Insert: {
          agent_call_sign: string
          avg_judgment_delta?: number | null
          avg_retention_delta?: number | null
          course_id?: string | null
          created_at?: string | null
          domain: string
          id?: string
          last_updated_at?: string | null
          learner_count?: number | null
          teaching_score?: number | null
        }
        Update: {
          agent_call_sign?: string
          avg_judgment_delta?: number | null
          avg_retention_delta?: number | null
          course_id?: string | null
          created_at?: string | null
          domain?: string
          id?: string
          last_updated_at?: string | null
          learner_count?: number | null
          teaching_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_agent_scores_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_assessments: {
        Row: {
          created_at: string
          id: string
          module_id: string
          passing_score: number
          questions: Json
        }
        Insert: {
          created_at?: string
          id?: string
          module_id: string
          passing_score?: number
          questions?: Json
        }
        Update: {
          created_at?: string
          id?: string
          module_id?: string
          passing_score?: number
          questions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "academy_assessments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: true
            referencedRelation: "academy_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_certificates: {
        Row: {
          certificate_id: string | null
          course_id: string
          course_title: string
          id: string
          issued_at: string
          user_id: string
          user_name: string
        }
        Insert: {
          certificate_id?: string | null
          course_id: string
          course_title: string
          id?: string
          issued_at?: string
          user_id: string
          user_name: string
        }
        Update: {
          certificate_id?: string | null
          course_id?: string
          course_title?: string
          id?: string
          issued_at?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_courses: {
        Row: {
          agent_call_sign: string | null
          content_generated_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          difficulty_level: string
          estimated_minutes: number | null
          generation_error: string | null
          generation_status: string
          id: string
          published: boolean | null
          scenario_domain: string | null
          slug: string
          title: string
          topic_cluster: string
          trailer_cloudflare_uid: string | null
          trailer_url: string | null
          updated_at: string
        }
        Insert: {
          agent_call_sign?: string | null
          content_generated_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          difficulty_level?: string
          estimated_minutes?: number | null
          generation_error?: string | null
          generation_status?: string
          id?: string
          published?: boolean | null
          scenario_domain?: string | null
          slug: string
          title: string
          topic_cluster: string
          trailer_cloudflare_uid?: string | null
          trailer_url?: string | null
          updated_at?: string
        }
        Update: {
          agent_call_sign?: string | null
          content_generated_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          difficulty_level?: string
          estimated_minutes?: number | null
          generation_error?: string | null
          generation_status?: string
          id?: string
          published?: boolean | null
          scenario_domain?: string | null
          slug?: string
          title?: string
          topic_cluster?: string
          trailer_cloudflare_uid?: string | null
          trailer_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      academy_credentials: {
        Row: {
          agent_call_sign: string
          course_id: string
          course_title: string
          domain: string
          full_name: string
          id: string
          issued_at: string | null
          judgment_delta: number
          matched_tier: string
          post_score: number
          pre_score: number
          user_id: string
        }
        Insert: {
          agent_call_sign: string
          course_id: string
          course_title: string
          domain: string
          full_name: string
          id?: string
          issued_at?: string | null
          judgment_delta: number
          matched_tier: string
          post_score: number
          pre_score: number
          user_id: string
        }
        Update: {
          agent_call_sign?: string
          course_id?: string
          course_title?: string
          domain?: string
          full_name?: string
          id?: string
          issued_at?: string | null
          judgment_delta?: number
          matched_tier?: string
          post_score?: number
          pre_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_credentials_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_enrollments: {
        Row: {
          completed_at: string | null
          course_id: string
          enrolled_at: string
          id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          course_id: string
          enrolled_at?: string
          id?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string
          enrolled_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_judgment_progress: {
        Row: {
          agent_call_sign: string | null
          course_id: string
          created_at: string | null
          enrolled_at: string | null
          followup_completed_at: string | null
          followup_due_at: string | null
          followup_score: number | null
          id: string
          judgment_delta: number | null
          post_completed_at: string | null
          post_scenario_id: string | null
          post_score: number | null
          pre_completed_at: string | null
          pre_scenario_id: string | null
          pre_score: number | null
          retention_delta: number | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agent_call_sign?: string | null
          course_id: string
          created_at?: string | null
          enrolled_at?: string | null
          followup_completed_at?: string | null
          followup_due_at?: string | null
          followup_score?: number | null
          id?: string
          judgment_delta?: number | null
          post_completed_at?: string | null
          post_scenario_id?: string | null
          post_score?: number | null
          pre_completed_at?: string | null
          pre_scenario_id?: string | null
          pre_score?: number | null
          retention_delta?: number | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agent_call_sign?: string | null
          course_id?: string
          created_at?: string | null
          enrolled_at?: string | null
          followup_completed_at?: string | null
          followup_due_at?: string | null
          followup_score?: number | null
          id?: string
          judgment_delta?: number | null
          post_completed_at?: string | null
          post_scenario_id?: string | null
          post_score?: number | null
          pre_completed_at?: string | null
          pre_scenario_id?: string | null
          pre_score?: number | null
          retention_delta?: number | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_judgment_progress_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_judgment_progress_post_scenario_id_fkey"
            columns: ["post_scenario_id"]
            isOneToOne: false
            referencedRelation: "academy_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_judgment_progress_pre_scenario_id_fkey"
            columns: ["pre_scenario_id"]
            isOneToOne: false
            referencedRelation: "academy_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_learner_profiles: {
        Row: {
          address: string | null
          city: string | null
          confidence_gap: number | null
          confidence_rating: number | null
          country: string | null
          created_at: string | null
          current_status: string | null
          email: string | null
          experience_level: string | null
          full_name: string | null
          id: string
          intake_answers: Json
          matched_agent: string | null
          matched_tier: string | null
          phone: string | null
          primary_domain: string | null
          sector: string | null
          self_reported_role: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          confidence_gap?: number | null
          confidence_rating?: number | null
          country?: string | null
          created_at?: string | null
          current_status?: string | null
          email?: string | null
          experience_level?: string | null
          full_name?: string | null
          id?: string
          intake_answers?: Json
          matched_agent?: string | null
          matched_tier?: string | null
          phone?: string | null
          primary_domain?: string | null
          sector?: string | null
          self_reported_role?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          confidence_gap?: number | null
          confidence_rating?: number | null
          country?: string | null
          created_at?: string | null
          current_status?: string | null
          email?: string | null
          experience_level?: string | null
          full_name?: string | null
          id?: string
          intake_answers?: Json
          matched_agent?: string | null
          matched_tier?: string | null
          phone?: string | null
          primary_domain?: string | null
          sector?: string | null
          self_reported_role?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      academy_modules: {
        Row: {
          cloudflare_uid: string | null
          course_id: string
          created_at: string
          duration_seconds: number | null
          estimated_minutes: number | null
          heygen_video_id: string | null
          id: string
          key_takeaways: string[]
          learning_objectives: string[]
          lesson_script: string
          position: number
          title: string
          video_error: string | null
          video_status: string
          video_url: string | null
        }
        Insert: {
          cloudflare_uid?: string | null
          course_id: string
          created_at?: string
          duration_seconds?: number | null
          estimated_minutes?: number | null
          heygen_video_id?: string | null
          id?: string
          key_takeaways?: string[]
          learning_objectives?: string[]
          lesson_script: string
          position: number
          title: string
          video_error?: string | null
          video_status?: string
          video_url?: string | null
        }
        Update: {
          cloudflare_uid?: string | null
          course_id?: string
          created_at?: string
          duration_seconds?: number | null
          estimated_minutes?: number | null
          heygen_video_id?: string | null
          id?: string
          key_takeaways?: string[]
          learning_objectives?: string[]
          lesson_script?: string
          position?: number
          title?: string
          video_error?: string | null
          video_status?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_progress: {
        Row: {
          assessment_attempts: number
          assessment_completed_at: string | null
          assessment_passed: boolean
          assessment_score: number | null
          course_id: string
          id: string
          lesson_viewed: boolean
          lesson_viewed_at: string | null
          module_id: string
          user_id: string
        }
        Insert: {
          assessment_attempts?: number
          assessment_completed_at?: string | null
          assessment_passed?: boolean
          assessment_score?: number | null
          course_id: string
          id?: string
          lesson_viewed?: boolean
          lesson_viewed_at?: string | null
          module_id: string
          user_id: string
        }
        Update: {
          assessment_attempts?: number
          assessment_completed_at?: string | null
          assessment_passed?: boolean
          assessment_score?: number | null
          course_id?: string
          id?: string
          lesson_viewed?: boolean
          lesson_viewed_at?: string | null
          module_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_progress_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_progress_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "academy_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_responses: {
        Row: {
          base_score: number | null
          completed_at: string | null
          course_id: string
          created_at: string | null
          difficulty_rating: number | null
          id: string
          rationale_dangerous: string | null
          rationale_optimal: string | null
          rationale_score: number | null
          scenario_id: string
          selected_option: string
          stage: string
          time_spent_seconds: number | null
          total_score: number | null
          user_id: string
        }
        Insert: {
          base_score?: number | null
          completed_at?: string | null
          course_id: string
          created_at?: string | null
          difficulty_rating?: number | null
          id?: string
          rationale_dangerous?: string | null
          rationale_optimal?: string | null
          rationale_score?: number | null
          scenario_id: string
          selected_option: string
          stage: string
          time_spent_seconds?: number | null
          total_score?: number | null
          user_id: string
        }
        Update: {
          base_score?: number | null
          completed_at?: string | null
          course_id?: string
          created_at?: string | null
          difficulty_rating?: number | null
          id?: string
          rationale_dangerous?: string | null
          rationale_optimal?: string | null
          rationale_score?: number | null
          scenario_id?: string
          selected_option?: string
          stage?: string
          time_spent_seconds?: number | null
          total_score?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_responses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_responses_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "academy_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_scenarios: {
        Row: {
          agent_call_sign: string
          course_id: string
          created_at: string | null
          difficulty_level: string | null
          domain: string
          generated_at: string | null
          id: string
          most_dangerous_choice: string
          most_dangerous_rationale: string
          optimal_choice: string
          optimal_rationale: string
          option_a: Json
          option_b: Json
          option_c: Json
          option_d: Json
          situation_brief: string
          source_belief_ids: string[] | null
          source_knowledge_ids: string[] | null
          teaching_points: string[] | null
          title: string
          variant_index: number | null
        }
        Insert: {
          agent_call_sign: string
          course_id: string
          created_at?: string | null
          difficulty_level?: string | null
          domain: string
          generated_at?: string | null
          id?: string
          most_dangerous_choice: string
          most_dangerous_rationale: string
          optimal_choice: string
          optimal_rationale: string
          option_a: Json
          option_b: Json
          option_c: Json
          option_d: Json
          situation_brief: string
          source_belief_ids?: string[] | null
          source_knowledge_ids?: string[] | null
          teaching_points?: string[] | null
          title: string
          variant_index?: number | null
        }
        Update: {
          agent_call_sign?: string
          course_id?: string
          created_at?: string | null
          difficulty_level?: string | null
          domain?: string
          generated_at?: string | null
          id?: string
          most_dangerous_choice?: string
          most_dangerous_rationale?: string
          optimal_choice?: string
          optimal_rationale?: string
          option_a?: Json
          option_b?: Json
          option_c?: Json
          option_d?: Json
          situation_brief?: string
          source_belief_ids?: string[] | null
          source_knowledge_ids?: string[] | null
          teaching_points?: string[] | null
          title?: string
          variant_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_scenarios_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_training_sessions: {
        Row: {
          agent_call_sign: string
          completed_at: string | null
          course_id: string
          created_at: string
          domain: string
          id: string
          last_message_at: string | null
          message_count: number
          opening_message: string | null
          phases_visited: string[] | null
          pre_choice: string | null
          pre_is_optimal: boolean | null
          pre_score: number | null
          status: string
          user_id: string
        }
        Insert: {
          agent_call_sign: string
          completed_at?: string | null
          course_id: string
          created_at?: string
          domain: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          opening_message?: string | null
          phases_visited?: string[] | null
          pre_choice?: string | null
          pre_is_optimal?: boolean | null
          pre_score?: number | null
          status?: string
          user_id: string
        }
        Update: {
          agent_call_sign?: string
          completed_at?: string | null
          course_id?: string
          created_at?: string
          domain?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          opening_message?: string | null
          phases_visited?: string[] | null
          pre_choice?: string | null
          pre_is_optimal?: boolean | null
          pre_score?: number | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_accuracy_metrics: {
        Row: {
          accuracy_score: number
          agent_call_sign: string
          category_accuracy: Json
          confidence_calibration: number
          correct_predictions: number
          created_at: string
          id: string
          last_calibrated: string
          strongest_category: string | null
          total_predictions: number
          updated_at: string
          weakest_category: string | null
        }
        Insert: {
          accuracy_score?: number
          agent_call_sign: string
          category_accuracy?: Json
          confidence_calibration?: number
          correct_predictions?: number
          created_at?: string
          id?: string
          last_calibrated?: string
          strongest_category?: string | null
          total_predictions?: number
          updated_at?: string
          weakest_category?: string | null
        }
        Update: {
          accuracy_score?: number
          agent_call_sign?: string
          category_accuracy?: Json
          confidence_calibration?: number
          correct_predictions?: number
          created_at?: string
          id?: string
          last_calibrated?: string
          strongest_category?: string | null
          total_predictions?: number
          updated_at?: string
          weakest_category?: string | null
        }
        Relationships: []
      }
      agent_accuracy_tracking: {
        Row: {
          actual_outcome: string | null
          agent_call_sign: string
          confidence_at_prediction: number | null
          created_at: string
          id: string
          incident_id: string | null
          prediction_type: string
          prediction_value: string
          resolved_at: string | null
          signal_id: string | null
          was_correct: boolean | null
        }
        Insert: {
          actual_outcome?: string | null
          agent_call_sign: string
          confidence_at_prediction?: number | null
          created_at?: string
          id?: string
          incident_id?: string | null
          prediction_type: string
          prediction_value: string
          resolved_at?: string | null
          signal_id?: string | null
          was_correct?: boolean | null
        }
        Update: {
          actual_outcome?: string | null
          agent_call_sign?: string
          confidence_at_prediction?: number | null
          created_at?: string
          id?: string
          incident_id?: string | null
          prediction_type?: string
          prediction_value?: string
          resolved_at?: string | null
          signal_id?: string | null
          was_correct?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_accuracy_tracking_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_accuracy_tracking_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_assessments: {
        Row: {
          agent_id: string | null
          assessed_at: string
          call_sign: string
          codename: string
          goals: Json | null
          id: string
          improvements: Json | null
          parse_error: string | null
          prompt_context: string | null
          raw_response: string | null
          worries: Json | null
        }
        Insert: {
          agent_id?: string | null
          assessed_at?: string
          call_sign: string
          codename: string
          goals?: Json | null
          id?: string
          improvements?: Json | null
          parse_error?: string | null
          prompt_context?: string | null
          raw_response?: string | null
          worries?: Json | null
        }
        Update: {
          agent_id?: string | null
          assessed_at?: string
          call_sign?: string
          codename?: string
          goals?: Json | null
          id?: string
          improvements?: Json | null
          parse_error?: string | null
          prompt_context?: string | null
          raw_response?: string | null
          worries?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_assessments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_beliefs: {
        Row: {
          agent_call_sign: string
          belief_type: string
          client_id: string | null
          confidence: number
          contradicting_entry_ids: string[] | null
          contradiction_note: string | null
          created_at: string | null
          evolution_log: Json | null
          has_contradiction: boolean
          hypothesis: string
          id: string
          is_active: boolean | null
          last_updated_at: string | null
          related_agents: string[] | null
          related_domains: string[] | null
          supporting_entry_ids: string[] | null
        }
        Insert: {
          agent_call_sign: string
          belief_type?: string
          client_id?: string | null
          confidence?: number
          contradicting_entry_ids?: string[] | null
          contradiction_note?: string | null
          created_at?: string | null
          evolution_log?: Json | null
          has_contradiction?: boolean
          hypothesis: string
          id?: string
          is_active?: boolean | null
          last_updated_at?: string | null
          related_agents?: string[] | null
          related_domains?: string[] | null
          supporting_entry_ids?: string[] | null
        }
        Update: {
          agent_call_sign?: string
          belief_type?: string
          client_id?: string | null
          confidence?: number
          contradicting_entry_ids?: string[] | null
          contradiction_note?: string | null
          created_at?: string | null
          evolution_log?: Json | null
          has_contradiction?: boolean
          hypothesis?: string
          id?: string
          is_active?: boolean | null
          last_updated_at?: string | null
          related_agents?: string[] | null
          related_domains?: string[] | null
          supporting_entry_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_beliefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_calibration_scores: {
        Row: {
          brier_score: number | null
          calibration_score: number | null
          call_sign: string
          correct_predictions: number | null
          domain: string
          id: string
          last_evaluated_at: string | null
          last_prediction_at: string | null
          total_predictions: number | null
        }
        Insert: {
          brier_score?: number | null
          calibration_score?: number | null
          call_sign: string
          correct_predictions?: number | null
          domain?: string
          id?: string
          last_evaluated_at?: string | null
          last_prediction_at?: string | null
          total_predictions?: number | null
        }
        Update: {
          brier_score?: number | null
          calibration_score?: number | null
          call_sign?: string
          correct_predictions?: number | null
          domain?: string
          id?: string
          last_evaluated_at?: string | null
          last_prediction_at?: string | null
          total_predictions?: number | null
        }
        Relationships: []
      }
      agent_conversations: {
        Row: {
          agent_id: string
          client_id: string | null
          created_at: string
          id: string
          is_shared: boolean | null
          status: string | null
          tenant_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          client_id?: string | null
          created_at?: string
          id?: string
          is_shared?: boolean | null
          status?: string | null
          tenant_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          client_id?: string | null
          created_at?: string
          id?: string
          is_shared?: boolean | null
          status?: string | null
          tenant_id?: string | null
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
            foreignKeyName: "agent_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      agent_debate_records: {
        Row: {
          consensus_score: number | null
          created_at: string
          debate_type: string
          final_assessment: string | null
          id: string
          incident_id: string | null
          individual_analyses: Json
          judge_agent: string | null
          participating_agents: string[]
          synthesis: Json | null
        }
        Insert: {
          consensus_score?: number | null
          created_at?: string
          debate_type?: string
          final_assessment?: string | null
          id?: string
          incident_id?: string | null
          individual_analyses?: Json
          judge_agent?: string | null
          participating_agents?: string[]
          synthesis?: Json | null
        }
        Update: {
          consensus_score?: number | null
          created_at?: string
          debate_type?: string
          final_assessment?: string | null
          id?: string
          incident_id?: string | null
          individual_analyses?: Json
          judge_agent?: string | null
          participating_agents?: string[]
          synthesis?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_debate_records_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_interviews: {
        Row: {
          agent_codename: string
          agent_id: string
          agent_name: string
          audio_url: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          topic: string | null
          transcript: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_codename: string
          agent_id: string
          agent_name: string
          audio_url?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          topic?: string | null
          transcript?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_codename?: string
          agent_id?: string
          agent_name?: string
          audio_url?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          topic?: string | null
          transcript?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_investigation_memory: {
        Row: {
          agent_call_sign: string
          client_id: string | null
          confidence: number | null
          content: string
          created_at: string
          embedding: string | null
          entities: string[] | null
          expires_at: string | null
          id: string
          incident_id: string | null
          memory_type: string
          tags: string[] | null
        }
        Insert: {
          agent_call_sign: string
          client_id?: string | null
          confidence?: number | null
          content: string
          created_at?: string
          embedding?: string | null
          entities?: string[] | null
          expires_at?: string | null
          id?: string
          incident_id?: string | null
          memory_type?: string
          tags?: string[] | null
        }
        Update: {
          agent_call_sign?: string
          client_id?: string | null
          confidence?: number | null
          content?: string
          created_at?: string
          embedding?: string | null
          entities?: string[] | null
          expires_at?: string | null
          id?: string
          incident_id?: string | null
          memory_type?: string
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_investigation_memory_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_investigation_memory_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_learning_sessions: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          learnings: Json | null
          promoted_to_global: boolean | null
          quality_score: number | null
          session_type: string
          source_count: number | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          learnings?: Json | null
          promoted_to_global?: boolean | null
          quality_score?: number | null
          session_type: string
          source_count?: number | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          learnings?: Json | null
          promoted_to_global?: boolean | null
          quality_score?: number | null
          session_type?: string
          source_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_learning_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_memory: {
        Row: {
          agent_id: string | null
          content: string
          context_tags: string[] | null
          created_at: string
          expires_at: string | null
          id: string
          importance_score: number | null
          memory_type: string
          scope: string
          tenant_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          content: string
          context_tags?: string[] | null
          created_at?: string
          expires_at?: string | null
          id?: string
          importance_score?: number | null
          memory_type: string
          scope: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          content?: string
          context_tags?: string[] | null
          created_at?: string
          expires_at?: string | null
          id?: string
          importance_score?: number | null
          memory_type?: string
          scope?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_memory_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_mesh_messages: {
        Row: {
          client_id: string | null
          content: string
          created_at: string | null
          from_agent: string
          id: string
          is_read: boolean | null
          message_type: string
          read_at: string | null
          related_incident_id: string | null
          related_signal_id: string | null
          relevance_score: number | null
          subject: string
          to_agent: string
        }
        Insert: {
          client_id?: string | null
          content: string
          created_at?: string | null
          from_agent: string
          id?: string
          is_read?: boolean | null
          message_type: string
          read_at?: string | null
          related_incident_id?: string | null
          related_signal_id?: string | null
          relevance_score?: number | null
          subject: string
          to_agent: string
        }
        Update: {
          client_id?: string | null
          content?: string
          created_at?: string | null
          from_agent?: string
          id?: string
          is_read?: boolean | null
          message_type?: string
          read_at?: string | null
          related_incident_id?: string | null
          related_signal_id?: string | null
          relevance_score?: number | null
          subject?: string
          to_agent?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_mesh_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_mesh_messages_related_incident_id_fkey"
            columns: ["related_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_mesh_messages_related_signal_id_fkey"
            columns: ["related_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
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
      agent_missions: {
        Row: {
          assigned_agent: string
          assigned_by: string | null
          client_id: string | null
          created_at: string
          deadline: string | null
          id: string
          objective: string
          progress_log: Json
          reporting_cadence: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_agent: string
          assigned_by?: string | null
          client_id?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          objective: string
          progress_log?: Json
          reporting_cadence?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_agent?: string
          assigned_by?: string | null
          client_id?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          objective?: string
          progress_log?: Json
          reporting_cadence?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_missions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_pending_messages: {
        Row: {
          agent_id: string | null
          created_at: string
          delivered_at: string | null
          dismissed_at: string | null
          id: string
          message: string
          priority: string
          recipient_user_id: string
          sender_user_id: string | null
          tenant_id: string | null
          trigger_event: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          delivered_at?: string | null
          dismissed_at?: string | null
          id?: string
          message: string
          priority?: string
          recipient_user_id: string
          sender_user_id?: string | null
          tenant_id?: string | null
          trigger_event?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          delivered_at?: string | null
          dismissed_at?: string | null
          id?: string
          message?: string
          priority?: string
          recipient_user_id?: string
          sender_user_id?: string | null
          tenant_id?: string | null
          trigger_event?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_pending_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_pending_messages_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_pending_messages_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_pending_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_specialty_embeddings: {
        Row: {
          agent_id: string | null
          call_sign: string
          embedding: string | null
          id: string
          last_embedded_at: string | null
          specialty_text: string | null
        }
        Insert: {
          agent_id?: string | null
          call_sign: string
          embedding?: string | null
          id?: string
          last_embedded_at?: string | null
          specialty_text?: string | null
        }
        Update: {
          agent_id?: string | null
          call_sign?: string
          embedding?: string | null
          id?: string
          last_embedded_at?: string | null
          specialty_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_specialty_embeddings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_world_predictions: {
        Row: {
          agent_call_sign: string
          client_id: string | null
          confidence_probability: number
          confirmation_signal_id: string | null
          confirmed_at: string | null
          created_at: string | null
          domain: string
          expected_by: string | null
          falsifying_conditions: string[] | null
          id: string
          prediction_text: string
          refuted_at: string | null
          related_incident_id: string | null
          related_signal_id: string | null
          status: string
          time_horizon_hours: number | null
          triggering_conditions: string[] | null
          updated_at: string | null
        }
        Insert: {
          agent_call_sign: string
          client_id?: string | null
          confidence_probability: number
          confirmation_signal_id?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          domain: string
          expected_by?: string | null
          falsifying_conditions?: string[] | null
          id?: string
          prediction_text: string
          refuted_at?: string | null
          related_incident_id?: string | null
          related_signal_id?: string | null
          status?: string
          time_horizon_hours?: number | null
          triggering_conditions?: string[] | null
          updated_at?: string | null
        }
        Update: {
          agent_call_sign?: string
          client_id?: string | null
          confidence_probability?: number
          confirmation_signal_id?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          domain?: string
          expected_by?: string | null
          falsifying_conditions?: string[] | null
          id?: string
          prediction_text?: string
          refuted_at?: string | null
          related_incident_id?: string | null
          related_signal_id?: string | null
          status?: string
          time_horizon_hours?: number | null
          triggering_conditions?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_world_predictions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_world_predictions_confirmation_signal_id_fkey"
            columns: ["confirmation_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_world_predictions_related_incident_id_fkey"
            columns: ["related_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_world_predictions_related_signal_id_fkey"
            columns: ["related_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
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
          archived_at: string | null
          archived_memory_extracted: boolean | null
          content: string
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_shared: boolean | null
          role: string
          tenant_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_memory_extracted?: boolean | null
          content: string
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_shared?: boolean | null
          role: string
          tenant_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          archived_memory_extracted?: boolean | null
          content?: string
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_shared?: boolean | null
          role?: string
          tenant_id?: string | null
          title?: string | null
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
      analyst_accuracy_metrics: {
        Row: {
          accuracy_score: number
          accurate_feedback: number
          created_at: string
          id: string
          last_calibrated: string
          total_feedback: number
          updated_at: string
          user_id: string
          weight_multiplier: number
        }
        Insert: {
          accuracy_score?: number
          accurate_feedback?: number
          created_at?: string
          id?: string
          last_calibrated?: string
          total_feedback?: number
          updated_at?: string
          user_id: string
          weight_multiplier?: number
        }
        Update: {
          accuracy_score?: number
          accurate_feedback?: number
          created_at?: string
          id?: string
          last_calibrated?: string
          total_feedback?: number
          updated_at?: string
          user_id?: string
          weight_multiplier?: number
        }
        Relationships: [
          {
            foreignKeyName: "analyst_accuracy_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analyst_preferences: {
        Row: {
          confidence: number
          created_at: string
          id: string
          learned_from: string
          preference_key: string
          preference_type: string
          preference_value: Json
          sample_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          id?: string
          learned_from?: string
          preference_key: string
          preference_type: string
          preference_value?: Json
          sample_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          learned_from?: string
          preference_key?: string
          preference_type?: string
          preference_value?: Json
          sample_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyst_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          processing_status: string | null
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
          processing_status?: string | null
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
          processing_status?: string | null
          storage_path?: string
          summary?: string | null
          tags?: string[] | null
          updated_at?: string
          upload_date?: string
          uploaded_by?: string | null
        }
        Relationships: []
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
      audio_briefings: {
        Row: {
          audio_url: string | null
          chunks_processed: number | null
          content_text: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          source_id: string | null
          source_type: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_url?: string | null
          chunks_processed?: number | null
          content_text?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          source_id?: string | null
          source_type?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_url?: string | null
          chunks_processed?: number | null
          content_text?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          source_id?: string | null
          source_type?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          resource: string
          resource_id: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource: string
          resource_id?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource?: string
          resource_id?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_escalation_rules: {
        Row: {
          actions: Json
          conditions: Json
          cooldown_minutes: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          last_triggered_at: string | null
          name: string
          tenant_id: string | null
          trigger_count: number
          trigger_type: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          conditions?: Json
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name: string
          tenant_id?: string | null
          trigger_count?: number
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          conditions?: Json
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name?: string
          tenant_id?: string | null
          trigger_count?: number
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_escalation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_escalation_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      autonomous_actions_log: {
        Row: {
          action_details: Json
          action_type: string
          created_at: string
          error_message: string | null
          id: string
          result: Json | null
          status: string
          trigger_id: string | null
          trigger_source: string
        }
        Insert: {
          action_details?: Json
          action_type: string
          created_at?: string
          error_message?: string | null
          id?: string
          result?: Json | null
          status?: string
          trigger_id?: string | null
          trigger_source: string
        }
        Update: {
          action_details?: Json
          action_type?: string
          created_at?: string
          error_message?: string | null
          id?: string
          result?: Json | null
          status?: string
          trigger_id?: string | null
          trigger_source?: string
        }
        Relationships: []
      }
      autonomous_scan_results: {
        Row: {
          agent_call_sign: string
          alerts_generated: number | null
          created_at: string
          deleted_at: string | null
          findings: Json
          id: string
          risk_score: number | null
          scan_type: string
          signals_analyzed: number | null
          status: string
        }
        Insert: {
          agent_call_sign: string
          alerts_generated?: number | null
          created_at?: string
          deleted_at?: string | null
          findings?: Json
          id?: string
          risk_score?: number | null
          scan_type: string
          signals_analyzed?: number | null
          status?: string
        }
        Update: {
          agent_call_sign?: string
          alerts_generated?: number | null
          created_at?: string
          deleted_at?: string | null
          findings?: Json
          id?: string
          risk_score?: number | null
          scan_type?: string
          signals_analyzed?: number | null
          status?: string
        }
        Relationships: []
      }
      blocked_terms: {
        Row: {
          category: string
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          is_regex: boolean | null
          severity: string
          term: string
        }
        Insert: {
          category: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          is_regex?: boolean | null
          severity?: string
          term: string
        }
        Update: {
          category?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          is_regex?: boolean | null
          severity?: string
          term?: string
        }
        Relationships: []
      }
      briefing_agenda_items: {
        Row: {
          briefing_id: string
          completed_at: string | null
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          presenter_user_id: string | null
          sort_order: number
          started_at: string | null
          status: string | null
          title: string
        }
        Insert: {
          briefing_id: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          presenter_user_id?: string | null
          sort_order?: number
          started_at?: string | null
          status?: string | null
          title: string
        }
        Update: {
          briefing_id?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          presenter_user_id?: string | null
          sort_order?: number
          started_at?: string | null
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_agenda_items_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_chat_messages: {
        Row: {
          author_agent_id: string | null
          author_user_id: string | null
          briefing_id: string
          content: string
          created_at: string
          id: string
          is_group_question: boolean | null
          mentioned_agent_ids: string[] | null
          message_type: string
          metadata: Json | null
          parent_message_id: string | null
        }
        Insert: {
          author_agent_id?: string | null
          author_user_id?: string | null
          briefing_id: string
          content: string
          created_at?: string
          id?: string
          is_group_question?: boolean | null
          mentioned_agent_ids?: string[] | null
          message_type?: string
          metadata?: Json | null
          parent_message_id?: string | null
        }
        Update: {
          author_agent_id?: string | null
          author_user_id?: string | null
          briefing_id?: string
          content?: string
          created_at?: string
          id?: string
          is_group_question?: boolean | null
          mentioned_agent_ids?: string[] | null
          message_type?: string
          metadata?: Json | null
          parent_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "briefing_chat_messages_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_chat_messages_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefing_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_chat_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "briefing_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_claims: {
        Row: {
          agent_message_id: string | null
          briefing_session_id: string | null
          citation_key: string
          claim_text: string
          claim_type: string
          confidence_level: string
          confidence_rationale: string | null
          created_at: string
          id: string
          is_verified: boolean | null
          provenance: string
          verification_task_id: string | null
        }
        Insert: {
          agent_message_id?: string | null
          briefing_session_id?: string | null
          citation_key: string
          claim_text: string
          claim_type: string
          confidence_level: string
          confidence_rationale?: string | null
          created_at?: string
          id?: string
          is_verified?: boolean | null
          provenance: string
          verification_task_id?: string | null
        }
        Update: {
          agent_message_id?: string | null
          briefing_session_id?: string | null
          citation_key?: string
          claim_text?: string
          claim_type?: string
          confidence_level?: string
          confidence_rationale?: string | null
          created_at?: string
          id?: string
          is_verified?: boolean | null
          provenance?: string
          verification_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "briefing_claims_agent_message_id_fkey"
            columns: ["agent_message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_claims_briefing_session_id_fkey"
            columns: ["briefing_session_id"]
            isOneToOne: false
            referencedRelation: "briefing_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_claims_verification_task_id_fkey"
            columns: ["verification_task_id"]
            isOneToOne: false
            referencedRelation: "verification_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_decisions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          briefing_id: string
          category: string | null
          created_at: string
          decision_maker_agent_id: string | null
          decision_maker_user_id: string | null
          decision_text: string
          id: string
          priority: string | null
          rationale: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          briefing_id: string
          category?: string | null
          created_at?: string
          decision_maker_agent_id?: string | null
          decision_maker_user_id?: string | null
          decision_text: string
          id?: string
          priority?: string | null
          rationale?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          briefing_id?: string
          category?: string | null
          created_at?: string
          decision_maker_agent_id?: string | null
          decision_maker_user_id?: string | null
          decision_text?: string
          id?: string
          priority?: string | null
          rationale?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_decisions_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefing_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_decisions_decision_maker_agent_id_fkey"
            columns: ["decision_maker_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_notes: {
        Row: {
          author_agent_id: string | null
          author_user_id: string | null
          briefing_id: string
          content: string
          created_at: string
          id: string
          is_highlighted: boolean | null
          note_type: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          author_agent_id?: string | null
          author_user_id?: string | null
          briefing_id: string
          content: string
          created_at?: string
          id?: string
          is_highlighted?: boolean | null
          note_type?: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          author_agent_id?: string | null
          author_user_id?: string | null
          briefing_id?: string
          content?: string
          created_at?: string
          id?: string
          is_highlighted?: boolean | null
          note_type?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_notes_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_notes_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_participants: {
        Row: {
          agent_id: string | null
          briefing_id: string
          id: string
          is_active: boolean | null
          joined_at: string
          left_at: string | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          briefing_id: string
          id?: string
          is_active?: boolean | null
          joined_at?: string
          left_at?: string | null
          role?: string | null
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          briefing_id?: string
          id?: string
          is_active?: boolean | null
          joined_at?: string
          left_at?: string | null
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "briefing_participants_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_participants_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_queries: {
        Row: {
          ai_confidence: number | null
          ai_responded_at: string | null
          ai_response: string | null
          asked_by: string
          asking_agent_id: string | null
          created_at: string
          escalated_at: string | null
          escalated_to: string | null
          escalation_status: string | null
          human_responded_at: string | null
          human_responded_by: string | null
          human_response: string | null
          id: string
          mission_id: string
          parent_query_id: string | null
          question: string
          target_agent_id: string | null
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_responded_at?: string | null
          ai_response?: string | null
          asked_by: string
          asking_agent_id?: string | null
          created_at?: string
          escalated_at?: string | null
          escalated_to?: string | null
          escalation_status?: string | null
          human_responded_at?: string | null
          human_responded_by?: string | null
          human_response?: string | null
          id?: string
          mission_id: string
          parent_query_id?: string | null
          question: string
          target_agent_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_responded_at?: string | null
          ai_response?: string | null
          asked_by?: string
          asking_agent_id?: string | null
          created_at?: string
          escalated_at?: string | null
          escalated_to?: string | null
          escalation_status?: string | null
          human_responded_at?: string | null
          human_responded_by?: string | null
          human_response?: string | null
          id?: string
          mission_id?: string
          parent_query_id?: string | null
          question?: string
          target_agent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_queries_asking_agent_id_fkey"
            columns: ["asking_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_queries_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "task_force_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_queries_parent_query_id_fkey"
            columns: ["parent_query_id"]
            isOneToOne: false
            referencedRelation: "briefing_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_queries_target_agent_id_fkey"
            columns: ["target_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_query_sources: {
        Row: {
          agent_attribution: string | null
          created_at: string
          id: string
          query_id: string
          relevance_score: number | null
          source_excerpt: string | null
          source_id: string
          source_title: string | null
          source_type: string
        }
        Insert: {
          agent_attribution?: string | null
          created_at?: string
          id?: string
          query_id: string
          relevance_score?: number | null
          source_excerpt?: string | null
          source_id: string
          source_title?: string | null
          source_type: string
        }
        Update: {
          agent_attribution?: string | null
          created_at?: string
          id?: string
          query_id?: string
          relevance_score?: number | null
          source_excerpt?: string | null
          source_id?: string
          source_title?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_query_sources_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "briefing_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_sessions: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          created_at: string
          created_by: string
          description: string | null
          facilitator_user_id: string | null
          id: string
          incident_id: string | null
          investigation_id: string | null
          meeting_mode: string | null
          scheduled_start: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          facilitator_user_id?: string | null
          id?: string
          incident_id?: string | null
          investigation_id?: string | null
          meeting_mode?: string | null
          scheduled_start?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          facilitator_user_id?: string | null
          id?: string
          incident_id?: string | null
          investigation_id?: string | null
          meeting_mode?: string | null
          scheduled_start?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_sessions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_sessions_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_reports: {
        Row: {
          affects_client_facing: boolean | null
          ai_category: string | null
          ai_diagnosis: string | null
          ai_severity: string | null
          approved_at: string | null
          approved_by: string | null
          assigned_to: string | null
          browser_info: string | null
          conversation_log: Json | null
          created_at: string | null
          deleted_at: string | null
          description: string
          fix_proposal: Json | null
          fix_status: string | null
          fix_verified: boolean | null
          id: string
          implemented_at: string | null
          notification_sent_at: string | null
          page_url: string | null
          reporter_email: string | null
          resolution_notes: string | null
          resolved_at: string | null
          screenshots: string[] | null
          severity: string
          status: string
          test_results: Json | null
          title: string
          triaged_at: string | null
          updated_at: string | null
          user_id: string | null
          verification_status: string | null
          verified_at: string | null
          watchdog_note: string | null
          workflow_stage: string | null
        }
        Insert: {
          affects_client_facing?: boolean | null
          ai_category?: string | null
          ai_diagnosis?: string | null
          ai_severity?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_to?: string | null
          browser_info?: string | null
          conversation_log?: Json | null
          created_at?: string | null
          deleted_at?: string | null
          description: string
          fix_proposal?: Json | null
          fix_status?: string | null
          fix_verified?: boolean | null
          id?: string
          implemented_at?: string | null
          notification_sent_at?: string | null
          page_url?: string | null
          reporter_email?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          screenshots?: string[] | null
          severity: string
          status?: string
          test_results?: Json | null
          title: string
          triaged_at?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_status?: string | null
          verified_at?: string | null
          watchdog_note?: string | null
          workflow_stage?: string | null
        }
        Update: {
          affects_client_facing?: boolean | null
          ai_category?: string | null
          ai_diagnosis?: string | null
          ai_severity?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_to?: string | null
          browser_info?: string | null
          conversation_log?: Json | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string
          fix_proposal?: Json | null
          fix_status?: string | null
          fix_verified?: boolean | null
          id?: string
          implemented_at?: string | null
          notification_sent_at?: string | null
          page_url?: string | null
          reporter_email?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          screenshots?: string[] | null
          severity?: string
          status?: string
          test_results?: Json | null
          title?: string
          triaged_at?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_status?: string | null
          verified_at?: string | null
          watchdog_note?: string | null
          workflow_stage?: string | null
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
      circuit_breaker_state: {
        Row: {
          failure_count: number
          failure_threshold: number
          half_open_at: string | null
          id: string
          last_failure_at: string | null
          last_success_at: string | null
          metadata: Json | null
          opened_at: string | null
          recovery_timeout_ms: number
          service_name: string
          state: string
          success_count: number
          updated_at: string
        }
        Insert: {
          failure_count?: number
          failure_threshold?: number
          half_open_at?: string | null
          id?: string
          last_failure_at?: string | null
          last_success_at?: string | null
          metadata?: Json | null
          opened_at?: string | null
          recovery_timeout_ms?: number
          service_name: string
          state?: string
          success_count?: number
          updated_at?: string
        }
        Update: {
          failure_count?: number
          failure_threshold?: number
          half_open_at?: string | null
          id?: string
          last_failure_at?: string | null
          last_success_at?: string | null
          metadata?: Json | null
          opened_at?: string | null
          recovery_timeout_ms?: number
          service_name?: string
          state?: string
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      claim_sources: {
        Row: {
          claim_id: string
          created_at: string
          id: string
          is_primary_source: boolean | null
          relevance_score: number | null
          source_artifact_id: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          id?: string
          is_primary_source?: boolean | null
          relevance_score?: number | null
          source_artifact_id: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          id?: string
          is_primary_source?: boolean | null
          relevance_score?: number | null
          source_artifact_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_sources_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "briefing_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_sources_source_artifact_id_fkey"
            columns: ["source_artifact_id"]
            isOneToOne: false
            referencedRelation: "source_artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_authorizations: {
        Row: {
          authorized_at: string | null
          client_email: string
          client_name: string
          compliance_id: string | null
          created_at: string
          created_by: string | null
          data_retention_date: string | null
          id: string
          ip_address: string | null
          otp_attempts: number
          otp_code: string
          otp_expires_at: string
          scan_type: string
          scope_summary: string | null
          status: string
          target_name: string
          token: string
          token_expires_at: string
          user_agent: string | null
        }
        Insert: {
          authorized_at?: string | null
          client_email: string
          client_name: string
          compliance_id?: string | null
          created_at?: string
          created_by?: string | null
          data_retention_date?: string | null
          id?: string
          ip_address?: string | null
          otp_attempts?: number
          otp_code: string
          otp_expires_at: string
          scan_type: string
          scope_summary?: string | null
          status?: string
          target_name: string
          token: string
          token_expires_at: string
          user_agent?: string | null
        }
        Update: {
          authorized_at?: string | null
          client_email?: string
          client_name?: string
          compliance_id?: string | null
          created_at?: string
          created_by?: string | null
          data_retention_date?: string | null
          id?: string
          ip_address?: string | null
          otp_attempts?: number
          otp_code?: string
          otp_expires_at?: string
          scan_type?: string
          scope_summary?: string | null
          status?: string
          target_name?: string
          token?: string
          token_expires_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_authorizations_compliance_id_fkey"
            columns: ["compliance_id"]
            isOneToOne: false
            referencedRelation: "investigation_compliance"
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          threat_profile?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      codebase_snapshot: {
        Row: {
          byte_size: number | null
          content: string
          file_path: string
          file_type: string
          function_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          byte_size?: number | null
          content: string
          file_path: string
          file_type: string
          function_name?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          byte_size?: number | null
          content?: string
          file_path?: string
          file_type?: string
          function_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      codebase_snapshots: {
        Row: {
          created_at: string
          file_path: string
          file_size: number | null
          id: string
          sha256: string | null
          snapshotted_at: string
          source_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_path: string
          file_size?: number | null
          id?: string
          sha256?: string | null
          snapshotted_at?: string
          source_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_path?: string
          file_size?: number | null
          id?: string
          sha256?: string | null
          snapshotted_at?: string
          source_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      consortia: {
        Row: {
          charter_document_url: string | null
          classification_default:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          metadata: Json | null
          name: string
          region: string | null
          sector: string | null
          sharing_granularity_default:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          updated_at: string | null
        }
        Insert: {
          charter_document_url?: string | null
          classification_default?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          metadata?: Json | null
          name: string
          region?: string | null
          sector?: string | null
          sharing_granularity_default?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          updated_at?: string | null
        }
        Update: {
          charter_document_url?: string | null
          classification_default?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          metadata?: Json | null
          name?: string
          region?: string | null
          sector?: string | null
          sharing_granularity_default?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consortia_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consortium_audit_log: {
        Row: {
          action: string
          consortium_id: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          consortium_id: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          consortium_id?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consortium_audit_log_consortium_id_fkey"
            columns: ["consortium_id"]
            isOneToOne: false
            referencedRelation: "consortia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consortium_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consortium_members: {
        Row: {
          client_id: string | null
          consortium_id: string
          id: string
          invited_by: string | null
          is_active: boolean | null
          joined_at: string | null
          max_classification:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          nda_signatory: string | null
          nda_signed_at: string | null
          role: Database["public"]["Enums"]["consortium_role"] | null
          sharing_entities:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_incidents:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_investigations:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_signals:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          tenant_id: string | null
        }
        Insert: {
          client_id?: string | null
          consortium_id: string
          id?: string
          invited_by?: string | null
          is_active?: boolean | null
          joined_at?: string | null
          max_classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          nda_signatory?: string | null
          nda_signed_at?: string | null
          role?: Database["public"]["Enums"]["consortium_role"] | null
          sharing_entities?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_incidents?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_investigations?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_signals?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          tenant_id?: string | null
        }
        Update: {
          client_id?: string | null
          consortium_id?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean | null
          joined_at?: string | null
          max_classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          nda_signatory?: string | null
          nda_signed_at?: string | null
          role?: Database["public"]["Enums"]["consortium_role"] | null
          sharing_entities?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_incidents?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_investigations?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          sharing_signals?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consortium_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consortium_members_consortium_id_fkey"
            columns: ["consortium_id"]
            isOneToOne: false
            referencedRelation: "consortia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consortium_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consortium_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      consortium_share_rules: {
        Row: {
          approver_user_id: string | null
          classification:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_member_id: string
          created_at: string | null
          created_by: string | null
          granularity: Database["public"]["Enums"]["sharing_granularity"] | null
          id: string
          is_active: boolean | null
          requires_approval: boolean | null
          trigger_conditions: Json | null
          trigger_type: string
        }
        Insert: {
          approver_user_id?: string | null
          classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_member_id: string
          created_at?: string | null
          created_by?: string | null
          granularity?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          id?: string
          is_active?: boolean | null
          requires_approval?: boolean | null
          trigger_conditions?: Json | null
          trigger_type: string
        }
        Update: {
          approver_user_id?: string | null
          classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_member_id?: string
          created_at?: string | null
          created_by?: string | null
          granularity?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          id?: string
          is_active?: boolean | null
          requires_approval?: boolean | null
          trigger_conditions?: Json | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "consortium_share_rules_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consortium_share_rules_consortium_member_id_fkey"
            columns: ["consortium_member_id"]
            isOneToOne: false
            referencedRelation: "consortium_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consortium_share_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consortium_user_access: {
        Row: {
          can_generate_reports: boolean | null
          can_receive: boolean | null
          can_share: boolean | null
          consortium_member_id: string
          granted_at: string | null
          granted_by: string | null
          id: string
          is_point_of_contact: boolean | null
          user_id: string
        }
        Insert: {
          can_generate_reports?: boolean | null
          can_receive?: boolean | null
          can_share?: boolean | null
          consortium_member_id: string
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_point_of_contact?: boolean | null
          user_id: string
        }
        Update: {
          can_generate_reports?: boolean | null
          can_receive?: boolean | null
          can_share?: boolean | null
          consortium_member_id?: string
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_point_of_contact?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consortium_user_access_consortium_member_id_fkey"
            columns: ["consortium_member_id"]
            isOneToOne: false
            referencedRelation: "consortium_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consortium_user_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consortium_user_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_violations: {
        Row: {
          action_taken: string
          category: string
          content_excerpt: string | null
          content_type: string
          created_at: string | null
          id: string
          matched_pattern: string | null
          matched_term_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          action_taken: string
          category: string
          content_excerpt?: string | null
          content_type: string
          created_at?: string | null
          id?: string
          matched_pattern?: string | null
          matched_term_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          action_taken?: string
          category?: string
          content_excerpt?: string | null
          content_type?: string
          created_at?: string | null
          id?: string
          matched_pattern?: string | null
          matched_term_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_violations_matched_term_id_fkey"
            columns: ["matched_term_id"]
            isOneToOne: false
            referencedRelation: "blocked_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_violations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          {
            foreignKeyName: "conversation_memory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_summaries: {
        Row: {
          conversation_id: string
          created_at: string | null
          first_message_at: string | null
          id: string
          key_facts: Json | null
          last_message_at: string | null
          message_count: number | null
          summary: string
          tenant_id: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          first_message_at?: string | null
          id?: string
          key_facts?: Json | null
          last_message_at?: string | null
          message_count?: number | null
          summary: string
          tenant_id?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          first_message_at?: string | null
          id?: string
          key_facts?: Json | null
          last_message_at?: string | null
          message_count?: number | null
          summary?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_summaries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cop_entity_links: {
        Row: {
          created_at: string
          description: string | null
          discovered_by_agent_id: string | null
          discovered_by_user_id: string | null
          entity_a_id: string
          entity_b_id: string
          evidence_ids: string[] | null
          id: string
          relationship_type: string
          strength: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          discovered_by_agent_id?: string | null
          discovered_by_user_id?: string | null
          entity_a_id: string
          entity_b_id: string
          evidence_ids?: string[] | null
          id?: string
          relationship_type: string
          strength?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          discovered_by_agent_id?: string | null
          discovered_by_user_id?: string | null
          entity_a_id?: string
          entity_b_id?: string
          evidence_ids?: string[] | null
          id?: string
          relationship_type?: string
          strength?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cop_entity_links_discovered_by_agent_id_fkey"
            columns: ["discovered_by_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cop_entity_links_entity_a_id_fkey"
            columns: ["entity_a_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cop_entity_links_entity_b_id_fkey"
            columns: ["entity_b_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cop_entity_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cop_timeline_events: {
        Row: {
          added_by_agent_id: string | null
          added_by_user_id: string | null
          created_at: string
          description: string | null
          event_time: string
          event_type: string | null
          id: string
          metadata: Json | null
          severity: string | null
          source_id: string | null
          source_type: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          added_by_agent_id?: string | null
          added_by_user_id?: string | null
          created_at?: string
          description?: string | null
          event_time: string
          event_type?: string | null
          id?: string
          metadata?: Json | null
          severity?: string | null
          source_id?: string | null
          source_type?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          added_by_agent_id?: string | null
          added_by_user_id?: string | null
          created_at?: string
          description?: string | null
          event_time?: string
          event_type?: string | null
          id?: string
          metadata?: Json | null
          severity?: string | null
          source_id?: string | null
          source_type?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cop_timeline_events_added_by_agent_id_fkey"
            columns: ["added_by_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cop_timeline_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cop_widgets: {
        Row: {
          config: Json | null
          created_at: string
          created_by: string
          height: number | null
          id: string
          is_visible: boolean | null
          position_x: number | null
          position_y: number | null
          title: string
          updated_at: string
          widget_type: string
          width: number | null
          workspace_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          created_by: string
          height?: number | null
          id?: string
          is_visible?: boolean | null
          position_x?: number | null
          position_y?: number | null
          title: string
          updated_at?: string
          widget_type: string
          width?: number | null
          workspace_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          created_by?: string
          height?: number | null
          id?: string
          is_visible?: boolean | null
          position_x?: number | null
          position_y?: number | null
          title?: string
          updated_at?: string
          widget_type?: string
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cop_widgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_heartbeat: {
        Row: {
          completed_at: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          job_name: string
          result_summary: Json | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name: string
          result_summary?: Json | null
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name?: string
          result_summary?: Json | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      cron_job_registry: {
        Row: {
          created_at: string
          description: string | null
          expected_interval_minutes: number
          is_critical: boolean
          job_name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          expected_interval_minutes?: number
          is_critical?: boolean
          job_name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          expected_interval_minutes?: number
          is_critical?: boolean
          job_name?: string
        }
        Relationships: []
      }
      cross_tenant_patterns: {
        Row: {
          affected_tenant_count: number | null
          created_at: string
          first_seen_at: string
          id: string
          is_active: boolean | null
          last_seen_at: string
          metadata: Json | null
          pattern_description: string | null
          pattern_signature: string
          pattern_type: string
          recommended_actions: Json | null
          severity_trend: string | null
          updated_at: string
        }
        Insert: {
          affected_tenant_count?: number | null
          created_at?: string
          first_seen_at?: string
          id?: string
          is_active?: boolean | null
          last_seen_at?: string
          metadata?: Json | null
          pattern_description?: string | null
          pattern_signature: string
          pattern_type: string
          recommended_actions?: Json | null
          severity_trend?: string | null
          updated_at?: string
        }
        Update: {
          affected_tenant_count?: number | null
          created_at?: string
          first_seen_at?: string
          id?: string
          is_active?: boolean | null
          last_seen_at?: string
          metadata?: Json | null
          pattern_description?: string | null
          pattern_signature?: string
          pattern_type?: string
          recommended_actions?: Json | null
          severity_trend?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cyber_sentinel_sweeps: {
        Row: {
          ai_assessment: string | null
          completed_at: string | null
          created_at: string
          findings_count: number
          id: string
          responses_executed: number
          started_at: string
          status: string
          sweep_summary: string | null
          sweep_type: string
          telemetry: Json | null
          threats_detected: number
        }
        Insert: {
          ai_assessment?: string | null
          completed_at?: string | null
          created_at?: string
          findings_count?: number
          id?: string
          responses_executed?: number
          started_at?: string
          status?: string
          sweep_summary?: string | null
          sweep_type?: string
          telemetry?: Json | null
          threats_detected?: number
        }
        Update: {
          ai_assessment?: string | null
          completed_at?: string | null
          created_at?: string
          findings_count?: number
          id?: string
          responses_executed?: number
          started_at?: string
          status?: string
          sweep_summary?: string | null
          sweep_type?: string
          telemetry?: Json | null
          threats_detected?: number
        }
        Relationships: []
      }
      cyber_threat_events: {
        Row: {
          ai_analysis: string | null
          confidence_score: number
          created_at: string
          event_type: string
          id: string
          is_resolved: boolean
          related_event_ids: string[] | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          response_details: Json | null
          response_taken: string
          severity: string
          tenant_id: string | null
          threat_details: Json
          threat_source: Json
          tripwire_id: string | null
          updated_at: string
        }
        Insert: {
          ai_analysis?: string | null
          confidence_score?: number
          created_at?: string
          event_type: string
          id?: string
          is_resolved?: boolean
          related_event_ids?: string[] | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          response_details?: Json | null
          response_taken?: string
          severity?: string
          tenant_id?: string | null
          threat_details?: Json
          threat_source?: Json
          tripwire_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_analysis?: string | null
          confidence_score?: number
          created_at?: string
          event_type?: string
          id?: string
          is_resolved?: boolean
          related_event_ids?: string[] | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          response_details?: Json | null
          response_taken?: string
          severity?: string
          tenant_id?: string | null
          threat_details?: Json
          threat_source?: Json
          tripwire_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cyber_threat_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cyber_threat_events_tripwire_id_fkey"
            columns: ["tripwire_id"]
            isOneToOne: false
            referencedRelation: "cyber_tripwires"
            referencedColumns: ["id"]
          },
        ]
      }
      cyber_tripwires: {
        Row: {
          cooldown_minutes: number
          created_at: string
          created_by: string | null
          description: string | null
          detection_config: Json
          id: string
          is_active: boolean
          name: string
          response_tier: string
          severity: string
          tenant_id: string | null
          tripwire_type: string
          updated_at: string
        }
        Insert: {
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          detection_config?: Json
          id?: string
          is_active?: boolean
          name: string
          response_tier?: string
          severity?: string
          tenant_id?: string | null
          tripwire_type?: string
          updated_at?: string
        }
        Update: {
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          detection_config?: Json
          id?: string
          is_active?: boolean
          name?: string
          response_tier?: string
          severity?: string
          tenant_id?: string | null
          tripwire_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cyber_tripwires_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_letter_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          error_id: string | null
          error_message: string | null
          function_name: string
          id: string
          max_retries: number
          next_retry_at: string | null
          payload: Json
          retry_count: number
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_id?: string | null
          error_message?: string | null
          function_name: string
          id?: string
          max_retries?: number
          next_retry_at?: string | null
          payload?: Json
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_id?: string | null
          error_message?: string | null
          function_name?: string
          id?: string
          max_retries?: number
          next_retry_at?: string | null
          payload?: Json
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dead_letter_queue_error_id_fkey"
            columns: ["error_id"]
            isOneToOne: false
            referencedRelation: "edge_function_errors"
            referencedColumns: ["id"]
          },
        ]
      }
      debate_predictions: {
        Row: {
          call_sign: string
          created_at: string | null
          debate_record_id: string | null
          domain: string | null
          evaluated_at: string | null
          hypothesis: string
          id: string
          outcome: string | null
          outcome_confidence: number | null
          stated_confidence: number | null
        }
        Insert: {
          call_sign: string
          created_at?: string | null
          debate_record_id?: string | null
          domain?: string | null
          evaluated_at?: string | null
          hypothesis: string
          id?: string
          outcome?: string | null
          outcome_confidence?: number | null
          stated_confidence?: number | null
        }
        Update: {
          call_sign?: string
          created_at?: string | null
          debate_record_id?: string | null
          domain?: string | null
          evaluated_at?: string | null
          hypothesis?: string
          id?: string
          outcome?: string | null
          outcome_confidence?: number | null
          stated_confidence?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "debate_predictions_debate_record_id_fkey"
            columns: ["debate_record_id"]
            isOneToOne: false
            referencedRelation: "agent_debate_records"
            referencedColumns: ["id"]
          },
        ]
      }
      doctrine_documents: {
        Row: {
          content: string
          created_at: string
          document_type: string | null
          extracted_text: string | null
          file_name: string | null
          file_path: string | null
          file_size_bytes: number | null
          file_type: string | null
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          document_type?: string | null
          extracted_text?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          document_type?: string | null
          extracted_text?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      doctrine_library: {
        Row: {
          content_text: string | null
          content_type: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          storage_path: string | null
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          content_text?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          storage_path?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          content_text?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          storage_path?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctrine_library_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "document_hashes_archival_document_id_fkey"
            columns: ["archival_document_id"]
            isOneToOne: false
            referencedRelation: "stuck_documents"
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
      edge_function_errors: {
        Row: {
          client_id: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string
          error_stack: string | null
          function_name: string
          id: string
          request_context: Json | null
          resolved_at: string | null
          retry_count: number | null
          severity: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message: string
          error_stack?: string | null
          function_name: string
          id?: string
          request_context?: Json | null
          resolved_at?: string | null
          retry_count?: number | null
          severity?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string
          error_stack?: string | null
          function_name?: string
          id?: string
          request_context?: Json | null
          resolved_at?: string | null
          retry_count?: number | null
          severity?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      entities: {
        Row: {
          active_monitoring_enabled: boolean | null
          address_city: string | null
          address_country: string | null
          address_postal_code: string | null
          address_province: string | null
          address_street: string | null
          ai_assessed_at: string | null
          ai_assessment: Json | null
          aliases: string[] | null
          associations: string[] | null
          attributes: Json | null
          client_id: string | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          current_location: string | null
          deleted_at: string | null
          deletion_reason: string | null
          description: string | null
          entity_status: string | null
          id: string
          is_active: boolean | null
          monitoring_radius_km: number | null
          name: string
          priority_scan_requested_at: string | null
          quality_score: number | null
          risk_level: string | null
          tenant_id: string | null
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
          ai_assessed_at?: string | null
          ai_assessment?: Json | null
          aliases?: string[] | null
          associations?: string[] | null
          attributes?: Json | null
          client_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          current_location?: string | null
          deleted_at?: string | null
          deletion_reason?: string | null
          description?: string | null
          entity_status?: string | null
          id?: string
          is_active?: boolean | null
          monitoring_radius_km?: number | null
          name: string
          priority_scan_requested_at?: string | null
          quality_score?: number | null
          risk_level?: string | null
          tenant_id?: string | null
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
          ai_assessed_at?: string | null
          ai_assessment?: Json | null
          aliases?: string[] | null
          associations?: string[] | null
          attributes?: Json | null
          client_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          current_location?: string | null
          deleted_at?: string | null
          deletion_reason?: string | null
          description?: string | null
          entity_status?: string | null
          id?: string
          is_active?: boolean | null
          monitoring_radius_km?: number | null
          name?: string
          priority_scan_requested_at?: string | null
          quality_score?: number | null
          risk_level?: string | null
          tenant_id?: string | null
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
          {
            foreignKeyName: "entities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          is_primary: boolean | null
          metadata: Json | null
          source: string | null
          source_url: string | null
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
          is_primary?: boolean | null
          metadata?: Json | null
          source?: string | null
          source_url?: string | null
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
          is_primary?: boolean | null
          metadata?: Json | null
          source?: string | null
          source_url?: string | null
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
          ai_assessed_at: string | null
          ai_assessment: Json | null
          ai_risk_level: string | null
          ai_threat_score: number | null
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
          ai_assessed_at?: string | null
          ai_assessment?: Json | null
          ai_risk_level?: string | null
          ai_threat_score?: number | null
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
          ai_assessed_at?: string | null
          ai_assessment?: Json | null
          ai_risk_level?: string | null
          ai_threat_score?: number | null
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
          {
            foreignKeyName: "entity_suggestions_source_fk"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "archival_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_suggestions_source_fk"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "stuck_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_watch_list: {
        Row: {
          added_by: string
          added_by_type: string
          client_id: string | null
          created_at: string
          entity_id: string | null
          entity_name: string
          expiry_date: string | null
          id: string
          is_active: boolean
          metadata: Json
          reason: string
          severity_boost: number
          updated_at: string
          watch_level: string
        }
        Insert: {
          added_by: string
          added_by_type?: string
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          reason: string
          severity_boost?: number
          updated_at?: string
          watch_level?: string
        }
        Update: {
          added_by?: string
          added_by_type?: string
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          reason?: string
          severity_boost?: number
          updated_at?: string
          watch_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_watch_list_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_watch_list_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      environment_config: {
        Row: {
          allow_untrusted_inputs: boolean | null
          created_at: string | null
          environment_name: string
          id: string
          is_active: boolean | null
          require_evidence: boolean | null
          updated_at: string | null
        }
        Insert: {
          allow_untrusted_inputs?: boolean | null
          created_at?: string | null
          environment_name: string
          id?: string
          is_active?: boolean | null
          require_evidence?: boolean | null
          updated_at?: string | null
        }
        Update: {
          allow_untrusted_inputs?: boolean | null
          created_at?: string | null
          environment_name?: string
          id?: string
          is_active?: boolean | null
          require_evidence?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      episode_arc_appearances: {
        Row: {
          arc_id: string
          created_at: string
          episode_id: string
          id: string
          notes: string | null
          role: string | null
        }
        Insert: {
          arc_id: string
          created_at?: string
          episode_id: string
          id?: string
          notes?: string | null
          role?: string | null
        }
        Update: {
          arc_id?: string
          created_at?: string
          episode_id?: string
          id?: string
          notes?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episode_arc_appearances_arc_id_fkey"
            columns: ["arc_id"]
            isOneToOne: false
            referencedRelation: "episode_arcs"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_arcs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      episode_embeddings: {
        Row: {
          chunk_index: number
          content_text: string
          created_at: string
          embedding: string | null
          episode_id: string
          id: string
          metadata: Json | null
        }
        Insert: {
          chunk_index?: number
          content_text: string
          created_at?: string
          embedding?: string | null
          episode_id: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          chunk_index?: number
          content_text?: string
          created_at?: string
          embedding?: string | null
          episode_id?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      episode_feedback: {
        Row: {
          created_at: string
          episode_id: string
          id: string
          pacing_feedback: string | null
          rating: number
          story_quality_feedback: string | null
          tone_feedback: string | null
          updated_at: string
          user_id: string
          what_didnt_work: string | null
          what_worked: string | null
        }
        Insert: {
          created_at?: string
          episode_id: string
          id?: string
          pacing_feedback?: string | null
          rating: number
          story_quality_feedback?: string | null
          tone_feedback?: string | null
          updated_at?: string
          user_id: string
          what_didnt_work?: string | null
          what_worked?: string | null
        }
        Update: {
          created_at?: string
          episode_id?: string
          id?: string
          pacing_feedback?: string | null
          rating?: number
          story_quality_feedback?: string | null
          tone_feedback?: string | null
          updated_at?: string
          user_id?: string
          what_didnt_work?: string | null
          what_worked?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episode_feedback_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_judgments: {
        Row: {
          created_at: string
          episode_id: string
          id: string
          judge_agent: string | null
          judgment_type: string
          notes: string | null
          pass_fail: boolean | null
          score: number | null
        }
        Insert: {
          created_at?: string
          episode_id: string
          id?: string
          judge_agent?: string | null
          judgment_type: string
          notes?: string | null
          pass_fail?: boolean | null
          score?: number | null
        }
        Update: {
          created_at?: string
          episode_id?: string
          id?: string
          judge_agent?: string | null
          judgment_type?: string
          notes?: string | null
          pass_fail?: boolean | null
          score?: number | null
        }
        Relationships: []
      }
      episodes: {
        Row: {
          audio_url: string | null
          content_length: number
          created_at: string
          episode_number: number
          episode_summary: string | null
          guest_id: string | null
          id: string
          key_stories: string[] | null
          output_mode: string
          people_mentioned: string[] | null
          risk_domains: string[]
          script_content: string | null
          status: string | null
          target_audience: string
          themes: string[] | null
          title: string
          tone_intensity: string
          topic: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_url?: string | null
          content_length?: number
          created_at?: string
          episode_number?: number
          episode_summary?: string | null
          guest_id?: string | null
          id?: string
          key_stories?: string[] | null
          output_mode?: string
          people_mentioned?: string[] | null
          risk_domains?: string[]
          script_content?: string | null
          status?: string | null
          target_audience: string
          themes?: string[] | null
          title: string
          tone_intensity?: string
          topic: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_url?: string | null
          content_length?: number
          created_at?: string
          episode_number?: number
          episode_summary?: string | null
          guest_id?: string | null
          id?: string
          key_stories?: string[] | null
          output_mode?: string
          people_mentioned?: string[] | null
          risk_domains?: string[]
          script_content?: string | null
          status?: string | null
          target_audience?: string
          themes?: string[] | null
          title?: string
          tone_intensity?: string
          topic?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "episodes_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guest_profiles"
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
      executive_tone_rules: {
        Row: {
          category: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          original_phrase: string
          replacement_phrase: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          original_phrase: string
          replacement_phrase: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          original_phrase?: string
          replacement_phrase?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "executive_tone_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_knowledge: {
        Row: {
          applicability_tags: string[] | null
          citation: string | null
          confidence_score: number | null
          content: string
          created_at: string
          domain: string
          embedding: string | null
          expert_name: string | null
          expert_profile_id: string | null
          id: string
          is_active: boolean | null
          knowledge_type: string
          last_validated_at: string | null
          media_type: string | null
          source_id: string | null
          source_type: string | null
          source_url: string | null
          subdomain: string | null
          title: string
          updated_at: string
        }
        Insert: {
          applicability_tags?: string[] | null
          citation?: string | null
          confidence_score?: number | null
          content: string
          created_at?: string
          domain: string
          embedding?: string | null
          expert_name?: string | null
          expert_profile_id?: string | null
          id?: string
          is_active?: boolean | null
          knowledge_type?: string
          last_validated_at?: string | null
          media_type?: string | null
          source_id?: string | null
          source_type?: string | null
          source_url?: string | null
          subdomain?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          applicability_tags?: string[] | null
          citation?: string | null
          confidence_score?: number | null
          content?: string
          created_at?: string
          domain?: string
          embedding?: string | null
          expert_name?: string | null
          expert_profile_id?: string | null
          id?: string
          is_active?: boolean | null
          knowledge_type?: string
          last_validated_at?: string | null
          media_type?: string | null
          source_id?: string | null
          source_type?: string | null
          source_url?: string | null
          subdomain?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_knowledge_expert_profile_id_fkey"
            columns: ["expert_profile_id"]
            isOneToOne: false
            referencedRelation: "expert_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_knowledge_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "world_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_profiles: {
        Row: {
          auto_discovered: boolean | null
          bio: string | null
          created_at: string
          discovered_by_agent: string | null
          expertise_domains: string[] | null
          id: string
          ingestion_count: number | null
          ingestion_topics: string[] | null
          is_active: boolean | null
          last_ingested_at: string | null
          linkedin_url: string | null
          name: string
          notes: string | null
          podcast_name: string | null
          podcast_rss_url: string | null
          relevant_agent_call_signs: string[] | null
          title: string | null
          twitter_handle: string | null
          updated_at: string
          website_url: string | null
          youtube_channel_id: string | null
          youtube_channel_url: string | null
        }
        Insert: {
          auto_discovered?: boolean | null
          bio?: string | null
          created_at?: string
          discovered_by_agent?: string | null
          expertise_domains?: string[] | null
          id?: string
          ingestion_count?: number | null
          ingestion_topics?: string[] | null
          is_active?: boolean | null
          last_ingested_at?: string | null
          linkedin_url?: string | null
          name: string
          notes?: string | null
          podcast_name?: string | null
          podcast_rss_url?: string | null
          relevant_agent_call_signs?: string[] | null
          title?: string | null
          twitter_handle?: string | null
          updated_at?: string
          website_url?: string | null
          youtube_channel_id?: string | null
          youtube_channel_url?: string | null
        }
        Update: {
          auto_discovered?: boolean | null
          bio?: string | null
          created_at?: string
          discovered_by_agent?: string | null
          expertise_domains?: string[] | null
          id?: string
          ingestion_count?: number | null
          ingestion_topics?: string[] | null
          is_active?: boolean | null
          last_ingested_at?: string | null
          linkedin_url?: string | null
          name?: string
          notes?: string | null
          podcast_name?: string | null
          podcast_rss_url?: string | null
          relevant_agent_call_signs?: string[] | null
          title?: string | null
          twitter_handle?: string | null
          updated_at?: string
          website_url?: string | null
          youtube_channel_id?: string | null
          youtube_channel_url?: string | null
        }
        Relationships: []
      }
      false_positive_patterns: {
        Row: {
          category: string | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          last_matched_at: string | null
          match_count: number | null
          pattern_type: string
          pattern_value: string
          reason: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          last_matched_at?: string | null
          match_count?: number | null
          pattern_type?: string
          pattern_value: string
          reason?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          last_matched_at?: string | null
          match_count?: number | null
          pattern_type?: string
          pattern_value?: string
          reason?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "false_positive_patterns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_events: {
        Row: {
          correction: string | null
          created_at: string | null
          feedback: string
          feedback_context: Json | null
          id: string
          notes: string | null
          object_id: string
          object_type: string
          source_function: string | null
          user_id: string | null
        }
        Insert: {
          correction?: string | null
          created_at?: string | null
          feedback: string
          feedback_context?: Json | null
          id?: string
          notes?: string | null
          object_id: string
          object_type: string
          source_function?: string | null
          user_id?: string | null
        }
        Update: {
          correction?: string | null
          created_at?: string | null
          feedback?: string
          feedback_context?: Json | null
          id?: string
          notes?: string | null
          object_id?: string
          object_type?: string
          source_function?: string | null
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
      filtered_signals: {
        Row: {
          client_id: string | null
          filter_reason: string
          filtered_at: string | null
          id: string
          primary_connection: string | null
          raw_text: string | null
          relevance_reason: string | null
          relevance_score: number | null
          source_name: string | null
          source_url: string | null
        }
        Insert: {
          client_id?: string | null
          filter_reason: string
          filtered_at?: string | null
          id?: string
          primary_connection?: string | null
          raw_text?: string | null
          relevance_reason?: string | null
          relevance_score?: number | null
          source_name?: string | null
          source_url?: string | null
        }
        Update: {
          client_id?: string | null
          filter_reason?: string
          filtered_at?: string | null
          id?: string
          primary_connection?: string | null
          raw_text?: string | null
          relevance_reason?: string | null
          relevance_score?: number | null
          source_name?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "filtered_signals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      frontend_errors: {
        Row: {
          component: string | null
          error_type: string
          id: string
          message: string
          metadata: Json | null
          occurred_at: string
          page_path: string | null
          stack: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          component?: string | null
          error_type: string
          id?: string
          message: string
          metadata?: Json | null
          occurred_at?: string
          page_path?: string | null
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          component?: string | null
          error_type?: string
          id?: string
          message?: string
          metadata?: Json | null
          occurred_at?: string
          page_path?: string | null
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      generated_reports: {
        Row: {
          client_id: string | null
          created_at: string
          html_content: string
          id: string
          metadata: Json | null
          pdf_storage_path: string | null
          period_end: string | null
          period_start: string | null
          report_type: string
          title: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          html_content: string
          id?: string
          metadata?: Json | null
          pdf_storage_path?: string | null
          period_end?: string | null
          period_start?: string | null
          report_type: string
          title: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          html_content?: string
          id?: string
          metadata?: Json | null
          pdf_storage_path?: string | null
          period_end?: string | null
          period_start?: string | null
          report_type?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      geospatial_maps: {
        Row: {
          created_at: string
          error_message: string | null
          extracted_assets_count: number | null
          file_size: number | null
          file_type: string | null
          filename: string
          id: string
          processing_status: string | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          extracted_assets_count?: number | null
          file_size?: number | null
          file_type?: string | null
          filename: string
          id?: string
          processing_status?: string | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          extracted_assets_count?: number | null
          file_size?: number | null
          file_type?: string | null
          filename?: string
          id?: string
          processing_status?: string | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      global_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          doc_id: string
          embedding: string | null
          id: string
          metadata: Json | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          doc_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          doc_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "global_chunks_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "global_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      global_docs: {
        Row: {
          content: string | null
          content_hash: string | null
          created_at: string
          created_by: string | null
          embedding_model: string | null
          file_path: string | null
          file_type: string | null
          id: string
          metadata: Json | null
          source_id: string | null
          source_type: string | null
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          embedding_model?: string | null
          file_path?: string | null
          file_type?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string | null
          source_type?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          embedding_model?: string | null
          file_path?: string | null
          file_type?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string | null
          source_type?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      global_learning_insights: {
        Row: {
          category: string | null
          confidence_score: number | null
          created_at: string
          id: string
          insight_content: string
          insight_type: string
          is_active: boolean | null
          last_validated_at: string | null
          metadata: Json | null
          occurrence_count: number | null
          source_tenant_count: number | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          insight_content: string
          insight_type: string
          is_active?: boolean | null
          last_validated_at?: string | null
          metadata?: Json | null
          occurrence_count?: number | null
          source_tenant_count?: number | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          insight_content?: string
          insight_type?: string
          is_active?: boolean | null
          last_validated_at?: string | null
          metadata?: Json | null
          occurrence_count?: number | null
          source_tenant_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      guest_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          expires_at: string
          guest_email: string | null
          guest_name: string
          guest_user_id: string | null
          host_user_id: string
          id: string
          invite_token: string
          status: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          expires_at?: string
          guest_email?: string | null
          guest_name: string
          guest_user_id?: string | null
          host_user_id: string
          id?: string
          invite_token?: string
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          expires_at?: string
          guest_email?: string | null
          guest_name?: string
          guest_user_id?: string | null
          host_user_id?: string
          id?: string
          invite_token?: string
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      guest_profiles: {
        Row: {
          bio: string
          created_at: string
          cta_text: string | null
          cta_url: string | null
          display_name: string
          expertise: string[]
          id: string
          invitation_id: string | null
          name: string
          notable_quotes: string[] | null
          onboarding_completed: boolean | null
          social_links: Json | null
          speaking_style: string | null
          updated_at: string
          user_id: string
          voice_id: string
        }
        Insert: {
          bio: string
          created_at?: string
          cta_text?: string | null
          cta_url?: string | null
          display_name: string
          expertise?: string[]
          id?: string
          invitation_id?: string | null
          name: string
          notable_quotes?: string[] | null
          onboarding_completed?: boolean | null
          social_links?: Json | null
          speaking_style?: string | null
          updated_at?: string
          user_id: string
          voice_id?: string
        }
        Update: {
          bio?: string
          created_at?: string
          cta_text?: string | null
          cta_url?: string | null
          display_name?: string
          expertise?: string[]
          id?: string
          invitation_id?: string | null
          name?: string
          notable_quotes?: string[] | null
          onboarding_completed?: boolean | null
          social_links?: Json | null
          speaking_style?: string | null
          updated_at?: string
          user_id?: string
          voice_id?: string
        }
        Relationships: []
      }
      host_signoffs: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          phrase: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          phrase: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          phrase?: string
          user_id?: string
        }
        Relationships: []
      }
      hypothesis_branches: {
        Row: {
          confirmed_at: string | null
          contradicting_evidence: Json
          created_at: string
          hypothesis: string
          id: string
          missing_evidence: Json
          probability: number
          status: string
          supporting_evidence: Json
          tree_id: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          contradicting_evidence?: Json
          created_at?: string
          hypothesis: string
          id?: string
          missing_evidence?: Json
          probability?: number
          status?: string
          supporting_evidence?: Json
          tree_id: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          contradicting_evidence?: Json
          created_at?: string
          hypothesis?: string
          id?: string
          missing_evidence?: Json
          probability?: number
          status?: string
          supporting_evidence?: Json
          tree_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hypothesis_branches_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "hypothesis_trees"
            referencedColumns: ["id"]
          },
        ]
      }
      hypothesis_trees: {
        Row: {
          agent_call_sign: string
          created_at: string
          id: string
          incident_id: string | null
          question: string
          signal_id: string | null
        }
        Insert: {
          agent_call_sign: string
          created_at?: string
          id?: string
          incident_id?: string | null
          question: string
          signal_id?: string | null
        }
        Update: {
          agent_call_sign?: string
          created_at?: string
          id?: string
          incident_id?: string | null
          question?: string
          signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hypothesis_trees_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hypothesis_trees_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      implicit_feedback_events: {
        Row: {
          created_at: string
          event_type: string
          event_value: number | null
          id: string
          metadata: Json | null
          signal_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          event_value?: number | null
          id?: string
          metadata?: Json | null
          signal_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          event_value?: number | null
          id?: string
          metadata?: Json | null
          signal_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "implicit_feedback_signal_fk"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
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
      incident_audit_log: {
        Row: {
          action: string
          details: Json | null
          id: string
          incident_id: string
          ip_address: string | null
          performed_at: string
          performed_by: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          details?: Json | null
          id?: string
          incident_id: string
          ip_address?: string | null
          performed_at?: string
          performed_by?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          details?: Json | null
          id?: string
          incident_id?: string
          ip_address?: string | null
          performed_at?: string
          performed_by?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      incident_classification_rationale: {
        Row: {
          classification: string
          classified_at: string | null
          classified_by: string | null
          created_at: string | null
          id: string
          incident_id: string | null
          rationale: string
          system_of_origin: string
        }
        Insert: {
          classification: string
          classified_at?: string | null
          classified_by?: string | null
          created_at?: string | null
          id?: string
          incident_id?: string | null
          rationale: string
          system_of_origin: string
        }
        Update: {
          classification?: string
          classified_at?: string | null
          classified_by?: string | null
          created_at?: string | null
          id?: string
          incident_id?: string | null
          rationale?: string
          system_of_origin?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_classification_rationale_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: true
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_creation_failures: {
        Row: {
          attempted_at: string
          attempted_data: Json | null
          client_id: string | null
          failure_reason: string
          id: string
          signal_id: string | null
          source_function: string | null
        }
        Insert: {
          attempted_at?: string
          attempted_data?: Json | null
          client_id?: string | null
          failure_reason: string
          id?: string
          signal_id?: string | null
          source_function?: string | null
        }
        Update: {
          attempted_at?: string
          attempted_data?: Json | null
          client_id?: string | null
          failure_reason?: string
          id?: string
          signal_id?: string | null
          source_function?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_creation_failures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_creation_failures_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
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
      incident_knowledge_graph: {
        Row: {
          created_at: string
          discovered_by: string | null
          evidence: Json | null
          id: string
          relationship_type: string
          source_incident_id: string
          strength: number
          target_incident_id: string
        }
        Insert: {
          created_at?: string
          discovered_by?: string | null
          evidence?: Json | null
          id?: string
          relationship_type: string
          source_incident_id: string
          strength?: number
          target_incident_id: string
        }
        Update: {
          created_at?: string
          discovered_by?: string | null
          evidence?: Json | null
          id?: string
          relationship_type?: string
          source_incident_id?: string
          strength?: number
          target_incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_knowledge_graph_source_incident_id_fkey"
            columns: ["source_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_knowledge_graph_target_incident_id_fkey"
            columns: ["target_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_outcomes: {
        Row: {
          created_at: string
          credibility_updated: boolean | null
          credibility_updated_at: string | null
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
          credibility_updated?: boolean | null
          credibility_updated_at?: string | null
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
          credibility_updated?: boolean | null
          credibility_updated_at?: string | null
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
          closed_at: string | null
          contained_at: string | null
          created_at: string
          created_by_function: string | null
          deleted_at: string | null
          deletion_reason: string | null
          id: string
          incident_type: string | null
          information_accuracy: string | null
          initial_agent_prompt: string | null
          investigation_status: string | null
          is_read: boolean | null
          is_test: boolean | null
          opened_at: string
          outcome_notes: string | null
          outcome_recorded_at: string | null
          outcome_type: string | null
          owner_user_id: string | null
          priority: Database["public"]["Enums"]["incident_priority"]
          provenance_id: string | null
          provenance_summary: string | null
          provenance_type: string | null
          resolved_at: string | null
          severity_level: string | null
          signal_id: string | null
          sla_targets_json: Json | null
          source_reliability: string | null
          status: Database["public"]["Enums"]["incident_status"]
          summary: string | null
          task_force_name: string | null
          tenant_id: string | null
          timeline_json: Json | null
          title: string | null
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          ai_analysis_log?: Json | null
          assigned_agent_ids?: string[] | null
          client_id?: string | null
          closed_at?: string | null
          contained_at?: string | null
          created_at?: string
          created_by_function?: string | null
          deleted_at?: string | null
          deletion_reason?: string | null
          id?: string
          incident_type?: string | null
          information_accuracy?: string | null
          initial_agent_prompt?: string | null
          investigation_status?: string | null
          is_read?: boolean | null
          is_test?: boolean | null
          opened_at?: string
          outcome_notes?: string | null
          outcome_recorded_at?: string | null
          outcome_type?: string | null
          owner_user_id?: string | null
          priority?: Database["public"]["Enums"]["incident_priority"]
          provenance_id?: string | null
          provenance_summary?: string | null
          provenance_type?: string | null
          resolved_at?: string | null
          severity_level?: string | null
          signal_id?: string | null
          sla_targets_json?: Json | null
          source_reliability?: string | null
          status?: Database["public"]["Enums"]["incident_status"]
          summary?: string | null
          task_force_name?: string | null
          tenant_id?: string | null
          timeline_json?: Json | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          ai_analysis_log?: Json | null
          assigned_agent_ids?: string[] | null
          client_id?: string | null
          closed_at?: string | null
          contained_at?: string | null
          created_at?: string
          created_by_function?: string | null
          deleted_at?: string | null
          deletion_reason?: string | null
          id?: string
          incident_type?: string | null
          information_accuracy?: string | null
          initial_agent_prompt?: string | null
          investigation_status?: string | null
          is_read?: boolean | null
          is_test?: boolean | null
          opened_at?: string
          outcome_notes?: string | null
          outcome_recorded_at?: string | null
          outcome_type?: string | null
          owner_user_id?: string | null
          priority?: Database["public"]["Enums"]["incident_priority"]
          provenance_id?: string | null
          provenance_summary?: string | null
          provenance_type?: string | null
          resolved_at?: string | null
          severity_level?: string | null
          signal_id?: string | null
          sla_targets_json?: Json | null
          source_reliability?: string | null
          status?: Database["public"]["Enums"]["incident_status"]
          summary?: string | null
          task_force_name?: string | null
          tenant_id?: string | null
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
          {
            foreignKeyName: "incidents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingested_documents: {
        Row: {
          author_handle: string | null
          author_name: string | null
          chunk_index: number | null
          comments: Json | null
          content_hash: string | null
          created_at: string | null
          engagement_metrics: Json | null
          error_message: string | null
          hashtags: string[] | null
          id: string
          ingested_at: string | null
          media_type: string | null
          media_urls: string[] | null
          mentions: string[] | null
          metadata: Json | null
          parent_document_id: string | null
          post_caption: string | null
          post_date: string | null
          processed_at: string | null
          processing_status: string | null
          raw_text: string | null
          source_id: string | null
          source_url: string | null
          thumbnail_url: string | null
          title: string | null
          total_chunks: number | null
        }
        Insert: {
          author_handle?: string | null
          author_name?: string | null
          chunk_index?: number | null
          comments?: Json | null
          content_hash?: string | null
          created_at?: string | null
          engagement_metrics?: Json | null
          error_message?: string | null
          hashtags?: string[] | null
          id?: string
          ingested_at?: string | null
          media_type?: string | null
          media_urls?: string[] | null
          mentions?: string[] | null
          metadata?: Json | null
          parent_document_id?: string | null
          post_caption?: string | null
          post_date?: string | null
          processed_at?: string | null
          processing_status?: string | null
          raw_text?: string | null
          source_id?: string | null
          source_url?: string | null
          thumbnail_url?: string | null
          title?: string | null
          total_chunks?: number | null
        }
        Update: {
          author_handle?: string | null
          author_name?: string | null
          chunk_index?: number | null
          comments?: Json | null
          content_hash?: string | null
          created_at?: string | null
          engagement_metrics?: Json | null
          error_message?: string | null
          hashtags?: string[] | null
          id?: string
          ingested_at?: string | null
          media_type?: string | null
          media_urls?: string[] | null
          mentions?: string[] | null
          metadata?: Json | null
          parent_document_id?: string | null
          post_caption?: string | null
          post_date?: string | null
          processed_at?: string | null
          processing_status?: string | null
          raw_text?: string | null
          source_id?: string | null
          source_url?: string | null
          thumbnail_url?: string | null
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
      intel_dissemination_log: {
        Row: {
          acknowledged_at: string | null
          delivered_at: string | null
          delivery_method: string
          email_address: string | null
          email_status: string | null
          id: string
          opened_at: string | null
          product_id: string | null
          recipient_member_id: string | null
          recipient_user_id: string | null
          shared_incident_id: string | null
          shared_signal_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          delivered_at?: string | null
          delivery_method: string
          email_address?: string | null
          email_status?: string | null
          id?: string
          opened_at?: string | null
          product_id?: string | null
          recipient_member_id?: string | null
          recipient_user_id?: string | null
          shared_incident_id?: string | null
          shared_signal_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          delivered_at?: string | null
          delivery_method?: string
          email_address?: string | null
          email_status?: string | null
          id?: string
          opened_at?: string | null
          product_id?: string | null
          recipient_member_id?: string | null
          recipient_user_id?: string | null
          shared_incident_id?: string | null
          shared_signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intel_dissemination_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shared_intel_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intel_dissemination_log_recipient_member_id_fkey"
            columns: ["recipient_member_id"]
            isOneToOne: false
            referencedRelation: "consortium_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intel_dissemination_log_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intel_dissemination_log_shared_incident_id_fkey"
            columns: ["shared_incident_id"]
            isOneToOne: false
            referencedRelation: "shared_incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intel_dissemination_log_shared_signal_id_fkey"
            columns: ["shared_signal_id"]
            isOneToOne: false
            referencedRelation: "shared_signals"
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
      interview_sessions: {
        Row: {
          created_at: string
          final_video_url: string | null
          guest_user_id: string
          host_user_id: string
          id: string
          invitation_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          final_video_url?: string | null
          guest_user_id: string
          host_user_id: string
          id?: string
          invitation_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          final_video_url?: string | null
          guest_user_id?: string
          host_user_id?: string
          id?: string
          invitation_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_sessions_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "guest_invitations"
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
      investigation_autopilot_sessions: {
        Row: {
          completed_at: string | null
          completed_tasks: number | null
          created_at: string
          id: string
          initiated_by: string
          investigation_id: string
          key_findings: Json | null
          overall_summary: string | null
          recommendations: Json | null
          risk_score: number | null
          started_at: string | null
          status: string
          task_plan: Json | null
          total_tasks: number | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_tasks?: number | null
          created_at?: string
          id?: string
          initiated_by: string
          investigation_id: string
          key_findings?: Json | null
          overall_summary?: string | null
          recommendations?: Json | null
          risk_score?: number | null
          started_at?: string | null
          status?: string
          task_plan?: Json | null
          total_tasks?: number | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_tasks?: number | null
          created_at?: string
          id?: string
          initiated_by?: string
          investigation_id?: string
          key_findings?: Json | null
          overall_summary?: string | null
          recommendations?: Json | null
          risk_score?: number | null
          started_at?: string | null
          status?: string
          task_plan?: Json | null
          total_tasks?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_autopilot_sessions_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_autopilot_sessions_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_autopilot_tasks: {
        Row: {
          agent_call_sign: string | null
          completed_at: string | null
          confidence_score: number | null
          created_at: string
          duration_ms: number | null
          entities_found: string[] | null
          error_message: string | null
          findings: Json | null
          id: string
          input_context: Json | null
          investigation_id: string
          priority: number
          review_status: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          session_id: string | null
          signals_correlated: string[] | null
          sort_order: number
          started_at: string | null
          status: string
          summary: string | null
          task_label: string
          task_type: string
          updated_at: string
        }
        Insert: {
          agent_call_sign?: string | null
          completed_at?: string | null
          confidence_score?: number | null
          created_at?: string
          duration_ms?: number | null
          entities_found?: string[] | null
          error_message?: string | null
          findings?: Json | null
          id?: string
          input_context?: Json | null
          investigation_id: string
          priority?: number
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          session_id?: string | null
          signals_correlated?: string[] | null
          sort_order?: number
          started_at?: string | null
          status?: string
          summary?: string | null
          task_label: string
          task_type: string
          updated_at?: string
        }
        Update: {
          agent_call_sign?: string | null
          completed_at?: string | null
          confidence_score?: number | null
          created_at?: string
          duration_ms?: number | null
          entities_found?: string[] | null
          error_message?: string | null
          findings?: Json | null
          id?: string
          input_context?: Json | null
          investigation_id?: string
          priority?: number
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          session_id?: string | null
          signals_correlated?: string[] | null
          sort_order?: number
          started_at?: string | null
          status?: string
          summary?: string | null
          task_label?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_autopilot_tasks_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_autopilot_tasks_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_autopilot_tasks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "investigation_autopilot_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_communications: {
        Row: {
          channel: string
          contact_identifier: string
          contact_name: string | null
          created_at: string
          direction: string
          id: string
          investigation_entry_id: string | null
          investigation_id: string
          investigator_user_id: string
          message_body: string
          message_timestamp: string
          platform_number: string | null
          provider_message_id: string | null
          provider_status: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          channel?: string
          contact_identifier: string
          contact_name?: string | null
          created_at?: string
          direction: string
          id?: string
          investigation_entry_id?: string | null
          investigation_id: string
          investigator_user_id: string
          message_body: string
          message_timestamp?: string
          platform_number?: string | null
          provider_message_id?: string | null
          provider_status?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          channel?: string
          contact_identifier?: string
          contact_name?: string | null
          created_at?: string
          direction?: string
          id?: string
          investigation_entry_id?: string | null
          investigation_id?: string
          investigator_user_id?: string
          message_body?: string
          message_timestamp?: string
          platform_number?: string | null
          provider_message_id?: string | null
          provider_status?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_communications_investigation_entry_id_fkey"
            columns: ["investigation_entry_id"]
            isOneToOne: false
            referencedRelation: "investigation_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_communications_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_communications_investigator_user_id_fkey"
            columns: ["investigator_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_communications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_compliance: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          checklist: Json
          created_at: string
          data_retention_date: string | null
          id: string
          jurisdiction: string | null
          legal_basis: string | null
          scan_type: string
          secure_notes: string | null
          target_id: string | null
          target_name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          checklist?: Json
          created_at?: string
          data_retention_date?: string | null
          id?: string
          jurisdiction?: string | null
          legal_basis?: string | null
          scan_type?: string
          secure_notes?: string | null
          target_id?: string | null
          target_name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          checklist?: Json
          created_at?: string
          data_retention_date?: string | null
          id?: string
          jurisdiction?: string | null
          legal_basis?: string | null
          scan_type?: string
          secure_notes?: string | null
          target_id?: string | null
          target_name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      investigation_entries: {
        Row: {
          ai_suggestion_accepted: boolean | null
          ai_suggestion_original: string | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          entry_text: string
          entry_timestamp: string | null
          event_time: string | null
          id: string
          investigation_id: string | null
          is_ai_generated: boolean | null
          updated_at: string | null
        }
        Insert: {
          ai_suggestion_accepted?: boolean | null
          ai_suggestion_original?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          entry_text: string
          entry_timestamp?: string | null
          event_time?: string | null
          id?: string
          investigation_id?: string | null
          is_ai_generated?: boolean | null
          updated_at?: string | null
        }
        Update: {
          ai_suggestion_accepted?: boolean | null
          ai_suggestion_original?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          entry_text?: string
          entry_timestamp?: string | null
          event_time?: string | null
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
          email: string | null
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
          email?: string | null
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
          email?: string | null
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
      investigation_playbooks: {
        Row: {
          countermeasures: Json | null
          created_at: string
          description: string | null
          effectiveness_score: number | null
          id: string
          is_active: boolean
          model_version: string | null
          name: string
          severity_level: string
          source_investigation_ids: string[] | null
          source_type: string
          steps: Json
          success_metrics: Json | null
          tenant_id: string | null
          threat_category: string
          times_used: number
          updated_at: string
        }
        Insert: {
          countermeasures?: Json | null
          created_at?: string
          description?: string | null
          effectiveness_score?: number | null
          id?: string
          is_active?: boolean
          model_version?: string | null
          name: string
          severity_level?: string
          source_investigation_ids?: string[] | null
          source_type?: string
          steps?: Json
          success_metrics?: Json | null
          tenant_id?: string | null
          threat_category: string
          times_used?: number
          updated_at?: string
        }
        Update: {
          countermeasures?: Json | null
          created_at?: string
          description?: string | null
          effectiveness_score?: number | null
          id?: string
          is_active?: boolean
          model_version?: string | null
          name?: string
          severity_level?: string
          source_investigation_ids?: string[] | null
          source_type?: string
          steps?: Json
          success_metrics?: Json | null
          tenant_id?: string | null
          threat_category?: string
          times_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_playbooks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_similarity_cache: {
        Row: {
          created_at: string
          id: string
          investigation_id: string
          similar_investigation_id: string
          similarity_factors: Json | null
          similarity_score: number
        }
        Insert: {
          created_at?: string
          id?: string
          investigation_id: string
          similar_investigation_id: string
          similarity_factors?: Json | null
          similarity_score?: number
        }
        Update: {
          created_at?: string
          id?: string
          investigation_id?: string
          similar_investigation_id?: string
          similarity_factors?: Json | null
          similarity_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "investigation_similarity_cache_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_similarity_cache_similar_investigation_id_fkey"
            columns: ["similar_investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_templates: {
        Row: {
          avg_days_to_close: number | null
          avg_entry_count: number | null
          category: string
          client_id: string | null
          common_entity_types: string[] | null
          common_entry_patterns: string[] | null
          confidence_score: number | null
          created_at: string
          derived_from_count: number | null
          derived_from_ids: string[] | null
          description: string | null
          id: string
          template_name: string
          times_accepted: number | null
          times_used: number | null
          typical_information_structure: string | null
          typical_recommendations: string[] | null
          typical_synopsis_structure: string | null
          updated_at: string
        }
        Insert: {
          avg_days_to_close?: number | null
          avg_entry_count?: number | null
          category?: string
          client_id?: string | null
          common_entity_types?: string[] | null
          common_entry_patterns?: string[] | null
          confidence_score?: number | null
          created_at?: string
          derived_from_count?: number | null
          derived_from_ids?: string[] | null
          description?: string | null
          id?: string
          template_name: string
          times_accepted?: number | null
          times_used?: number | null
          typical_information_structure?: string | null
          typical_recommendations?: string[] | null
          typical_synopsis_structure?: string | null
          updated_at?: string
        }
        Update: {
          avg_days_to_close?: number | null
          avg_entry_count?: number | null
          category?: string
          client_id?: string | null
          common_entity_types?: string[] | null
          common_entry_patterns?: string[] | null
          confidence_score?: number | null
          created_at?: string
          derived_from_count?: number | null
          derived_from_ids?: string[] | null
          description?: string | null
          id?: string
          template_name?: string
          times_accepted?: number | null
          times_used?: number | null
          typical_information_structure?: string | null
          typical_recommendations?: string[] | null
          typical_synopsis_structure?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_threads: {
        Row: {
          client_id: string | null
          confidence: number | null
          created_at: string | null
          domain: string
          id: string
          last_activity_at: string | null
          participating_agents: string[] | null
          primary_agent: string
          related_incident_id: string | null
          resolved_at: string | null
          started_at: string | null
          status: string | null
          thread_name: string
          thread_summary: string | null
          threat_actor: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          confidence?: number | null
          created_at?: string | null
          domain: string
          id?: string
          last_activity_at?: string | null
          participating_agents?: string[] | null
          primary_agent: string
          related_incident_id?: string | null
          resolved_at?: string | null
          started_at?: string | null
          status?: string | null
          thread_name: string
          thread_summary?: string | null
          threat_actor?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          confidence?: number | null
          created_at?: string | null
          domain?: string
          id?: string
          last_activity_at?: string | null
          participating_agents?: string[] | null
          primary_agent?: string
          related_incident_id?: string | null
          resolved_at?: string | null
          started_at?: string | null
          status?: string | null
          thread_name?: string
          thread_summary?: string | null
          threat_actor?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investigation_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_threads_related_incident_id_fkey"
            columns: ["related_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_workspaces: {
        Row: {
          created_at: string
          created_by_user_id: string
          description: string | null
          id: string
          incident_id: string | null
          investigation_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          description?: string | null
          id?: string
          incident_id?: string | null
          investigation_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          description?: string | null
          id?: string
          incident_id?: string | null
          investigation_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_workspaces_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_workspaces_investigation_id_fkey"
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
          intake_email_tag: string | null
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
          intake_email_tag?: string | null
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
          intake_email_tag?: string | null
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
      itinerary_scan_history: {
        Row: {
          alert_count: number
          alerts: Json
          destination_intel_summary: string | null
          flight_status: Json | null
          id: string
          itinerary_id: string
          previous_risk_level: string | null
          risk_changed: boolean
          risk_level: string
          scan_source: string
          scanned_at: string
        }
        Insert: {
          alert_count?: number
          alerts?: Json
          destination_intel_summary?: string | null
          flight_status?: Json | null
          id?: string
          itinerary_id: string
          previous_risk_level?: string | null
          risk_changed?: boolean
          risk_level?: string
          scan_source?: string
          scanned_at?: string
        }
        Update: {
          alert_count?: number
          alerts?: Json
          destination_intel_summary?: string | null
          flight_status?: Json | null
          id?: string
          itinerary_id?: string
          previous_risk_level?: string | null
          risk_changed?: boolean
          risk_level?: string
          scan_source?: string
          scanned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_scan_history_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
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
      knowledge_connections: {
        Row: {
          agents_involved: string[] | null
          connection_strength: number | null
          created_at: string | null
          id: string
          relationship_type: string
          source_entry_id: string | null
          synthesis_note: string
          target_entry_id: string | null
        }
        Insert: {
          agents_involved?: string[] | null
          connection_strength?: number | null
          created_at?: string | null
          id?: string
          relationship_type?: string
          source_entry_id?: string | null
          synthesis_note: string
          target_entry_id?: string | null
        }
        Update: {
          agents_involved?: string[] | null
          connection_strength?: number | null
          created_at?: string | null
          id?: string
          relationship_type?: string
          source_entry_id?: string | null
          synthesis_note?: string
          target_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_connections_source_entry_id_fkey"
            columns: ["source_entry_id"]
            isOneToOne: false
            referencedRelation: "expert_knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_connections_target_entry_id_fkey"
            columns: ["target_entry_id"]
            isOneToOne: false
            referencedRelation: "expert_knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_freshness_audits: {
        Row: {
          actions_taken: Json | null
          audit_date: string
          avg_confidence: number | null
          avg_decayed_confidence: number | null
          created_at: string
          decayed_entries: number
          id: string
          stale_domains: Json | null
          stale_entries: number
          total_entries: number
        }
        Insert: {
          actions_taken?: Json | null
          audit_date?: string
          avg_confidence?: number | null
          avg_decayed_confidence?: number | null
          created_at?: string
          decayed_entries?: number
          id?: string
          stale_domains?: Json | null
          stale_entries?: number
          total_entries?: number
        }
        Update: {
          actions_taken?: Json | null
          audit_date?: string
          avg_confidence?: number | null
          avg_decayed_confidence?: number | null
          created_at?: string
          decayed_entries?: number
          id?: string
          stale_domains?: Json | null
          stale_entries?: number
          total_entries?: number
        }
        Relationships: []
      }
      learning_feedback: {
        Row: {
          agent_id: string | null
          context: Json | null
          created_at: string
          feedback_text: string | null
          feedback_type: string
          id: string
          insight_id: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          context?: Json | null
          created_at?: string
          feedback_text?: string | null
          feedback_type: string
          id?: string
          insight_id?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          context?: Json | null
          created_at?: string
          feedback_text?: string | null
          feedback_type?: string
          id?: string
          insight_id?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_feedback_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_feedback_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "global_learning_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      learnings: {
        Row: {
          applied_at: string | null
          applied_to_version: number | null
          created_at: string
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["learning_kind"]
          proposed_by: string | null
          proposed_change: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_episode_ids: string[] | null
          source_feedback_ids: string[] | null
          status: Database["public"]["Enums"]["learning_status"]
          target_function: string | null
          title: string
        }
        Insert: {
          applied_at?: string | null
          applied_to_version?: number | null
          created_at?: string
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["learning_kind"]
          proposed_by?: string | null
          proposed_change?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_episode_ids?: string[] | null
          source_feedback_ids?: string[] | null
          status?: Database["public"]["Enums"]["learning_status"]
          target_function?: string | null
          title: string
        }
        Update: {
          applied_at?: string | null
          applied_to_version?: number | null
          created_at?: string
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["learning_kind"]
          proposed_by?: string | null
          proposed_change?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_episode_ids?: string[] | null
          source_feedback_ids?: string[] | null
          status?: Database["public"]["Enums"]["learning_status"]
          target_function?: string | null
          title?: string
        }
        Relationships: []
      }
      listener_feedback: {
        Row: {
          content: string | null
          created_at: string
          episode_id: string | null
          feedback_type: string | null
          id: string
          rating: number | null
          raw_metadata: Json | null
          sentiment: string | null
          source: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          episode_id?: string | null
          feedback_type?: string | null
          id?: string
          rating?: number | null
          raw_metadata?: Json | null
          sentiment?: string | null
          source?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          episode_id?: string | null
          feedback_type?: string | null
          id?: string
          rating?: number | null
          raw_metadata?: Json | null
          sentiment?: string | null
          source?: string | null
        }
        Relationships: []
      }
      macro_indicators: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          indicator_name: string
          raw_json: Json | null
          region: string | null
          source: string
          unit: string
          value: number
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          indicator_name: string
          raw_json?: Json | null
          region?: string | null
          source: string
          unit: string
          value: number
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          indicator_name?: string
          raw_json?: Json | null
          region?: string | null
          source?: string
          unit?: string
          value?: number
        }
        Relationships: []
      }
      marketing_assets: {
        Row: {
          asset_type: string
          content: string
          created_at: string
          episode_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_type: string
          content: string
          created_at?: string
          episode_id: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_type?: string
          content?: string
          created_at?: string
          episode_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_assets_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
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
      mfa_verification_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          used: boolean | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          used?: boolean | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          used?: boolean | null
          user_id?: string
        }
        Relationships: []
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
      monitoring_proposals: {
        Row: {
          applied_at: string | null
          client_id: string | null
          confidence: number | null
          created_at: string
          expires_at: string | null
          id: string
          proposal_type: string
          proposed_by_agent: string
          proposed_value: string
          reasoning: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_evidence: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          expires_at?: string | null
          id?: string
          proposal_type: string
          proposed_by_agent: string
          proposed_value: string
          reasoning: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_evidence?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          expires_at?: string | null
          id?: string
          proposal_type?: string
          proposed_by_agent?: string
          proposed_value?: string
          reasoning?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_evidence?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitoring_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      operator_heartbeats: {
        Row: {
          created_at: string
          device_label: string | null
          device_type: string
          id: string
          ip_address: string | null
          is_online: boolean
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          device_type?: string
          id?: string
          ip_address?: string | null
          is_online?: boolean
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          device_type?: string
          id?: string
          ip_address?: string | null
          is_online?: boolean
          last_seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_shares: {
        Row: {
          consortium_id: string
          created_at: string | null
          id: string
          proposed_classification:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          proposed_granularity:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sanitized_content: Json | null
          share_rule_id: string | null
          source_id: string
          source_member_id: string
          source_type: string
          status: string | null
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          consortium_id: string
          created_at?: string | null
          id?: string
          proposed_classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          proposed_granularity?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sanitized_content?: Json | null
          share_rule_id?: string | null
          source_id: string
          source_member_id: string
          source_type: string
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          consortium_id?: string
          created_at?: string | null
          id?: string
          proposed_classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          proposed_granularity?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sanitized_content?: Json | null
          share_rule_id?: string | null
          source_id?: string
          source_member_id?: string
          source_type?: string
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_shares_consortium_id_fkey"
            columns: ["consortium_id"]
            isOneToOne: false
            referencedRelation: "consortia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_shares_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_shares_share_rule_id_fkey"
            columns: ["share_rule_id"]
            isOneToOne: false
            referencedRelation: "consortium_share_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_shares_source_member_id_fkey"
            columns: ["source_member_id"]
            isOneToOne: false
            referencedRelation: "consortium_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_shares_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      petronas_assets: {
        Row: {
          asset_name: string
          asset_type: string | null
          created_at: string
          id: string
          latitude: number | null
          location_description: string | null
          longitude: number | null
          metadata: Json | null
          region: string | null
          source_document_id: string | null
          updated_at: string
        }
        Insert: {
          asset_name: string
          asset_type?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          location_description?: string | null
          longitude?: number | null
          metadata?: Json | null
          region?: string | null
          source_document_id?: string | null
          updated_at?: string
        }
        Update: {
          asset_name?: string
          asset_type?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          location_description?: string | null
          longitude?: number | null
          metadata?: Json | null
          region?: string | null
          source_document_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_test_results: {
        Row: {
          created_at: string
          deleted_at: string | null
          duration_ms: number | null
          error_message: string | null
          error_stack: string | null
          id: string
          metadata: Json | null
          pipeline: string
          status: string
          test_name: string
          test_run_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          error_stack?: string | null
          id?: string
          metadata?: Json | null
          pipeline: string
          status: string
          test_name: string
          test_run_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          error_stack?: string | null
          id?: string
          metadata?: Json | null
          pipeline?: string
          status?: string
          test_name?: string
          test_run_id?: string
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
      podcast_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          role?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      poi_investigations: {
        Row: {
          created_at: string
          entity_id: string
          error_message: string | null
          hibp_breaches: Json | null
          hibp_checked: boolean
          id: string
          queries_run: Json
          report_id: string | null
          results_found: number
          sources_searched: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          error_message?: string | null
          hibp_breaches?: Json | null
          hibp_checked?: boolean
          id?: string
          queries_run?: Json
          report_id?: string | null
          results_found?: number
          sources_searched?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          error_message?: string | null
          hibp_breaches?: Json | null
          hibp_checked?: boolean
          id?: string
          queries_run?: Json
          report_id?: string | null
          results_found?: number
          sources_searched?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_poi_investigations_report_id"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "poi_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_investigations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_reports: {
        Row: {
          confidence_score: number | null
          created_at: string
          entity_id: string
          id: string
          investigation_id: string | null
          report_markdown: string
          subject_profile: Json | null
          threat_level: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          entity_id: string
          id?: string
          investigation_id?: string | null
          report_markdown: string
          subject_profile?: Json | null
          threat_level?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          entity_id?: string
          id?: string
          investigation_id?: string | null
          report_markdown?: string
          subject_profile?: Json | null
          threat_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_reports_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_reports_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "poi_investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_deviations: {
        Row: {
          created_at: string | null
          deviation_magnitude: number | null
          deviation_note: string | null
          deviation_type: string
          id: string
          prediction_id: string | null
          signal_id: string | null
        }
        Insert: {
          created_at?: string | null
          deviation_magnitude?: number | null
          deviation_note?: string | null
          deviation_type: string
          id?: string
          prediction_id?: string | null
          signal_id?: string | null
        }
        Update: {
          created_at?: string | null
          deviation_magnitude?: number | null
          deviation_note?: string | null
          deviation_type?: string
          id?: string
          prediction_id?: string | null
          signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prediction_deviations_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "agent_world_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_deviations_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      predictive_incident_scores: {
        Row: {
          actual_escalated: boolean | null
          contributing_factors: Json | null
          escalation_probability: number
          id: string
          model_version: string | null
          outcome_verified: boolean | null
          predicted_priority: string | null
          predicted_severity: string | null
          scored_at: string
          signal_id: string | null
        }
        Insert: {
          actual_escalated?: boolean | null
          contributing_factors?: Json | null
          escalation_probability?: number
          id?: string
          model_version?: string | null
          outcome_verified?: boolean | null
          predicted_priority?: string | null
          predicted_severity?: string | null
          scored_at?: string
          signal_id?: string | null
        }
        Update: {
          actual_escalated?: boolean | null
          contributing_factors?: Json | null
          escalation_probability?: number
          id?: string
          model_version?: string | null
          outcome_verified?: boolean | null
          predicted_priority?: string | null
          predicted_severity?: string | null
          scored_at?: string
          signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "predictive_incident_scores_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
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
          keyboard_shortcuts: Json | null
          last_password_changed_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id: string
          keyboard_shortcuts?: Json | null
          last_password_changed_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          keyboard_shortcuts?: Json | null
          last_password_changed_at?: string | null
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
      prompt_versions: {
        Row: {
          created_at: string
          created_by: string | null
          deployed_at: string | null
          function_name: string
          id: string
          notes: string | null
          prompt_hash: string | null
          prompt_text: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deployed_at?: string | null
          function_name: string
          id?: string
          notes?: string | null
          prompt_hash?: string | null
          prompt_text: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deployed_at?: string | null
          function_name?: string
          id?: string
          notes?: string | null
          prompt_hash?: string | null
          prompt_text?: string
          version?: number
        }
        Relationships: []
      }
      qa_test_results: {
        Row: {
          actual_outcome: string | null
          deleted_at: string | null
          error_message: string | null
          expected_outcome: string | null
          id: string
          is_known_broken: boolean | null
          known_broken_reason: string | null
          passed: boolean
          response_time_ms: number | null
          severity: string | null
          test_name: string
          test_suite: string
          tested_at: string | null
        }
        Insert: {
          actual_outcome?: string | null
          deleted_at?: string | null
          error_message?: string | null
          expected_outcome?: string | null
          id?: string
          is_known_broken?: boolean | null
          known_broken_reason?: string | null
          passed: boolean
          response_time_ms?: number | null
          severity?: string | null
          test_name: string
          test_suite: string
          tested_at?: string | null
        }
        Update: {
          actual_outcome?: string | null
          deleted_at?: string | null
          error_message?: string | null
          expected_outcome?: string | null
          id?: string
          is_known_broken?: boolean | null
          known_broken_reason?: string | null
          passed?: boolean
          response_time_ms?: number | null
          severity?: string | null
          test_name?: string
          test_suite?: string
          tested_at?: string | null
        }
        Relationships: []
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
      rate_limit_log: {
        Row: {
          function_name: string
          id: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          function_name: string
          id?: string
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          function_name?: string
          id?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      rate_limit_tracking: {
        Row: {
          action_type: string
          id: string
          request_count: number | null
          user_id: string
          window_start: string
        }
        Insert: {
          action_type: string
          id?: string
          request_count?: number | null
          user_id: string
          window_start: string
        }
        Update: {
          action_type?: string
          id?: string
          request_count?: number | null
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      recording_segments: {
        Row: {
          created_at: string
          end_time: number | null
          id: string
          is_retake: boolean | null
          original_segment_id: string | null
          segment_number: number
          session_id: string
          start_time: number | null
          status: string
          transcript: string | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          end_time?: number | null
          id?: string
          is_retake?: boolean | null
          original_segment_id?: string | null
          segment_number: number
          session_id: string
          start_time?: number | null
          status?: string
          transcript?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          end_time?: number | null
          id?: string
          is_retake?: boolean | null
          original_segment_id?: string | null
          segment_number?: number
          session_id?: string
          start_time?: number | null
          status?: string
          transcript?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recording_segments_original_segment_id_fkey"
            columns: ["original_segment_id"]
            isOneToOne: false
            referencedRelation: "recording_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recording_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      red_team_assessments: {
        Row: {
          adjusted_confidence: number | null
          alternative_hypothesis: string | null
          client_id: string | null
          confidence_adjustment: number | null
          created_at: string | null
          id: string
          incident_id: string | null
          original_conclusion: string
          original_confidence: number | null
          red_team_challenge: string
          signal_id: string | null
          target_agent: string
          was_accepted: boolean | null
          weakest_evidence_link: string | null
        }
        Insert: {
          adjusted_confidence?: number | null
          alternative_hypothesis?: string | null
          client_id?: string | null
          confidence_adjustment?: number | null
          created_at?: string | null
          id?: string
          incident_id?: string | null
          original_conclusion: string
          original_confidence?: number | null
          red_team_challenge: string
          signal_id?: string | null
          target_agent: string
          was_accepted?: boolean | null
          weakest_evidence_link?: string | null
        }
        Update: {
          adjusted_confidence?: number | null
          alternative_hypothesis?: string | null
          client_id?: string | null
          confidence_adjustment?: number | null
          created_at?: string | null
          id?: string
          incident_id?: string | null
          original_conclusion?: string
          original_confidence?: number | null
          red_team_challenge?: string
          signal_id?: string | null
          target_agent?: string
          was_accepted?: boolean | null
          weakest_evidence_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "red_team_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_team_assessments_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_team_assessments_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      rejected_content_hashes: {
        Row: {
          client_id: string | null
          content_hash: string
          created_at: string
          id: string
          original_signal_title: string | null
          reason: string | null
        }
        Insert: {
          client_id?: string | null
          content_hash: string
          created_at?: string
          id?: string
          original_signal_title?: string | null
          reason?: string | null
        }
        Update: {
          client_id?: string | null
          content_hash?: string
          created_at?: string
          id?: string
          original_signal_title?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rejected_content_hashes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reliability_settings: {
        Row: {
          auto_create_verification_tasks: boolean | null
          block_unverified_claims: boolean | null
          client_id: string | null
          created_at: string
          id: string
          max_source_age_hours: number | null
          reliability_first_enabled: boolean | null
          require_min_sources: number | null
          require_snapshot_for_external: boolean | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          auto_create_verification_tasks?: boolean | null
          block_unverified_claims?: boolean | null
          client_id?: string | null
          created_at?: string
          id?: string
          max_source_age_hours?: number | null
          reliability_first_enabled?: boolean | null
          require_min_sources?: number | null
          require_snapshot_for_external?: boolean | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_create_verification_tasks?: boolean | null
          block_unverified_claims?: boolean | null
          client_id?: string | null
          created_at?: string
          id?: string
          max_source_age_hours?: number | null
          reliability_first_enabled?: boolean | null
          require_min_sources?: number | null
          require_snapshot_for_external?: boolean | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reliability_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reliability_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      report_action_items: {
        Row: {
          action_description: string
          created_at: string | null
          deadline: string | null
          first_update_due: string | null
          id: string
          owner_id: string | null
          owner_role: string | null
          priority: string | null
          related_incident_id: string | null
          related_signal_id: string | null
          report_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          action_description: string
          created_at?: string | null
          deadline?: string | null
          first_update_due?: string | null
          id?: string
          owner_id?: string | null
          owner_role?: string | null
          priority?: string | null
          related_incident_id?: string | null
          related_signal_id?: string | null
          report_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          action_description?: string
          created_at?: string | null
          deadline?: string | null
          first_update_due?: string | null
          id?: string
          owner_id?: string | null
          owner_role?: string | null
          priority?: string | null
          related_incident_id?: string | null
          related_signal_id?: string | null
          report_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_action_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_action_items_related_incident_id_fkey"
            columns: ["related_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_action_items_related_signal_id_fkey"
            columns: ["related_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_action_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_evidence_sources: {
        Row: {
          claim_text: string
          confidence_score: number | null
          created_at: string | null
          id: string
          internal_url: string | null
          report_id: string | null
          source_id: string | null
          source_title: string | null
          source_type: string
          source_url: string | null
          timestamp: string | null
        }
        Insert: {
          claim_text: string
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          internal_url?: string | null
          report_id?: string | null
          source_id?: string | null
          source_title?: string | null
          source_type: string
          source_url?: string | null
          timestamp?: string | null
        }
        Update: {
          claim_text?: string
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          internal_url?: string | null
          report_id?: string | null
          source_id?: string | null
          source_title?: string | null
          source_type?: string
          source_url?: string | null
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_evidence_sources_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_schedules: {
        Row: {
          client_id: string
          config: Json | null
          created_at: string
          day_of_week: number | null
          email_recipients: string[]
          frequency: string
          hour_utc: number
          id: string
          is_active: boolean
          last_run_at: string | null
          next_run_at: string | null
          report_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          config?: Json | null
          created_at?: string
          day_of_week?: number | null
          email_recipients?: string[]
          frequency?: string
          hour_utc?: number
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string | null
          report_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          config?: Json | null
          created_at?: string
          day_of_week?: number | null
          email_recipients?: string[]
          frequency?: string
          hour_utc?: number
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string | null
          report_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      saved_knowledge_nuggets: {
        Row: {
          citation: string | null
          confidence_score: number | null
          content: string
          created_at: string
          domain: string
          id: string
          is_operationalized: boolean | null
          knowledge_id: string
          notes: string | null
          saved_from_route: string | null
          subdomain: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          citation?: string | null
          confidence_score?: number | null
          content: string
          created_at?: string
          domain: string
          id?: string
          is_operationalized?: boolean | null
          knowledge_id: string
          notes?: string | null
          saved_from_route?: string | null
          subdomain?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          citation?: string | null
          confidence_score?: number | null
          content?: string
          created_at?: string
          domain?: string
          id?: string
          is_operationalized?: boolean | null
          knowledge_id?: string
          notes?: string | null
          saved_from_route?: string | null
          subdomain?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_knowledge_nuggets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_briefings: {
        Row: {
          briefing_type: string
          client_id: string | null
          config: Json | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          last_run_at: string | null
          next_run_at: string | null
          recipient_emails: string[] | null
          recipient_user_ids: string[]
          schedule_cron: string
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          briefing_type?: string
          client_id?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string | null
          recipient_emails?: string[] | null
          recipient_user_ids?: string[]
          schedule_cron?: string
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          briefing_type?: string
          client_id?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string | null
          recipient_emails?: string[] | null
          recipient_user_ids?: string[]
          schedule_cron?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_briefings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_briefings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_briefings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      self_improvement_log: {
        Row: {
          applied: boolean | null
          applied_at: string | null
          created_at: string | null
          description: string | null
          id: string
          improvement_score: number | null
          improvement_type: string
          proposed_change: string | null
          target_agent: string | null
          title: string
        }
        Insert: {
          applied?: boolean | null
          applied_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          improvement_score?: number | null
          improvement_type: string
          proposed_change?: string | null
          target_agent?: string | null
          title: string
        }
        Update: {
          applied?: boolean | null
          applied_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          improvement_score?: number | null
          improvement_type?: string
          proposed_change?: string | null
          target_agent?: string | null
          title?: string
        }
        Relationships: []
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
      shared_incidents: {
        Row: {
          classification:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_id: string
          coordinates: Json | null
          description: string | null
          facility_type: string | null
          granularity: Database["public"]["Enums"]["sharing_granularity"] | null
          id: string
          incident_type: string | null
          indicators: Json | null
          is_active: boolean | null
          metadata: Json | null
          modus_operandi: string | null
          occurred_at: string | null
          region: string | null
          severity: string | null
          shared_at: string | null
          shared_by: string | null
          source_incident_id: string | null
          source_member_id: string | null
          threat_category: string | null
          title: string
        }
        Insert: {
          classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_id: string
          coordinates?: Json | null
          description?: string | null
          facility_type?: string | null
          granularity?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          id?: string
          incident_type?: string | null
          indicators?: Json | null
          is_active?: boolean | null
          metadata?: Json | null
          modus_operandi?: string | null
          occurred_at?: string | null
          region?: string | null
          severity?: string | null
          shared_at?: string | null
          shared_by?: string | null
          source_incident_id?: string | null
          source_member_id?: string | null
          threat_category?: string | null
          title: string
        }
        Update: {
          classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_id?: string
          coordinates?: Json | null
          description?: string | null
          facility_type?: string | null
          granularity?:
            | Database["public"]["Enums"]["sharing_granularity"]
            | null
          id?: string
          incident_type?: string | null
          indicators?: Json | null
          is_active?: boolean | null
          metadata?: Json | null
          modus_operandi?: string | null
          occurred_at?: string | null
          region?: string | null
          severity?: string | null
          shared_at?: string | null
          shared_by?: string | null
          source_incident_id?: string | null
          source_member_id?: string | null
          threat_category?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_incidents_consortium_id_fkey"
            columns: ["consortium_id"]
            isOneToOne: false
            referencedRelation: "consortia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_incidents_shared_by_fkey"
            columns: ["shared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_incidents_source_incident_id_fkey"
            columns: ["source_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_incidents_source_member_id_fkey"
            columns: ["source_member_id"]
            isOneToOne: false
            referencedRelation: "consortium_members"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_intel_products: {
        Row: {
          ai_generated: boolean | null
          attachments: Json | null
          audio_generated_at: string | null
          audio_url: string | null
          classification:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_id: string
          content: string | null
          content_html: string | null
          created_at: string | null
          created_by: string | null
          disseminated_at: string | null
          dissemination_method: string | null
          id: string
          is_draft: boolean | null
          is_published: boolean | null
          metadata: Json | null
          period_end: string | null
          period_start: string | null
          product_type: Database["public"]["Enums"]["intel_product_type"]
          published_at: string | null
          recipient_count: number | null
          source_incidents: string[] | null
          source_signals: string[] | null
          summary: string | null
          title: string
        }
        Insert: {
          ai_generated?: boolean | null
          attachments?: Json | null
          audio_generated_at?: string | null
          audio_url?: string | null
          classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_id: string
          content?: string | null
          content_html?: string | null
          created_at?: string | null
          created_by?: string | null
          disseminated_at?: string | null
          dissemination_method?: string | null
          id?: string
          is_draft?: boolean | null
          is_published?: boolean | null
          metadata?: Json | null
          period_end?: string | null
          period_start?: string | null
          product_type: Database["public"]["Enums"]["intel_product_type"]
          published_at?: string | null
          recipient_count?: number | null
          source_incidents?: string[] | null
          source_signals?: string[] | null
          summary?: string | null
          title: string
        }
        Update: {
          ai_generated?: boolean | null
          attachments?: Json | null
          audio_generated_at?: string | null
          audio_url?: string | null
          classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          consortium_id?: string
          content?: string | null
          content_html?: string | null
          created_at?: string | null
          created_by?: string | null
          disseminated_at?: string | null
          dissemination_method?: string | null
          id?: string
          is_draft?: boolean | null
          is_published?: boolean | null
          metadata?: Json | null
          period_end?: string | null
          period_start?: string | null
          product_type?: Database["public"]["Enums"]["intel_product_type"]
          published_at?: string | null
          recipient_count?: number | null
          source_incidents?: string[] | null
          source_signals?: string[] | null
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_intel_products_consortium_id_fkey"
            columns: ["consortium_id"]
            isOneToOne: false
            referencedRelation: "consortia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_intel_products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_signals: {
        Row: {
          applies_to_sector: string | null
          classification:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          confidence_level: string | null
          consortium_id: string
          credibility: string | null
          detected_at: string | null
          entities_mentioned: string[] | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          keywords: string[] | null
          metadata: Json | null
          region: string | null
          relevance_score: number | null
          shared_at: string | null
          source_member_id: string | null
          source_signal_id: string | null
          summary: string | null
          threat_type: string | null
          title: string
        }
        Insert: {
          applies_to_sector?: string | null
          classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          confidence_level?: string | null
          consortium_id: string
          credibility?: string | null
          detected_at?: string | null
          entities_mentioned?: string[] | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
          metadata?: Json | null
          region?: string | null
          relevance_score?: number | null
          shared_at?: string | null
          source_member_id?: string | null
          source_signal_id?: string | null
          summary?: string | null
          threat_type?: string | null
          title: string
        }
        Update: {
          applies_to_sector?: string | null
          classification?:
            | Database["public"]["Enums"]["tlp_classification"]
            | null
          confidence_level?: string | null
          consortium_id?: string
          credibility?: string | null
          detected_at?: string | null
          entities_mentioned?: string[] | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
          metadata?: Json | null
          region?: string | null
          relevance_score?: number | null
          shared_at?: string | null
          source_member_id?: string | null
          source_signal_id?: string | null
          summary?: string | null
          threat_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_signals_consortium_id_fkey"
            columns: ["consortium_id"]
            isOneToOne: false
            referencedRelation: "consortia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_signals_source_member_id_fkey"
            columns: ["source_member_id"]
            isOneToOne: false
            referencedRelation: "consortium_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_signals_source_signal_id_fkey"
            columns: ["source_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_agent_analyses: {
        Row: {
          agent_call_sign: string
          analysis: string
          analysis_tier: string | null
          confidence_breakdown: Json | null
          confidence_score: number | null
          created_at: string | null
          id: string
          pattern_matches: Json | null
          reasoning_log: Json | null
          signal_id: string | null
          trigger_reason: string | null
        }
        Insert: {
          agent_call_sign: string
          analysis: string
          analysis_tier?: string | null
          confidence_breakdown?: Json | null
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          pattern_matches?: Json | null
          reasoning_log?: Json | null
          signal_id?: string | null
          trigger_reason?: string | null
        }
        Update: {
          agent_call_sign?: string
          analysis?: string
          analysis_tier?: string | null
          confidence_breakdown?: Json | null
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          pattern_matches?: Json | null
          reasoning_log?: Json | null
          signal_id?: string | null
          trigger_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_agent_analyses_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_anomaly_scores: {
        Row: {
          anomaly_details: Json | null
          anomaly_type: string | null
          computed_at: string | null
          id: string
          is_anomalous: boolean | null
          signal_id: string | null
          z_score: number | null
        }
        Insert: {
          anomaly_details?: Json | null
          anomaly_type?: string | null
          computed_at?: string | null
          id?: string
          is_anomalous?: boolean | null
          signal_id?: string | null
          z_score?: number | null
        }
        Update: {
          anomaly_details?: Json | null
          anomaly_type?: string | null
          computed_at?: string | null
          id?: string
          is_anomalous?: boolean | null
          signal_id?: string | null
          z_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_anomaly_scores_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_baselines: {
        Row: {
          day_of_week: number | null
          ewma: number | null
          hour_of_day: number | null
          id: string
          last_computed_at: string | null
          mean_count: number | null
          sample_count: number | null
          signal_type: string
          std_dev: number | null
        }
        Insert: {
          day_of_week?: number | null
          ewma?: number | null
          hour_of_day?: number | null
          id?: string
          last_computed_at?: string | null
          mean_count?: number | null
          sample_count?: number | null
          signal_type: string
          std_dev?: number | null
        }
        Update: {
          day_of_week?: number | null
          ewma?: number | null
          hour_of_day?: number | null
          id?: string
          last_computed_at?: string | null
          mean_count?: number | null
          sample_count?: number | null
          signal_type?: string
          std_dev?: number | null
        }
        Relationships: []
      }
      signal_clusters: {
        Row: {
          agent_analysis: string | null
          centroid_lat: number | null
          centroid_lng: number | null
          cluster_label: string
          cluster_score: number | null
          created_at: string
          entity_overlap: string[] | null
          event_type: string | null
          id: string
          location_name: string | null
          metadata: Json | null
          narrative: string | null
          radius_km: number | null
          severity: string | null
          signal_ids: string[]
          temporal_window_hours: number | null
          updated_at: string
        }
        Insert: {
          agent_analysis?: string | null
          centroid_lat?: number | null
          centroid_lng?: number | null
          cluster_label: string
          cluster_score?: number | null
          created_at?: string
          entity_overlap?: string[] | null
          event_type?: string | null
          id?: string
          location_name?: string | null
          metadata?: Json | null
          narrative?: string | null
          radius_km?: number | null
          severity?: string | null
          signal_ids?: string[]
          temporal_window_hours?: number | null
          updated_at?: string
        }
        Update: {
          agent_analysis?: string | null
          centroid_lat?: number | null
          centroid_lng?: number | null
          cluster_label?: string
          cluster_score?: number | null
          created_at?: string
          entity_overlap?: string[] | null
          event_type?: string | null
          id?: string
          location_name?: string | null
          metadata?: Json | null
          narrative?: string | null
          radius_km?: number | null
          severity?: string | null
          signal_ids?: string[]
          temporal_window_hours?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      signal_contradictions: {
        Row: {
          confidence: number
          contradiction_type: string
          created_at: string
          detected_at: string
          entity_name: string
          id: string
          resolution_notes: string | null
          resolution_status: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          signal_a_id: string | null
          signal_a_summary: string | null
          signal_b_id: string | null
          signal_b_summary: string | null
        }
        Insert: {
          confidence?: number
          contradiction_type?: string
          created_at?: string
          detected_at?: string
          entity_name: string
          id?: string
          resolution_notes?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          signal_a_id?: string | null
          signal_a_summary?: string | null
          signal_b_id?: string | null
          signal_b_summary?: string | null
        }
        Update: {
          confidence?: number
          contradiction_type?: string
          created_at?: string
          detected_at?: string
          entity_name?: string
          id?: string
          resolution_notes?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          signal_a_id?: string | null
          signal_a_summary?: string | null
          signal_b_id?: string | null
          signal_b_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_contradictions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_contradictions_signal_a_id_fkey"
            columns: ["signal_a_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_contradictions_signal_b_id_fkey"
            columns: ["signal_b_id"]
            isOneToOne: false
            referencedRelation: "signals"
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
          match_confidence: string | null
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
          match_confidence?: string | null
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
          match_confidence?: string | null
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
      signal_feedback: {
        Row: {
          corrected_category: string | null
          corrected_severity: string | null
          created_at: string | null
          created_by: string | null
          feedback_source: string
          feedback_type: string
          id: string
          notes: string | null
          original_category: string | null
          original_severity: string | null
          signal_id: string | null
        }
        Insert: {
          corrected_category?: string | null
          corrected_severity?: string | null
          created_at?: string | null
          created_by?: string | null
          feedback_source?: string
          feedback_type: string
          id?: string
          notes?: string | null
          original_category?: string | null
          original_severity?: string | null
          signal_id?: string | null
        }
        Update: {
          corrected_category?: string | null
          corrected_severity?: string | null
          created_at?: string | null
          created_by?: string | null
          feedback_source?: string
          feedback_type?: string
          id?: string
          notes?: string | null
          original_category?: string | null
          original_severity?: string | null
          signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_feedback_signal_id_fkey"
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
      signal_pattern_contributors: {
        Row: {
          contributing_signal_id: string
          created_at: string
          id: string
          pattern_signal_id: string
          pattern_type: string
        }
        Insert: {
          contributing_signal_id: string
          created_at?: string
          id?: string
          pattern_signal_id: string
          pattern_type: string
        }
        Update: {
          contributing_signal_id?: string
          created_at?: string
          id?: string
          pattern_signal_id?: string
          pattern_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_pattern_contributors_contributing_signal_id_fkey"
            columns: ["contributing_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_pattern_contributors_pattern_signal_id_fkey"
            columns: ["pattern_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_score_explanations: {
        Row: {
          confidence: number
          created_at: string
          embedding_similarity: number | null
          factors: Json
          id: string
          recommendation: string
          seasonal_detail: string | null
          seasonal_pattern_match: boolean | null
          signal_id: string
          source_diversity_boost: number | null
          source_diversity_count: number | null
          total_score: number
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          embedding_similarity?: number | null
          factors?: Json
          id?: string
          recommendation?: string
          seasonal_detail?: string | null
          seasonal_pattern_match?: boolean | null
          signal_id: string
          source_diversity_boost?: number | null
          source_diversity_count?: number | null
          total_score: number
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          embedding_similarity?: number | null
          factors?: Json
          id?: string
          recommendation?: string
          seasonal_detail?: string | null
          seasonal_pattern_match?: boolean | null
          signal_id?: string
          source_diversity_boost?: number | null
          source_diversity_count?: number | null
          total_score?: number
          updated_at?: string
        }
        Relationships: []
      }
      signal_storyline_members: {
        Row: {
          added_at: string
          added_by: string | null
          id: string
          role: string | null
          signal_id: string
          similarity_score: number | null
          storyline_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          id?: string
          role?: string | null
          signal_id: string
          similarity_score?: number | null
          storyline_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          id?: string
          role?: string | null
          signal_id?: string
          similarity_score?: number | null
          storyline_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_storyline_members_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_storyline_members_storyline_id_fkey"
            columns: ["storyline_id"]
            isOneToOne: false
            referencedRelation: "signal_storylines"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_storylines: {
        Row: {
          category: string | null
          client_id: string | null
          created_at: string
          embedding_centroid: string | null
          first_seen_at: string
          id: string
          key_entities: string[] | null
          key_locations: string[] | null
          last_updated_at: string
          metadata: Json | null
          signal_count: number
          status: string
          summary: string | null
          threat_level: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          created_at?: string
          embedding_centroid?: string | null
          first_seen_at?: string
          id?: string
          key_entities?: string[] | null
          key_locations?: string[] | null
          last_updated_at?: string
          metadata?: Json | null
          signal_count?: number
          status?: string
          summary?: string | null
          threat_level?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          client_id?: string | null
          created_at?: string
          embedding_centroid?: string | null
          first_seen_at?: string
          id?: string
          key_entities?: string[] | null
          key_locations?: string[] | null
          last_updated_at?: string
          metadata?: Json | null
          signal_count?: number
          status?: string
          summary?: string | null
          threat_level?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_storylines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_updates: {
        Row: {
          content: string
          content_hash: string | null
          created_at: string
          found_at: string
          id: string
          incident_id: string | null
          metadata: Json | null
          signal_id: string
          source_name: string | null
          source_url: string | null
        }
        Insert: {
          content: string
          content_hash?: string | null
          created_at?: string
          found_at?: string
          id?: string
          incident_id?: string | null
          metadata?: Json | null
          signal_id: string
          source_name?: string | null
          source_url?: string | null
        }
        Update: {
          content?: string
          content_hash?: string | null
          created_at?: string
          found_at?: string
          id?: string
          incident_id?: string | null
          metadata?: Json | null
          signal_id?: string
          source_name?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_updates_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_updates_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_verifications: {
        Row: {
          id: string
          signal_id: string
          source_key: string | null
          verification_method: string | null
          verification_note: string | null
          verified_at: string | null
          verified_by: string | null
          was_accurate: boolean
        }
        Insert: {
          id?: string
          signal_id: string
          source_key?: string | null
          verification_method?: string | null
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
          was_accurate: boolean
        }
        Update: {
          id?: string
          signal_id?: string
          source_key?: string | null
          verification_method?: string | null
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
          was_accurate?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "signal_verifications_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          comments: Json | null
          composite_confidence: number | null
          confidence: number | null
          content_embedding: string | null
          content_hash: string | null
          correlated_count: number | null
          correlation_confidence: number | null
          correlation_group_id: string | null
          created_at: string
          deleted_at: string | null
          deletion_reason: string | null
          description: string | null
          engagement_metrics: Json | null
          entity_tags: string[] | null
          event_date: string | null
          expert_context: Json | null
          feedback_score: number | null
          hashtags: string[] | null
          id: string
          image_url: string | null
          information_accuracy: string | null
          is_primary_signal: boolean | null
          is_read: boolean | null
          is_test: boolean | null
          location: string | null
          media_urls: string[] | null
          mentions: string[] | null
          momentum: number | null
          normalized_text: string | null
          post_caption: string | null
          proximity: number | null
          quality_score: number | null
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
          source_reliability: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["signal_status"]
          tenant_id: string | null
          thumbnail_url: string | null
          title: string | null
          triage_override: string | null
          updated_at: string
        }
        Insert: {
          applied_rules?: Json | null
          auto_correlated_entities?: string[] | null
          category?: string | null
          client_id?: string | null
          comments?: Json | null
          composite_confidence?: number | null
          confidence?: number | null
          content_embedding?: string | null
          content_hash?: string | null
          correlated_count?: number | null
          correlation_confidence?: number | null
          correlation_group_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_reason?: string | null
          description?: string | null
          engagement_metrics?: Json | null
          entity_tags?: string[] | null
          event_date?: string | null
          expert_context?: Json | null
          feedback_score?: number | null
          hashtags?: string[] | null
          id?: string
          image_url?: string | null
          information_accuracy?: string | null
          is_primary_signal?: boolean | null
          is_read?: boolean | null
          is_test?: boolean | null
          location?: string | null
          media_urls?: string[] | null
          mentions?: string[] | null
          momentum?: number | null
          normalized_text?: string | null
          post_caption?: string | null
          proximity?: number | null
          quality_score?: number | null
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
          source_reliability?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          tenant_id?: string | null
          thumbnail_url?: string | null
          title?: string | null
          triage_override?: string | null
          updated_at?: string
        }
        Update: {
          applied_rules?: Json | null
          auto_correlated_entities?: string[] | null
          category?: string | null
          client_id?: string | null
          comments?: Json | null
          composite_confidence?: number | null
          confidence?: number | null
          content_embedding?: string | null
          content_hash?: string | null
          correlated_count?: number | null
          correlation_confidence?: number | null
          correlation_group_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_reason?: string | null
          description?: string | null
          engagement_metrics?: Json | null
          entity_tags?: string[] | null
          event_date?: string | null
          expert_context?: Json | null
          feedback_score?: number | null
          hashtags?: string[] | null
          id?: string
          image_url?: string | null
          information_accuracy?: string | null
          is_primary_signal?: boolean | null
          is_read?: boolean | null
          is_test?: boolean | null
          location?: string | null
          media_urls?: string[] | null
          mentions?: string[] | null
          momentum?: number | null
          normalized_text?: string | null
          post_caption?: string | null
          proximity?: number | null
          quality_score?: number | null
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
          source_reliability?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          tenant_id?: string | null
          thumbnail_url?: string | null
          title?: string | null
          triage_override?: string | null
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
          {
            foreignKeyName: "signals_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_scenarios: {
        Row: {
          attack_chains: Json | null
          completed_at: string | null
          confidence_score: number | null
          created_at: string
          id: string
          model_used: string | null
          name: string
          parameters: Json
          recommendations: Json | null
          results: Json | null
          risk_score: number | null
          run_by: string | null
          scenario_type: string
          status: string
          target_client_id: string | null
          target_entity_id: string | null
        }
        Insert: {
          attack_chains?: Json | null
          completed_at?: string | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          model_used?: string | null
          name: string
          parameters?: Json
          recommendations?: Json | null
          results?: Json | null
          risk_score?: number | null
          run_by?: string | null
          scenario_type?: string
          status?: string
          target_client_id?: string | null
          target_entity_id?: string | null
        }
        Update: {
          attack_chains?: Json | null
          completed_at?: string | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          model_used?: string | null
          name?: string
          parameters?: Json
          recommendations?: Json | null
          results?: Json | null
          risk_score?: number | null
          run_by?: string | null
          scenario_type?: string
          status?: string
          target_client_id?: string | null
          target_entity_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "simulation_scenarios_run_by_fkey"
            columns: ["run_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_scenarios_target_client_id_fkey"
            columns: ["target_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_scenarios_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      source_artifacts: {
        Row: {
          client_id: string | null
          content_hash: string
          created_at: string
          id: string
          is_verified: boolean | null
          metadata: Json | null
          retrieved_at: string
          source_type: string
          storage_path: string | null
          tenant_id: string | null
          title: string | null
          updated_at: string
          url: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          client_id?: string | null
          content_hash: string
          created_at?: string
          id?: string
          is_verified?: boolean | null
          metadata?: Json | null
          retrieved_at?: string
          source_type: string
          storage_path?: string | null
          tenant_id?: string | null
          title?: string | null
          updated_at?: string
          url?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          client_id?: string | null
          content_hash?: string
          created_at?: string
          id?: string
          is_verified?: boolean | null
          metadata?: Json | null
          retrieved_at?: string
          source_type?: string
          storage_path?: string | null
          tenant_id?: string | null
          title?: string | null
          updated_at?: string
          url?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_artifacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_artifacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      source_credibility_scores: {
        Row: {
          confirmed_signals: number | null
          created_at: string | null
          current_credibility: number | null
          id: string
          last_updated_at: string | null
          prior_credibility: number | null
          refuted_signals: number | null
          signal_type_scores: Json | null
          source_key: string
          source_name: string | null
          total_signals: number | null
          unverified_signals: number | null
        }
        Insert: {
          confirmed_signals?: number | null
          created_at?: string | null
          current_credibility?: number | null
          id?: string
          last_updated_at?: string | null
          prior_credibility?: number | null
          refuted_signals?: number | null
          signal_type_scores?: Json | null
          source_key: string
          source_name?: string | null
          total_signals?: number | null
          unverified_signals?: number | null
        }
        Update: {
          confirmed_signals?: number | null
          created_at?: string | null
          current_credibility?: number | null
          id?: string
          last_updated_at?: string | null
          prior_credibility?: number | null
          refuted_signals?: number | null
          signal_type_scores?: Json | null
          source_key?: string
          source_name?: string | null
          total_signals?: number | null
          unverified_signals?: number | null
        }
        Relationships: []
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
      speculative_analyses: {
        Row: {
          analysis: string
          call_sign: string
          confidence: number | null
          created_at: string | null
          id: string
          incident_id: string | null
          signal_id: string | null
          structured: Json | null
          was_viewed: boolean | null
        }
        Insert: {
          analysis: string
          call_sign: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          incident_id?: string | null
          signal_id?: string | null
          structured?: Json | null
          was_viewed?: boolean | null
        }
        Update: {
          analysis?: string
          call_sign?: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          incident_id?: string | null
          signal_id?: string | null
          structured?: Json | null
          was_viewed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "speculative_analyses_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speculative_analyses_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      structured_debate_arguments: {
        Row: {
          agent_call_sign: string
          argument_type: string
          claim: string
          confidence: number | null
          created_at: string
          debate_id: string
          evidence_ids: string[] | null
          evidence_summary: string | null
          id: string
          metadata: Json | null
          strength: string | null
          targets_argument_id: string | null
        }
        Insert: {
          agent_call_sign: string
          argument_type: string
          claim: string
          confidence?: number | null
          created_at?: string
          debate_id: string
          evidence_ids?: string[] | null
          evidence_summary?: string | null
          id?: string
          metadata?: Json | null
          strength?: string | null
          targets_argument_id?: string | null
        }
        Update: {
          agent_call_sign?: string
          argument_type?: string
          claim?: string
          confidence?: number | null
          created_at?: string
          debate_id?: string
          evidence_ids?: string[] | null
          evidence_summary?: string | null
          id?: string
          metadata?: Json | null
          strength?: string | null
          targets_argument_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "structured_debate_arguments_debate_id_fkey"
            columns: ["debate_id"]
            isOneToOne: false
            referencedRelation: "agent_debate_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structured_debate_arguments_targets_argument_id_fkey"
            columns: ["targets_argument_id"]
            isOneToOne: false
            referencedRelation: "structured_debate_arguments"
            referencedColumns: ["id"]
          },
        ]
      }
      task_force_agents: {
        Row: {
          agent_id: string
          assigned_tasks: string[] | null
          created_at: string
          id: string
          last_report: string | null
          mission_id: string
          role: Database["public"]["Enums"]["task_force_role"]
          status: string | null
        }
        Insert: {
          agent_id: string
          assigned_tasks?: string[] | null
          created_at?: string
          id?: string
          last_report?: string | null
          mission_id: string
          role: Database["public"]["Enums"]["task_force_role"]
          status?: string | null
        }
        Update: {
          agent_id?: string
          assigned_tasks?: string[] | null
          created_at?: string
          id?: string
          last_report?: string | null
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
      tech_radar_recommendations: {
        Row: {
          business_case: string | null
          category: string
          competing_with: string[] | null
          created_at: string
          dependencies: string[] | null
          estimated_timeline: string | null
          id: string
          implementation_effort: string | null
          maturity_level: string
          relevance_score: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          risks: string[] | null
          source_citations: string[] | null
          status: string
          summary: string
          technology_name: string
          tenant_id: string | null
          updated_at: string
          urgency: string
          vendor_landscape: string | null
        }
        Insert: {
          business_case?: string | null
          category: string
          competing_with?: string[] | null
          created_at?: string
          dependencies?: string[] | null
          estimated_timeline?: string | null
          id?: string
          implementation_effort?: string | null
          maturity_level?: string
          relevance_score?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risks?: string[] | null
          source_citations?: string[] | null
          status?: string
          summary: string
          technology_name: string
          tenant_id?: string | null
          updated_at?: string
          urgency?: string
          vendor_landscape?: string | null
        }
        Update: {
          business_case?: string | null
          category?: string
          competing_with?: string[] | null
          created_at?: string
          dependencies?: string[] | null
          estimated_timeline?: string | null
          id?: string
          implementation_effort?: string | null
          maturity_level?: string
          relevance_score?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risks?: string[] | null
          source_citations?: string[] | null
          status?: string
          summary?: string
          technology_name?: string
          tenant_id?: string | null
          updated_at?: string
          urgency?: string
          vendor_landscape?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tech_radar_recommendations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tech_radar_recommendations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_activity: {
        Row: {
          activity_type: string
          created_at: string | null
          description: string | null
          id: string
          metadata: Json | null
          resource_id: string | null
          resource_name: string | null
          resource_type: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          resource_id?: string | null
          resource_name?: string | null
          resource_type: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          resource_id?: string | null
          resource_name?: string | null
          resource_type?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_activity_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          doc_id: string
          embedding: string | null
          id: string
          metadata: Json | null
          tenant_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          doc_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          tenant_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          doc_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_chunks_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "tenant_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_docs: {
        Row: {
          content: string | null
          content_hash: string | null
          created_at: string
          created_by: string | null
          file_path: string | null
          file_type: string | null
          id: string
          metadata: Json | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          file_type?: string | null
          id?: string
          metadata?: Json | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          file_type?: string | null
          id?: string
          metadata?: Json | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_docs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_knowledge: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          importance_score: number | null
          is_active: boolean | null
          knowledge_type: string
          subject: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          importance_score?: number | null
          is_active?: boolean | null
          knowledge_type?: string
          subject?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          importance_score?: number | null
          is_active?: boolean | null
          knowledge_type?: string
          subject?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_knowledge_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_users: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      thread_memories: {
        Row: {
          added_at: string | null
          id: string
          is_pivotal: boolean | null
          memory_id: string
          sequence_position: number | null
          thread_id: string
        }
        Insert: {
          added_at?: string | null
          id?: string
          is_pivotal?: boolean | null
          memory_id: string
          sequence_position?: number | null
          thread_id: string
        }
        Update: {
          added_at?: string | null
          id?: string
          is_pivotal?: boolean | null
          memory_id?: string
          sequence_position?: number | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_memories_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "agent_investigation_memory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_memories_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "investigation_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_timeline: {
        Row: {
          event_description: string
          event_type: string
          id: string
          occurred_at: string | null
          signal_id: string | null
          thread_id: string
        }
        Insert: {
          event_description: string
          event_type: string
          id?: string
          occurred_at?: string | null
          signal_id?: string | null
          thread_id: string
        }
        Update: {
          event_description?: string
          event_type?: string
          id?: string
          occurred_at?: string | null
          signal_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_timeline_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_timeline_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "investigation_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      threat_analysis_requests: {
        Row: {
          analysis_type: string
          completed_at: string | null
          created_at: string
          id: string
          input_value: string
          result: Json | null
          risk_level: string | null
          status: string
          user_id: string
        }
        Insert: {
          analysis_type: string
          completed_at?: string | null
          created_at?: string
          id?: string
          input_value: string
          result?: Json | null
          risk_level?: string | null
          status?: string
          user_id: string
        }
        Update: {
          analysis_type?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          input_value?: string
          result?: Json | null
          risk_level?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
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
      threat_trajectories: {
        Row: {
          created_at: string | null
          description: string | null
          historical_accuracy: number | null
          id: string
          is_active: boolean | null
          source: string | null
          threat_type: string
          total_phases: number
          trajectory_name: string
          typical_duration_hours: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          historical_accuracy?: number | null
          id?: string
          is_active?: boolean | null
          source?: string | null
          threat_type: string
          total_phases: number
          trajectory_name: string
          typical_duration_hours?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          historical_accuracy?: number | null
          id?: string
          is_active?: boolean | null
          source?: string | null
          threat_type?: string
          total_phases?: number
          trajectory_name?: string
          typical_duration_hours?: number | null
        }
        Relationships: []
      }
      trajectory_phases: {
        Row: {
          description: string | null
          id: string
          indicators: string[] | null
          next_phase_probability: number | null
          phase_name: string
          phase_number: number
          trajectory_id: string
          typical_duration_hours: number | null
        }
        Insert: {
          description?: string | null
          id?: string
          indicators?: string[] | null
          next_phase_probability?: number | null
          phase_name: string
          phase_number: number
          trajectory_id: string
          typical_duration_hours?: number | null
        }
        Update: {
          description?: string | null
          id?: string
          indicators?: string[] | null
          next_phase_probability?: number | null
          phase_name?: string
          phase_number?: number
          trajectory_id?: string
          typical_duration_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trajectory_phases_trajectory_id_fkey"
            columns: ["trajectory_id"]
            isOneToOne: false
            referencedRelation: "threat_trajectories"
            referencedColumns: ["id"]
          },
        ]
      }
      trajectory_positions: {
        Row: {
          client_id: string | null
          confidence: number | null
          created_at: string | null
          current_phase: number
          estimated_next_phase_at: string | null
          id: string
          incident_id: string | null
          is_active: boolean | null
          notes: string | null
          positioned_by: string | null
          signal_id: string | null
          trajectory_id: string
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          confidence?: number | null
          created_at?: string | null
          current_phase: number
          estimated_next_phase_at?: string | null
          id?: string
          incident_id?: string | null
          is_active?: boolean | null
          notes?: string | null
          positioned_by?: string | null
          signal_id?: string | null
          trajectory_id: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          confidence?: number | null
          created_at?: string | null
          current_phase?: number
          estimated_next_phase_at?: string | null
          id?: string
          incident_id?: string | null
          is_active?: boolean | null
          notes?: string | null
          positioned_by?: string | null
          signal_id?: string | null
          trajectory_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trajectory_positions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trajectory_positions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trajectory_positions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trajectory_positions_trajectory_id_fkey"
            columns: ["trajectory_id"]
            isOneToOne: false
            referencedRelation: "threat_trajectories"
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
          source_urls: string[] | null
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
          source_urls?: string[] | null
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
          source_urls?: string[] | null
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
      travel_itineraries: {
        Row: {
          client_id: string | null
          created_at: string | null
          destination: string
          id: string
          notes: string | null
          risk_level: string | null
          travel_end: string
          travel_start: string
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          destination: string
          id?: string
          notes?: string | null
          risk_level?: string | null
          travel_end: string
          travel_start: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          destination?: string
          id?: string
          notes?: string | null
          risk_level?: string | null
          travel_end?: string
          travel_start?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "travel_itineraries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      universal_learning_log: {
        Row: {
          created_at: string
          details: Json | null
          feedback_event_id: string | null
          id: string
          learning_action: string
          object_type: string
          profile_types_updated: string[] | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          feedback_event_id?: string | null
          id?: string
          learning_action: string
          object_type: string
          profile_types_updated?: string[] | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          feedback_event_id?: string | null
          id?: string
          learning_action?: string
          object_type?: string
          profile_types_updated?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "universal_learning_log_feedback_event_id_fkey"
            columns: ["feedback_event_id"]
            isOneToOne: false
            referencedRelation: "feedback_events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_agent_preferences: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          muted_until: string | null
          proactive_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          muted_until?: string | null
          proactive_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          muted_until?: string | null
          proactive_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_agent_preferences_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_agent_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_conduct_records: {
        Row: {
          banned_at: string | null
          banned_reason: string | null
          created_at: string | null
          current_suspension_until: string | null
          id: string
          is_permanently_banned: boolean | null
          last_violation_at: string | null
          last_warning_at: string | null
          suspension_count: number | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string
          violation_count: number | null
          warning_count: number | null
        }
        Insert: {
          banned_at?: string | null
          banned_reason?: string | null
          created_at?: string | null
          current_suspension_until?: string | null
          id?: string
          is_permanently_banned?: boolean | null
          last_violation_at?: string | null
          last_warning_at?: string | null
          suspension_count?: number | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id: string
          violation_count?: number | null
          warning_count?: number | null
        }
        Update: {
          banned_at?: string | null
          banned_reason?: string | null
          created_at?: string | null
          current_suspension_until?: string | null
          id?: string
          is_permanently_banned?: boolean | null
          last_violation_at?: string | null
          last_warning_at?: string | null
          suspension_count?: number | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string
          violation_count?: number | null
          warning_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_conduct_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_last_seen: {
        Row: {
          last_seen_at: string
          previous_seen_at: string | null
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          previous_seen_at?: string | null
          user_id: string
        }
        Update: {
          last_seen_at?: string
          previous_seen_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_mfa_settings: {
        Row: {
          created_at: string
          id: string
          mfa_enabled: boolean | null
          phone_number: string | null
          phone_verified: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mfa_enabled?: boolean | null
          phone_number?: string | null
          phone_verified?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mfa_enabled?: boolean | null
          phone_number?: string | null
          phone_verified?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      user_security_audits: {
        Row: {
          audit_type: string
          breach_count: number | null
          completed_at: string | null
          created_at: string
          digital_footprint_findings: number | null
          exposed_passwords: number | null
          findings: Json | null
          id: string
          network_risks: string[] | null
          overall_score: number
          recommendations: Json | null
          status: string
          user_id: string
        }
        Insert: {
          audit_type?: string
          breach_count?: number | null
          completed_at?: string | null
          created_at?: string
          digital_footprint_findings?: number | null
          exposed_passwords?: number | null
          findings?: Json | null
          id?: string
          network_risks?: string[] | null
          overall_score?: number
          recommendations?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          audit_type?: string
          breach_count?: number | null
          completed_at?: string | null
          created_at?: string
          digital_footprint_findings?: number | null
          exposed_passwords?: number | null
          findings?: Json | null
          id?: string
          network_risks?: string[] | null
          overall_score?: number
          recommendations?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          expires_at: string | null
          id: string
          ip_address: string | null
          is_active: boolean | null
          last_active_at: string | null
          started_at: string | null
          tenant_id: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          last_active_at?: string | null
          started_at?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          last_active_at?: string | null
          started_at?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_tasks: {
        Row: {
          assigned_to: string | null
          briefing_session_id: string | null
          claim_text: string
          client_id: string | null
          created_at: string
          deadline: string | null
          id: string
          resolution_notes: string | null
          source_artifact_id: string | null
          status: string
          tenant_id: string | null
          updated_at: string
          verification_type: string
          where_to_check: string | null
        }
        Insert: {
          assigned_to?: string | null
          briefing_session_id?: string | null
          claim_text: string
          client_id?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          resolution_notes?: string | null
          source_artifact_id?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
          verification_type: string
          where_to_check?: string | null
        }
        Update: {
          assigned_to?: string | null
          briefing_session_id?: string | null
          claim_text?: string
          client_id?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          resolution_notes?: string | null
          source_artifact_id?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
          verification_type?: string
          where_to_check?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_tasks_briefing_session_id_fkey"
            columns: ["briefing_session_id"]
            isOneToOne: false
            referencedRelation: "briefing_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_tasks_source_artifact_id_fkey"
            columns: ["source_artifact_id"]
            isOneToOne: false
            referencedRelation: "source_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      video_clips: {
        Row: {
          ai_score: number | null
          ai_suggested: boolean | null
          aspect_ratio: string
          caption_style: Json | null
          captions: Json | null
          created_at: string
          duration_seconds: number | null
          end_time: number
          export_status: string | null
          exported_path: string | null
          headline_text: string | null
          id: string
          platform: string | null
          source_video_id: string
          start_time: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_score?: number | null
          ai_suggested?: boolean | null
          aspect_ratio?: string
          caption_style?: Json | null
          captions?: Json | null
          created_at?: string
          duration_seconds?: number | null
          end_time: number
          export_status?: string | null
          exported_path?: string | null
          headline_text?: string | null
          id?: string
          platform?: string | null
          source_video_id: string
          start_time: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_score?: number | null
          ai_suggested?: boolean | null
          aspect_ratio?: string
          caption_style?: Json | null
          captions?: Json | null
          created_at?: string
          duration_seconds?: number | null
          end_time?: number
          export_status?: string | null
          exported_path?: string | null
          headline_text?: string | null
          id?: string
          platform?: string | null
          source_video_id?: string
          start_time?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_clips_source_video_id_fkey"
            columns: ["source_video_id"]
            isOneToOne: false
            referencedRelation: "video_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      video_uploads: {
        Row: {
          created_at: string
          description: string | null
          duration_seconds: number | null
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          original_filename: string
          status: string
          storage_path: string
          thumbnail_path: string | null
          title: string
          transcription: string | null
          transcription_segments: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          original_filename: string
          status?: string
          storage_path: string
          thumbnail_path?: string | null
          title: string
          transcription?: string | null
          transcription_segments?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          original_filename?: string
          status?: string
          storage_path?: string
          thumbnail_path?: string | null
          title?: string
          transcription?: string | null
          transcription_segments?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      violation_reports: {
        Row: {
          assigned_to: string | null
          content_excerpt: string | null
          content_id: string | null
          content_type: string
          created_at: string | null
          description: string | null
          id: string
          reported_user_id: string | null
          reporter_id: string
          resolution_notes: string | null
          resolved_at: string | null
          status: string
          tenant_id: string | null
          violation_category: string
        }
        Insert: {
          assigned_to?: string | null
          content_excerpt?: string | null
          content_id?: string | null
          content_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          reported_user_id?: string | null
          reporter_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          tenant_id?: string | null
          violation_category: string
        }
        Update: {
          assigned_to?: string | null
          content_excerpt?: string | null
          content_id?: string | null
          content_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          reported_user_id?: string | null
          reporter_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          tenant_id?: string | null
          violation_category?: string
        }
        Relationships: [
          {
            foreignKeyName: "violation_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vision_analysis_results: {
        Row: {
          analysis: Json
          analyzed_at: string
          confidence: number | null
          detected_objects: string[] | null
          extracted_text: string | null
          id: string
          image_url: string
          model_used: string | null
          source_id: string | null
          source_type: string
          threat_indicators: string[] | null
        }
        Insert: {
          analysis?: Json
          analyzed_at?: string
          confidence?: number | null
          detected_objects?: string[] | null
          extracted_text?: string | null
          id?: string
          image_url: string
          model_used?: string | null
          source_id?: string | null
          source_type: string
          threat_indicators?: string[] | null
        }
        Update: {
          analysis?: Json
          analyzed_at?: string
          confidence?: number | null
          detected_objects?: string[] | null
          extracted_text?: string | null
          id?: string
          image_url?: string
          model_used?: string | null
          source_id?: string | null
          source_type?: string
          threat_indicators?: string[] | null
        }
        Relationships: []
      }
      watchdog_learnings: {
        Row: {
          ai_learning_note: string | null
          created_at: string
          effectiveness_score: number | null
          finding_category: string
          finding_title: string
          id: string
          learned_pattern: string | null
          recurrence_count: number | null
          remediation_action: string | null
          remediation_details: string | null
          remediation_success: boolean | null
          run_id: string
          severity: string
          telemetry_snapshot: Json | null
          was_recurring: boolean | null
        }
        Insert: {
          ai_learning_note?: string | null
          created_at?: string
          effectiveness_score?: number | null
          finding_category: string
          finding_title: string
          id?: string
          learned_pattern?: string | null
          recurrence_count?: number | null
          remediation_action?: string | null
          remediation_details?: string | null
          remediation_success?: boolean | null
          run_id: string
          severity: string
          telemetry_snapshot?: Json | null
          was_recurring?: boolean | null
        }
        Update: {
          ai_learning_note?: string | null
          created_at?: string
          effectiveness_score?: number | null
          finding_category?: string
          finding_title?: string
          id?: string
          learned_pattern?: string | null
          recurrence_count?: number | null
          remediation_action?: string | null
          remediation_details?: string | null
          remediation_success?: boolean | null
          run_id?: string
          severity?: string
          telemetry_snapshot?: Json | null
          was_recurring?: boolean | null
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
      wildfire_station_ratings: {
        Row: {
          created_at: string
          danger_code: string
          danger_rating: string
          days_at_current_rating: number
          fwi: number | null
          id: string
          precip_mm: number | null
          rating_date: string
          rh_min_pct: number | null
          station_id: string
          station_name: string
          temp_max_c: number | null
          wind_dir_deg: number | null
          wind_max_kph: number | null
        }
        Insert: {
          created_at?: string
          danger_code: string
          danger_rating: string
          days_at_current_rating?: number
          fwi?: number | null
          id?: string
          precip_mm?: number | null
          rating_date?: string
          rh_min_pct?: number | null
          station_id: string
          station_name: string
          temp_max_c?: number | null
          wind_dir_deg?: number | null
          wind_max_kph?: number | null
        }
        Update: {
          created_at?: string
          danger_code?: string
          danger_rating?: string
          days_at_current_rating?: number
          fwi?: number | null
          id?: string
          precip_mm?: number | null
          rating_date?: string
          rh_min_pct?: number | null
          station_id?: string
          station_name?: string
          temp_max_c?: number | null
          wind_dir_deg?: number | null
          wind_max_kph?: number | null
        }
        Relationships: []
      }
      workspace_audit_log: {
        Row: {
          action: string
          details: Json | null
          id: string
          performed_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          details?: Json | null
          id?: string
          performed_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          details?: Json | null
          id?: string
          performed_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_evidence: {
        Row: {
          chain_of_custody: Json | null
          created_at: string
          description: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          id: string
          linked_entity_ids: string[] | null
          linked_timeline_event_ids: string[] | null
          metadata: Json | null
          storage_path: string
          tags: string[] | null
          updated_at: string
          uploaded_by: string
          workspace_id: string
        }
        Insert: {
          chain_of_custody?: Json | null
          created_at?: string
          description?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          linked_entity_ids?: string[] | null
          linked_timeline_event_ids?: string[] | null
          metadata?: Json | null
          storage_path: string
          tags?: string[] | null
          updated_at?: string
          uploaded_by: string
          workspace_id: string
        }
        Update: {
          chain_of_custody?: Json | null
          created_at?: string
          description?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          linked_entity_ids?: string[] | null
          linked_timeline_event_ids?: string[] | null
          metadata?: Json | null
          storage_path?: string
          tags?: string[] | null
          updated_at?: string
          uploaded_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_evidence_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          mcm_role: Database["public"]["Enums"]["workspace_mcm_role"] | null
          role: string
          status: string
          system_role: Database["public"]["Enums"]["app_role"]
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          mcm_role?: Database["public"]["Enums"]["workspace_mcm_role"] | null
          role?: string
          status?: string
          system_role?: Database["public"]["Enums"]["app_role"]
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          mcm_role?: Database["public"]["Enums"]["workspace_mcm_role"] | null
          role?: string
          status?: string
          system_role?: Database["public"]["Enums"]["app_role"]
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          joined_at: string
          mcm_role: Database["public"]["Enums"]["workspace_mcm_role"] | null
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          joined_at?: string
          mcm_role?: Database["public"]["Enums"]["workspace_mcm_role"] | null
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          joined_at?: string
          mcm_role?: Database["public"]["Enums"]["workspace_mcm_role"] | null
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_messages: {
        Row: {
          content: string
          id: string
          message_type: string
          parent_message_id: string | null
          sent_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          content: string
          id?: string
          message_type?: string
          parent_message_id?: string | null
          sent_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          content?: string
          id?: string
          message_type?: string
          parent_message_id?: string | null
          sent_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_tasks: {
        Row: {
          assigned_to_user_id: string | null
          completed_at: string | null
          created_at: string
          created_by_user_id: string
          description: string | null
          diary_date: string | null
          due_date: string | null
          id: string
          status: string
          title: string
          workspace_id: string
        }
        Insert: {
          assigned_to_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_user_id: string
          description?: string | null
          diary_date?: string | null
          due_date?: string | null
          id?: string
          status?: string
          title: string
          workspace_id: string
        }
        Update: {
          assigned_to_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_user_id?: string
          description?: string | null
          diary_date?: string | null
          due_date?: string | null
          id?: string
          status?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "investigation_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      world_knowledge_sources: {
        Row: {
          created_at: string
          domain: string
          id: string
          ingestion_count: number | null
          is_active: boolean | null
          last_ingested_at: string | null
          metadata: Json | null
          refresh_interval_hours: number | null
          source_name: string
          source_type: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          ingestion_count?: number | null
          is_active?: boolean | null
          last_ingested_at?: string | null
          metadata?: Json | null
          refresh_interval_hours?: number | null
          source_name: string
          source_type?: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          ingestion_count?: number | null
          is_active?: boolean | null
          last_ingested_at?: string | null
          metadata?: Json | null
          refresh_interval_hours?: number | null
          source_name?: string
          source_type?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wraith_prompt_injection_log: {
        Row: {
          action_taken: string
          analysis_model: string | null
          confidence: number
          created_at: string
          id: string
          indicators: Json
          injection_type: string | null
          message_preview: string
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          action_taken: string
          analysis_model?: string | null
          confidence: number
          created_at?: string
          id?: string
          indicators?: Json
          injection_type?: string | null
          message_preview: string
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          action_taken?: string
          analysis_model?: string | null
          confidence?: number
          created_at?: string
          id?: string
          indicators?: Json
          injection_type?: string | null
          message_preview?: string
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      wraith_signal_threat_scores: {
        Row: {
          adversarial_score: number | null
          ai_generated_score: number
          analysis_model: string | null
          confidence: number
          created_at: string
          id: string
          model_fingerprints: Json | null
          signal_id: string
          synthetic_intel_score: number | null
          threat_indicators: Json
          verdict: string
        }
        Insert: {
          adversarial_score?: number | null
          ai_generated_score: number
          analysis_model?: string | null
          confidence: number
          created_at?: string
          id?: string
          model_fingerprints?: Json | null
          signal_id: string
          synthetic_intel_score?: number | null
          threat_indicators?: Json
          verdict?: string
        }
        Update: {
          adversarial_score?: number | null
          ai_generated_score?: number
          analysis_model?: string | null
          confidence?: number
          created_at?: string
          id?: string
          model_fingerprints?: Json | null
          signal_id?: string
          synthetic_intel_score?: number | null
          threat_indicators?: Json
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "wraith_signal_threat_scores_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      wraith_vulnerability_findings: {
        Row: {
          created_at: string
          cvss_score: number | null
          cwe_id: string | null
          description: string
          file_path: string
          id: string
          location: string | null
          recommendation: string
          scan_id: string
          severity: string
          signal_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cvss_score?: number | null
          cwe_id?: string | null
          description: string
          file_path: string
          id?: string
          location?: string | null
          recommendation: string
          scan_id: string
          severity: string
          signal_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cvss_score?: number | null
          cwe_id?: string | null
          description?: string
          file_path?: string
          id?: string
          location?: string | null
          recommendation?: string
          scan_id?: string
          severity?: string
          signal_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wraith_vulnerability_findings_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      dlq_health: {
        Row: {
          exhausted_retries: number | null
          function_name: string | null
          max_retries_seen: number | null
          oldest_item: string | null
          queue_depth: number | null
          stale_items: number | null
          status: string | null
        }
        Relationships: []
      }
      stalled_cron_jobs: {
        Row: {
          description: string | null
          expected_interval_minutes: number | null
          is_critical: boolean | null
          job_name: string | null
          last_attempt: string | null
          last_success: string | null
          minutes_since_last_success: number | null
          recent_failures: number | null
          stall_status: string | null
        }
        Relationships: []
      }
      stuck_documents: {
        Row: {
          client_id: string | null
          created_at: string | null
          file_size: number | null
          file_type: string | null
          filename: string | null
          id: string | null
          minutes_stuck: number | null
          processing_status: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          file_size?: number | null
          file_type?: string | null
          filename?: string | null
          id?: string | null
          minutes_stuck?: never
          processing_status?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          file_size?: number | null
          file_type?: string | null
          filename?: string | null
          id?: string | null
          minutes_stuck?: never
          processing_status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      watchdog_effectiveness: {
        Row: {
          avg_effectiveness: number | null
          failures: number | null
          finding_category: string | null
          last_seen: string | null
          recurring_issues: number | null
          remediation_action: string | null
          successes: number | null
          total_attempts: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      auto_archive_stale_entities: { Args: never; Returns: number }
      calculate_signal_hash: { Args: { text_content: string }; Returns: string }
      calibrate_agent_accuracy: { Args: never; Returns: number }
      calibrate_analyst_accuracy: { Args: never; Returns: number }
      can_add_analysis: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      can_approve_actions: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      can_manage_assignments: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      can_manage_evidence: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      can_share_to_consortium: {
        Args: { _consortium_id: string; _user_id: string }
        Returns: boolean
      }
      can_submit_findings: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          p_action_type: string
          p_max_requests: number
          p_user_id: string
          p_window_minutes: number
        }
        Returns: boolean
      }
      check_tenant_access: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: boolean
      }
      cleanup_old_errors: { Args: never; Returns: number }
      cleanup_processing_queue: { Args: never; Returns: number }
      compute_signal_feedback_score: {
        Args: { p_signal_id: string }
        Returns: number
      }
      enqueue_signal_processing: {
        Args: { priority_level?: number; signal_id: string }
        Returns: string
      }
      expire_watch_list_entries: { Args: never; Returns: number }
      find_similar_signals_by_embedding: {
        Args: {
          p_embedding: string
          p_exclude_signal_id?: string
          p_max_results?: number
          p_similarity_threshold?: number
          p_time_window_hours?: number
        }
        Returns: {
          category: string
          confidence: number
          correlation_group_id: string
          created_at: string
          id: string
          is_primary_signal: boolean
          location: string
          normalized_text: string
          severity: string
          similarity: number
          source_id: string
        }[]
      }
      get_decayed_confidence: {
        Args: {
          p_base_confidence: number
          p_created_at: string
          p_last_validated_at: string
        }
        Returns: number
      }
      get_service_role_key: { Args: never; Returns: string }
      get_user_accessible_client_ids: {
        Args: never
        Returns: {
          client_id: string
        }[]
      }
      get_user_consortium_ids: { Args: { _user_id: string }; Returns: string[] }
      get_user_tenant_ids: { Args: { _user_id: string }; Returns: string[] }
      get_user_tenants: { Args: { p_user_id: string }; Returns: string[] }
      has_consortium_role: {
        Args: {
          _consortium_id: string
          _roles: Database["public"]["Enums"]["consortium_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_mcm_permission: {
        Args: {
          _required_roles: Database["public"]["Enums"]["workspace_mcm_role"][]
          _user_id: string
          _workspace_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_role: {
        Args: {
          _roles: Database["public"]["Enums"]["tenant_role"][]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_consortium_member: {
        Args: { _consortium_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_tenant_admin_or_owner: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_workspace_contributor: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_creator: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_owner: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      match_agent_memories: {
        Args: {
          p_agent: string
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
        }
        Returns: {
          confidence: number
          content: string
          entities: string[]
          id: string
          incident_id: string
          memory_type: string
          similarity: number
        }[]
      }
      match_cross_agent_memories: {
        Args: {
          p_exclude_agent: string
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
        }
        Returns: {
          agent_call_sign: string
          confidence: number
          content: string
          entities: string[]
          id: string
          incident_id: string
          memory_type: string
          similarity: number
        }[]
      }
      match_documents: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          doc_id: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      pattern_already_detected: {
        Args: {
          p_client_id: string
          p_pattern_type: string
          p_window_hours?: number
        }
        Returns: boolean
      }
      record_violation: {
        Args: {
          p_category: string
          p_content_excerpt: string
          p_content_type: string
          p_matched_pattern: string
          p_severity: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: string
      }
      refresh_entity_quality_score: {
        Args: { p_entity_id: string }
        Returns: undefined
      }
      refresh_signal_feedback_scores: { Args: never; Returns: number }
      route_to_agents: {
        Args: { query_embedding: string; top_k?: number }
        Returns: {
          call_sign: string
          similarity: number
        }[]
      }
      search_expert_knowledge_semantic: {
        Args: {
          call_sign_filter?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          citation: string
          content: string
          domain: string
          id: string
          knowledge_type: string
          similarity: number
          title: string
        }[]
      }
      seed_default_signoffs: {
        Args: { target_user_id: string }
        Returns: number
      }
      set_current_client: {
        Args: { client_id_param: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      upsert_rate_limit: {
        Args: {
          p_function_name: string
          p_max_requests: number
          p_user_id: string
          p_window_start: string
        }
        Returns: Json
      }
      uuid_generate_v4: { Args: never; Returns: string }
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
      consortium_role:
        | "owner"
        | "administrator"
        | "full_member"
        | "associate"
        | "observer"
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
        | "mitigated"
        | "investigating"
      intel_product_type:
        | "blof"
        | "intel_briefing"
        | "incident_digest"
        | "threat_assessment"
        | "situational_report"
        | "warning_order"
        | "flash_report"
      learning_kind:
        | "prompt_change"
        | "rule_addition"
        | "voice_correction"
        | "topic_avoidance"
        | "metadata_fix"
      learning_status:
        | "proposed"
        | "approved"
        | "applied"
        | "rejected"
        | "deferred"
      mission_phase:
        | "intake"
        | "briefing"
        | "execution"
        | "synthesis"
        | "completed"
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
      sharing_granularity:
        | "full"
        | "facility"
        | "regional"
        | "aggregate"
        | "none"
      signal_status:
        | "new"
        | "triaged"
        | "investigating"
        | "resolved"
        | "false_positive"
        | "archived"
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
      tenant_role: "owner" | "admin" | "analyst" | "viewer"
      tlp_classification:
        | "TLP:RED"
        | "TLP:AMBER"
        | "TLP:AMBER+STRICT"
        | "TLP:GREEN"
        | "TLP:CLEAR"
      validation_status: "PASS" | "WARN" | "FAIL" | "PENDING"
      vulnerability_severity:
        | "critical"
        | "high"
        | "medium"
        | "low"
        | "informational"
      workspace_mcm_role:
        | "team_commander"
        | "primary_investigator"
        | "file_coordinator"
        | "investigator"
        | "analyst"
        | "viewer"
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
      consortium_role: [
        "owner",
        "administrator",
        "full_member",
        "associate",
        "observer",
      ],
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
        "mitigated",
        "investigating",
      ],
      intel_product_type: [
        "blof",
        "intel_briefing",
        "incident_digest",
        "threat_assessment",
        "situational_report",
        "warning_order",
        "flash_report",
      ],
      learning_kind: [
        "prompt_change",
        "rule_addition",
        "voice_correction",
        "topic_avoidance",
        "metadata_fix",
      ],
      learning_status: [
        "proposed",
        "approved",
        "applied",
        "rejected",
        "deferred",
      ],
      mission_phase: [
        "intake",
        "briefing",
        "execution",
        "synthesis",
        "completed",
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
      sharing_granularity: [
        "full",
        "facility",
        "regional",
        "aggregate",
        "none",
      ],
      signal_status: [
        "new",
        "triaged",
        "investigating",
        "resolved",
        "false_positive",
        "archived",
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
      tenant_role: ["owner", "admin", "analyst", "viewer"],
      tlp_classification: [
        "TLP:RED",
        "TLP:AMBER",
        "TLP:AMBER+STRICT",
        "TLP:GREEN",
        "TLP:CLEAR",
      ],
      validation_status: ["PASS", "WARN", "FAIL", "PENDING"],
      vulnerability_severity: [
        "critical",
        "high",
        "medium",
        "low",
        "informational",
      ],
      workspace_mcm_role: [
        "team_commander",
        "primary_investigator",
        "file_coordinator",
        "investigator",
        "analyst",
        "viewer",
      ],
    },
  },
} as const

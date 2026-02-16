
-- Fix calibrate_analyst_accuracy: object_id is uuid, not text. Remove the ::text cast.
CREATE OR REPLACE FUNCTION public.calibrate_analyst_accuracy()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count INTEGER := 0;
  analyst RECORD;
BEGIN
  FOR analyst IN
    SELECT 
      fe.user_id,
      COUNT(*) AS total_feedback,
      COUNT(*) FILTER (WHERE 
        (fe.feedback = 'accurate' AND io.was_accurate = true) OR
        (fe.feedback = 'false_positive' AND io.false_positive = true) OR
        (fe.feedback = 'inaccurate' AND io.was_accurate = false)
      ) AS accurate_feedback
    FROM feedback_events fe
    JOIN signals s ON s.id = fe.object_id AND fe.object_type = 'signal'
    JOIN incidents inc ON inc.signal_id = s.id
    JOIN incident_outcomes io ON io.incident_id = inc.id
    WHERE fe.user_id IS NOT NULL
      AND fe.feedback IN ('accurate', 'false_positive', 'inaccurate')
    GROUP BY fe.user_id
    HAVING COUNT(*) >= 5
  LOOP
    DECLARE
      accuracy DOUBLE PRECISION;
      weight DOUBLE PRECISION;
    BEGIN
      accuracy := analyst.accurate_feedback::DOUBLE PRECISION / analyst.total_feedback;
      weight := GREATEST(0.5, LEAST(1.5, 0.5 + accuracy));
      
      INSERT INTO analyst_accuracy_metrics (user_id, accuracy_score, accurate_feedback, total_feedback, weight_multiplier, last_calibrated)
      VALUES (analyst.user_id, accuracy, analyst.accurate_feedback, analyst.total_feedback, weight, now())
      ON CONFLICT (user_id) DO UPDATE SET
        accuracy_score = EXCLUDED.accuracy_score,
        accurate_feedback = EXCLUDED.accurate_feedback,
        total_feedback = EXCLUDED.total_feedback,
        weight_multiplier = EXCLUDED.weight_multiplier,
        last_calibrated = now(),
        updated_at = now();
      
      updated_count := updated_count + 1;
    END;
  END LOOP;
  
  RETURN updated_count;
END;
$function$;

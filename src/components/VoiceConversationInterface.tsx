import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Pause, Play, X, Video, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface VoiceConversationInterfaceProps {
  onClose: () => void;
  conversationHistory: Array<{ role: string; content: string }>;
}

export const VoiceConversationInterface = ({
  onClose,
  conversationHistory,
}: VoiceConversationInterfaceProps) => {
  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis;
    }

    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      synthRef.current?.cancel();
    };
  }, []);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await processAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsListening(true);

      toast({
        title: "Listening",
        description: "Speak now. Tap the mic again to send.",
      });
    } catch (error) {
      console.error("Error starting voice recording:", error);
      toast({
        title: "Microphone Error",
        description: "Could not access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setIsListening(false);
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        const base64Data = base64Audio.split(',')[1];

        // For now, use Web Speech API for transcription
        // In production, you'd send this to a transcription service
        const transcription = "Voice input (transcription pending)";

        const { data, error } = await supabase.functions.invoke('gemini-voice-conversation', {
          body: {
            action: 'process_audio',
            audioData: {
              data: base64Data,
              transcription
            },
            conversationHistory
          }
        });

        if (error) throw error;

        // Speak the response
        if (data.response && synthRef.current) {
          const utterance = new SpeechSynthesisUtterance(data.response);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;
          synthRef.current.speak(utterance);
        }

        toast({
          title: "Response received",
          description: "AI is speaking...",
        });
      };
    } catch (error) {
      console.error("Error processing audio:", error);
      toast({
        title: "Processing Error",
        description: "Failed to process voice input",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const togglePause = () => {
    if (synthRef.current) {
      if (isPaused) {
        synthRef.current.resume();
      } else {
        synthRef.current.pause();
      }
      setIsPaused(!isPaused);
    }
  };

  const handleClose = () => {
    stopListening();
    synthRef.current?.cancel();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-between">
      {/* Header */}
      <div className="w-full flex items-center justify-center pt-6 pb-4">
        <div className="flex items-center gap-2 text-foreground">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-xl font-semibold">Live</span>
        </div>
      </div>

      {/* Main content area with gradient effect */}
      <div className="flex-1 w-full flex items-center justify-center relative">
        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-muted-foreground animate-pulse">Processing...</div>
          </div>
        )}
        
        {/* Animated gradient at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-primary/20 via-primary/10 to-transparent rounded-t-[3rem]" />
      </div>

      {/* Control buttons */}
      <div className="w-full pb-8 px-4 flex items-center justify-center gap-4 relative z-10">
        <Button
          variant="outline"
          size="icon"
          className="h-14 w-14 rounded-full bg-background/50 backdrop-blur border-foreground/20"
          disabled
        >
          <Video className="h-6 w-6" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="h-14 w-14 rounded-full bg-background/50 backdrop-blur border-foreground/20"
          disabled
        >
          <Upload className="h-6 w-6" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="h-14 w-14 rounded-full bg-background/50 backdrop-blur border-foreground/20"
          onClick={togglePause}
          disabled={!synthRef.current?.speaking}
        >
          {isPaused ? <Play className="h-6 w-6" /> : <Pause className="h-6 w-6" />}
        </Button>

        <Button
          size="icon"
          className="h-16 w-16 rounded-full bg-destructive hover:bg-destructive/90"
          onClick={handleClose}
        >
          <X className="h-7 w-7" />
        </Button>
      </div>

      {/* Floating mic button */}
      <Button
        size="icon"
        className={`fixed bottom-32 left-1/2 -translate-x-1/2 h-20 w-20 rounded-full transition-all ${
          isListening 
            ? "bg-destructive hover:bg-destructive/90 animate-pulse" 
            : "bg-primary hover:bg-primary/90"
        }`}
        onClick={isListening ? stopListening : startListening}
        disabled={isProcessing}
      >
        {isListening ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
      </Button>
    </div>
  );
};

import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UseOpenAIRealtimeOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAgentResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening') => void;
  agentContext?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export function useOpenAIRealtime(options: UseOpenAIRealtimeOptions = {}) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'speaking' | 'listening'>('idle');
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [agentResponse, setAgentResponse] = useState('');
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const updateStatus = useCallback((newStatus: typeof status) => {
    setStatus(newStatus);
    options.onStatusChange?.(newStatus);
  }, [options]);

  const connect = useCallback(async () => {
    try {
      updateStatus('connecting');
      console.log('Requesting ephemeral token...');

      // Get ephemeral token from our edge function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke('openai-realtime-token', {
        body: {
          agentContext: options.agentContext,
          conversationHistory: options.conversationHistory
        }
      });

      if (tokenError || !tokenData?.client_secret) {
        throw new Error(tokenError?.message || 'Failed to get ephemeral token');
      }

      console.log('Got ephemeral token, session:', tokenData.session_id);
      const ephemeralKey = tokenData.client_secret.value;

      // Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Set up audio element for playback
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      audioEl.setAttribute('playsinline', 'true');
      audioEl.muted = false;
      audioEl.volume = 1;
      audioElementRef.current = audioEl;
      // Append to DOM to improve autoplay reliability on some browsers
      document.body.appendChild(audioEl);

      pc.ontrack = (event) => {
        console.log('Received audio track from OpenAI');
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch((err) => {
          console.warn('Audio autoplay blocked, waiting for user gesture...', err);
          options.onError?.('Audio playback blocked by browser. Tap once to enable sound.');
          const resume = () => {
            audioEl.play().catch(() => {});
          };
          window.addEventListener('pointerdown', resume, { once: true });
        });
      };

      // Get microphone access
      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      mediaStreamRef.current = stream;

      // Add microphone track to peer connection
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Create data channel for events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        console.log('Data channel opened');
        updateStatus('connected');
      };

      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleRealtimeEvent(data);
        } catch (e) {
          console.error('Failed to parse realtime event:', e);
        }
      };

      dc.onerror = (error) => {
        console.error('Data channel error:', error);
        options.onError?.('Data channel error');
      };

      dc.onclose = () => {
        console.log('Data channel closed');
        updateStatus('idle');
      };

      // Create and set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to OpenAI and get answer
      console.log('Sending SDP offer to OpenAI...');
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        throw new Error(`Failed to connect to OpenAI Realtime: ${errorText}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      console.log('WebRTC connection established!');

    } catch (error) {
      console.error('Connection error:', error);
      options.onError?.(error instanceof Error ? error.message : 'Connection failed');
      updateStatus('idle');
      disconnect();
    }
  }, [options, updateStatus]);

  const handleRealtimeEvent = useCallback((event: Record<string, unknown>) => {
    console.log('Realtime event:', event.type, event);

    switch (event.type) {
      case 'session.created':
        console.log('Session created');
        break;

      case 'session.updated':
        console.log('Session updated');
        break;

      case 'input_audio_buffer.speech_started':
        updateStatus('listening');
        setIsAgentSpeaking(false);
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('User stopped speaking');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        {
          const transcriptText = (event as Record<string, unknown>).transcript as string;
          setTranscript(transcriptText);
          options.onTranscript?.(transcriptText, true);
        }
        break;

      case 'response.audio_transcript.delta':
        {
          const delta = (event as Record<string, unknown>).delta as string;
          setAgentResponse(prev => prev + delta);
          options.onAgentResponse?.(delta);
        }
        break;

      case 'response.audio_transcript.done':
        console.log('Agent finished speaking transcript');
        break;

      case 'response.audio.delta':
        // Audio is handled by WebRTC track, but this indicates agent is speaking
        setIsAgentSpeaking(true);
        updateStatus('speaking');
        break;

      case 'response.audio.done':
        setIsAgentSpeaking(false);
        updateStatus('connected');
        break;

      case 'response.done':
        setIsAgentSpeaking(false);
        updateStatus('connected');
        // Reset agent response for next turn
        setAgentResponse('');
        break;

      case 'error':
        {
          const errorData = (event as Record<string, unknown>).error as Record<string, unknown>;
          console.error('Realtime error:', errorData);
          options.onError?.(errorData?.message as string || 'Unknown error');
        }
        break;

      default:
        // Log unhandled events for debugging
        if (event.type && !(event.type as string).startsWith('rate_limits')) {
          console.log('Unhandled event type:', event.type);
        }
    }
  }, [options, updateStatus]);

  const disconnect = useCallback(() => {
    console.log('Disconnecting...');

    // Close data channel
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }

    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Clean up audio element
    if (audioElementRef.current) {
      audioElementRef.current.pause?.();
      audioElementRef.current.srcObject = null;
      audioElementRef.current.remove();
      audioElementRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setTranscript('');
    setAgentResponse('');
    setIsAgentSpeaking(false);
    updateStatus('idle');
  }, [updateStatus]);

  const sendTextMessage = useCallback((text: string) => {
    if (dcRef.current?.readyState !== 'open') {
      console.error('Data channel not open');
      return;
    }

    // Send a text message to the agent
    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text
        }]
      }
    };

    dcRef.current.send(JSON.stringify(event));
    dcRef.current.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    isAgentSpeaking,
    transcript,
    agentResponse,
    connect,
    disconnect,
    sendTextMessage,
    setOutputMuted: (muted: boolean) => {
      if (audioElementRef.current) audioElementRef.current.muted = muted;
    },
    isConnected: status !== 'idle' && status !== 'connecting'
  };
}
